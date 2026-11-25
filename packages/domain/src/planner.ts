import { Schema } from "effect";
import {
  addToEpisodeIndex,
  type EpisodeContext,
  type EpisodeHistoryEntry,
  episodeIndex,
  type EpisodeRecording,
  findRepeat,
  findRepeatAiring,
  needsRepeat,
  RepeatRef,
  sameEpisode,
} from "./episode.ts";
import { type ExistingRecording, findDuplicate } from "./airing.ts";
import type { ChannelId, RecordingId, RuleId, UserId } from "./ids.ts";
import type { Programme } from "./programme.ts";
import { isRecorded, type Recording } from "./recording.ts";
import { rerunState } from "./rerun.ts";
import { matchRule, type Rule } from "./rule.ts";
import { epochMs, type Instant, padRange, span, type TimeRange } from "./time.ts";

/*
 * The planner (§5.2): runs every rule over the guide and decides what to schedule, what it leaves
 * out and which airings repeat damaged recordings.
 */

/** A programme to schedule, with every rule that asked for it. The first rule owns it. */
export interface PlannedRecording {
  readonly programme: Programme;
  readonly ruleIds: ReadonlyArray<RuleId>;
  readonly range: TimeRange;
  /**
   * Set when this airing is the repeat of damaged recordings: every chain's original it repeats
   * (§3.7), never empty. Several originals of one episode share one repeat.
   */
  readonly replaces?: ReadonlyArray<RecordingId> | undefined;
}

/**
 * Why a rule does not record a programme it matches: the same airing is already scheduled
 * ("Same airing as a scheduled recording"), the guide lists it twice, or the owner already has
 * the episode ("Already recorded · Sun 22, 15:00"). The planner and the API's rule preview say it
 * the same way.
 */
export const RuleMatchSkip = Schema.TaggedUnion({
  SameAiring: {},
  DuplicateEntry: {},
  /** `of`: the copy (or history row) of the episode that made it a repeat. */
  Repeat: { of: RepeatRef },
}).annotate({ identifier: "RuleMatchSkip" });
export type RuleMatchSkip = typeof RuleMatchSkip.Type;

/** A programme some rule matched but that is not scheduled again, and why. */
export interface SkippedMatch {
  readonly programme: Programme;
  readonly ruleId: RuleId;
  readonly reason: RuleMatchSkip;
}

/** What the planner needs to leave out repeats and find repeats of damaged recordings (§5.2). */
export interface PlanningContext extends EpisodeContext {
  /** Epoch ms: which damaged recordings still look for their repeat. */
  readonly now: number;
  /** Deleted episodes per owner, so they are not recorded again. */
  readonly history?: ReadonlyArray<EpisodeHistoryEntry> | undefined;
  /** Whether a person may see a recording (`seesRecording`); everyone sees all when absent. */
  readonly sees?: ((ownerId: UserId, recording: EpisodeRecording) => boolean) | undefined;
  /** Whether a person may see a channel; every channel when absent. */
  readonly seesChannel?: ((ownerId: UserId, channelId: ChannelId) => boolean) | undefined;
  /** Recordings and programmes the current conflict result cannot serve, by id (pass 2). */
  readonly unserved?: ReadonlySet<string> | undefined;
}

/**
 * What the planner reads from an existing recording. Plain airings (`ExistingRecording`) only
 * block the same airing; recordings with the episode fields also count as having the episode
 * and, when damaged, look for their repeat.
 */
export type PlanExisting = ExistingRecording &
  Partial<
    Omit<EpisodeRecording, keyof ExistingRecording | "id"> &
      Pick<Recording, "rerunUntil" | "rerunOutcome" | "rerunAttempts" | "replacedById">
  > & {
    /** A recording's id; plain airings may carry their guide id, which is never used. */
    readonly id?: string | undefined;
  };

type EpisodeExisting = PlanExisting & EpisodeRecording;

/** Whether an existing recording carries the episode fields, so it can count as having one. */
export const isEpisodeRecording = (recording: PlanExisting): recording is EpisodeExisting =>
  recording.state !== undefined &&
  recording.ownerIds !== undefined &&
  recording.problems !== undefined &&
  recording.padding !== undefined &&
  recording.categories !== undefined &&
  recording.live !== undefined &&
  recording.repeat !== undefined;

const byStart = (a: { readonly start: Instant }, b: { readonly start: Instant }): number =>
  epochMs(a.start) - epochMs(b.start);

/**
 * Runs every rule over the guide and returns what to schedule (§5.2). A programme several rules
 * match is planned once, with the padded ranges merged to the widest; duplicates of existing
 * recordings and duplicate guide entries are skipped and reported. Each matching rule set to
 * `skipRepeats` decides on its own whether its owner already has the episode (an existing copy
 * they see, an airing planned earlier in this run, or their history) and skips it as `Repeat`;
 * the airing is planned for the rules that did not skip. Then every damaged recording still
 * looking for its repeat gets one: `findRepeatAiring` picks the airing, which is planned with
 * `replaces` (or an existing plan of that airing gains it).
 */
