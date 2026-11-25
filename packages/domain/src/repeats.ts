import { Schema } from "effect";
import { episodeIndex, findRepeat, RepeatRef, type RepeatState } from "./episode.ts";
import { ProgrammeId, RuleId, type UserId } from "./ids.ts";
import type { Programme } from "./programme.ts";
import { findDuplicate } from "./airing.ts";
import {
  isEpisodeRecording,
  type PlanExisting,
  planRecordings,
  type PlanningContext,
} from "./planner.ts";
import type { Rule } from "./rule.ts";

/*
 * Which guide airings a viewer already has (recording model §3.6, §7 `GET /guide/repeats`):
 * worked out with the planner's own function, so the guide mark, the programme sheet and the
 * scheduler never disagree.
 */

/**
 * An airing the viewer already has: `ruleId` is set when one of the viewer's series recordings
 * left it out (`Repeat`), absent when the viewer merely sees a copy of the episode (`Owned`).
 */
export const GuideRepeat = Schema.Struct({
  programmeId: ProgrammeId,
  ruleId: Schema.optionalKey(RuleId),
  of: RepeatRef,
}).annotate({ identifier: "GuideRepeat" });
export type GuideRepeat = typeof GuideRepeat.Type;

/** How every client phrases the copy that makes an airing one the viewer already has. */
export type RepeatKind = "recorded" | "scheduled" | "deleted";

const repeatKinds: Record<RepeatState, RepeatKind> = {
  completed: "recorded",
  incomplete: "recorded",
  recording: "recorded",
  scheduled: "scheduled",
  history: "deleted",
};

/**
 * The copy behind "Already recorded Sun 22" read once for every client: recorded (or being
 * recorded), scheduled, or only in the history of deleted episodes.
 */
export const repeatKind = (of: Pick<RepeatRef, "state">): RepeatKind => repeatKinds[of.state];

/**
 * The airings of `programmes` the viewer already has. Runs `planRecordings` with every rule and
 * the same inputs the scheduler uses; airings one of the viewer's own series recordings left out
 * as `Repeat` carry its rule. Every other airing the viewer is not recording itself but has a
 * visible counting copy (or a history row) of is `Owned`. Callers filter `of` by what the viewer
 * may see through `context.sees`.
 */
export const guideRepeats = (
  viewerId: UserId,
  rules: ReadonlyArray<Rule>,
  programmes: ReadonlyArray<Programme>,
  existing: ReadonlyArray<PlanExisting>,
  context: PlanningContext,
): Array<GuideRepeat> => {
  const { skipped } = planRecordings(rules, programmes, existing, context);
  const own = new Set(rules.filter((rule) => rule.ownerId === viewerId).map((rule) => rule.id));
  const decided = new Map<ProgrammeId, GuideRepeat>();
  for (const skip of skipped) {
    const { reason } = skip;
    if (reason._tag !== "Repeat" || !own.has(skip.ruleId) || decided.has(skip.programme.id)) {
      continue;
    }
    decided.set(skip.programme.id, {
      programmeId: skip.programme.id,
      ruleId: skip.ruleId,
      of: reason.of,
    });
  }
  const index = episodeIndex(
    existing.filter(isEpisodeRecording),
    (context.history ?? []).filter((entry) => entry.userId === viewerId),
  );
  const owned: Array<GuideRepeat> = [];
  for (const programme of programmes) {
    if (decided.has(programme.id)) continue;
    if (findDuplicate({ ...programme, programmeId: programme.id }, existing) !== undefined)
      continue;
    const of = findRepeat(programme, index, { ...context, ownerId: viewerId });
    if (of !== undefined) owned.push({ programmeId: programme.id, of });
  }
  return [...decided.values(), ...owned];
};