export const planRecordings = (
  rules: ReadonlyArray<Rule>,
  programmes: ReadonlyArray<Programme>,
  existing: ReadonlyArray<PlanExisting>,
  context: PlanningContext,
): { planned: Array<PlannedRecording>; skipped: Array<SkippedMatch> } => {
  const planned: Array<PlannedRecording> = [];
  const skipped: Array<SkippedMatch> = [];
  const sortedProgrammes = programmes.toSorted(byStart);
  const ownerOf = new Map(rules.map((rule) => [rule.id, rule.ownerId]));
  const index = episodeIndex<EpisodeRecording>(
    existing.filter(isEpisodeRecording),
    context.history ?? [],
  );
  for (const programme of sortedProgrammes) {
    const matches = rules.flatMap((rule) => matchRule(rule, programme, context.timeZone) ?? []);
    const first = matches[0];
    if (first === undefined) continue;
    const candidate: ExistingRecording = { ...programme, programmeId: programme.id };
    if (findDuplicate(candidate, existing) !== undefined) {
      skipped.push({ programme, ruleId: first.rule.id, reason: { _tag: "SameAiring" } });
      continue;
    }
    const plannedAsExisting = planned.map((plan) => ({
      ...plan.programme,
      programmeId: plan.programme.id,
    }));
    if (findDuplicate(candidate, plannedAsExisting) !== undefined) {
      skipped.push({ programme, ruleId: first.rule.id, reason: { _tag: "DuplicateEntry" } });
      continue;
    }
    const recording = matches.filter((match) => {
      if (!match.rule.skipRepeats) return true;
      const of = findRepeat(programme, index, { ...context, ownerId: match.rule.ownerId });
      if (of === undefined) return true;
      skipped.push({ programme, ruleId: match.rule.id, reason: { _tag: "Repeat", of } });
      return false;
    });
    const [owner] = recording;
    if (owner === undefined) continue;
    const plan: PlannedRecording = {
      programme,
      ruleIds: recording.map((match) => match.rule.id),
      range: span(owner.range, ...recording.map((match) => match.range)),
    };
    planned.push(plan);
    // Planned items count too: an episode twice in the planning window is planned once.
    const { id: programmeId, ...airing } = programme;
    addToEpisodeIndex(index, {
      ...airing,
      programmeId,
      state: "scheduled",
      problems: [],
      padding: owner.rule.padding,
      ruleId: owner.rule.id,
      ownerIds: plan.ruleIds.flatMap((id) => ownerOf.get(id) ?? []),
    });
  }
  return planRepeats(rules, sortedProgrammes, existing, { planned, skipped }, context);
};

/** Whether a recording holds the whole episode well enough to count as a good copy. */
const isGoodCopy = (recording: EpisodeExisting): boolean =>
  isRecorded(recording) && !needsRepeat(recording);

/**
 * Adds the repeats of damaged recordings that still look for one (§3.7 step 2). An original
 * whose episode a good repeat already holds (its own chain's, or the shared repeat of another
 * original of the episode) is resolved and looks no further. Several originals of one episode
 * that pick the same airing share its plan: `replaces` lists each.
 */
const planRepeats = (
  rules: ReadonlyArray<Rule>,
  programmes: ReadonlyArray<Programme>,
  existing: ReadonlyArray<PlanExisting>,
  plan: { planned: Array<PlannedRecording>; skipped: Array<SkippedMatch> },
  context: PlanningContext,
): { planned: Array<PlannedRecording>; skipped: Array<SkippedMatch> } => {
  let { planned, skipped } = plan;
  const ruleIds = new Set(rules.map((rule) => rule.id));
  const episodes = existing.filter(isEpisodeRecording);
  const goodRepeats = episodes.filter(
    (recording) => recording.replacesId !== undefined && isGoodCopy(recording),
  );
  // Only the damaged recordings of the rules being planned look for their repeat here.
  const originals = episodes.filter(
    (recording) =>
      recording.replacesId === undefined &&
      recording.ruleId !== undefined &&
      ruleIds.has(recording.ruleId),
  );
  for (const original of originals) {
    const { id, ruleId } = original;
    if (id === undefined || ruleId === undefined) continue;
    const chain = episodes.filter((recording) => recording.replacesId === id);
    if (rerunState({ ...original, id }, chain, [], context.now)?.state !== "looking") continue;
    const resolved = goodRepeats.some(
      (repeat) =>
        epochMs(repeat.start) >= epochMs(original.end) &&
        (repeat.replacesId === id || sameEpisode(original, repeat, context)),
    );
    if (resolved) continue;
    const airing = findRepeatAiring(original, programmes, context);
    if (airing === undefined) continue;
    const present = planned.find((item) => item.programme.id === airing.id);
    if (present !== undefined) {
      if (!(present.replaces ?? []).includes(id)) {
        planned = planned.map((item) =>
          item === present ? { ...item, replaces: [...(item.replaces ?? []), id] } : item,
        );
      }
      continue;
    }
    if (findDuplicate({ ...airing, programmeId: airing.id }, existing) !== undefined) continue;
    skipped = skipped.filter((skip) => skip.programme.id !== airing.id);
    planned = [
      ...planned,
      {
        programme: airing,
        ruleIds: [ruleId],
        range: padRange(airing, original.padding),
        replaces: [id],
      },
    ];
  }
  return { planned: planned.toSorted((a, b) => byStart(a.programme, b.programme)), skipped };
};
