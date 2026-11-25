/**
 * Rules (PLAN 6.6), shown as series recordings (recording model §1): standing orders to record
 * whatever matches. Users manage their own rules, admins see everyone's. A preview runs a draft
 * rule over the upcoming guide with the planner the recorder uses, with the same context (episode
 * history, access, stream limits), says where each match would land ("Automatic (Formel 1)"),
 * which ones it leaves out and why ("Already recorded · Sun 22, 15:00"), and lists the near
 * misses ("Similar, won't record").
 *
 * Profiles that may not record cannot create or change rules; a restricted profile's rule must
 * stay on channels it sees and record into one of its collections (`canSeeRule`).
 *
 * Linked collections (§3.4): a collection may follow a rule's *what* conditions. Every save
 * rewrites its snapshot in the same transaction and keeps the invariant `collection follows R ⇒
 * R.collectionId = collection`: a rule whose Goes to leaves the collection unlinks it, and so
 * does a save that changes the conditions by someone who may not edit collections. Deleting a
 * rule keeps (unlinks) or removes its collection first; the database refuses anything else.
 */
import { and, count, eq, inArray, max, ne, or } from "drizzle-orm";
import { Clock, Context, DateTime, Effect, Layer } from "effect";
import {
  Conflict,
  Forbidden,
  type InputProblem,
  InvalidInput,
  NotFound,
  type RuleCollectionRequest,
  type RuleInput,
  type RuleMatchPreview,
  type RuleOffer,
  type RulePreview,
  type RuleRemoveCollection,
  ruleUndoWindowMillis,
  type RuleUpdate,
} from "@slipstream/api";
import {
  canCreateCollections,
  canEditRule,
  canSeeRule,
  type CollectionOffer,
  collectionOffer,
  defaultLayout,
  exportTemplateProblems,
  groupRecording,
  type GroupSubject,
  hasWhatConditions,
  type Instant,
  matcherEquals,
  matcherProblems,
  matchRule,
  padRange,
  planRecordings,
  type Programme,
  RecordingId,
  type Rule,
  RuleId,
  type User,
  UserId,
  whatConditions,
} from "@slipstream/domain";
import { collectionProblems } from "../collections/service.ts";
import { ServerConfig } from "../config.ts";
import { Db, type Transaction } from "../db/client.ts";
import { collections, episodeHistory, recordingOwners, recordings, rules } from "../db/schema.ts";
import { EventBus } from "../events.ts";
import { Guide } from "../guide/service.ts";
import { requireAdmin } from "../auth/service.ts";
import { loadViewer, requireMayRecord, seesChannel } from "../household/viewer.ts";
import { newId } from "../ids.ts";
import { Planning, PLANNING_HORIZON_MILLIS } from "../planning/service.ts";
import { Recorder } from "../recorder/engine.ts";
import {
  loadChannelNames,
  loadCollections,
  loadRecordings,
  type RecordingRemoved,
  resolveCollection,
} from "../recordings/store.ts";
import { toRule } from "./store.ts";

/**
 * Editor checks for a rule: its matcher (including regexes that could backtrack without end,
 * which never get to run) and its export path template.
 */
export const ruleProblems = (input: typeof RuleInput.Type): Array<InputProblem> => [
  ...matcherProblems(input.matcher).map((problem): InputProblem => {
    switch (problem._tag) {
      case "MatchesEverything":
        return { path: "matcher", code: "matchesEverything" };
      case "InvalidRegex":
        return { path: "matcher.title", code: "invalidRegex" };
      case "UnsafeRegex":
        return { path: "matcher.title", code: "unsafeRegex" };
      case "InvertedDuration":
        return { path: "matcher.maxDurationMinutes", code: "invertedDuration" };
    }
  }),
  ...(input.exportTemplate === undefined
    ? []
    : exportTemplateProblems(input.exportTemplate, input.matcher).map((problem): InputProblem => ({
        path: "exportTemplate",
        code:
          problem._tag === "AbsolutePath"
            ? "absolutePath"
            : problem._tag === "ParentFolder"
              ? "parentFolder"
              : "unknownVariable",
      }))),
];

/** Orders previews by programme start. */
const byStart = (
  a: { readonly programme: { readonly start: DateTime.Utc } },
  b: { readonly programme: { readonly start: DateTime.Utc } },
) => DateTime.toEpochMillis(a.programme.start) - DateTime.toEpochMillis(b.programme.start);

/** The columns a save writes (everything but id, owner and creation time). */
const ruleColumns = (rule: Rule) => ({
  name: rule.name,
  enabled: rule.enabled,
  matcher: rule.matcher,
  paddingBeforeMinutes: rule.padding.beforeMinutes,
  paddingAfterMinutes: rule.padding.afterMinutes,
  retention: rule.retention,
  collectionId: rule.collectionId ?? null,
  exportTemplate: rule.exportTemplate ?? null,
  skipRepeats: rule.skipRepeats,
  offerDeclined: rule.offerDeclined,
});

/** Whether the offer may show for this rule and actor at all (§3.3, conditions 1 and 2). */
const offerApplies = (actor: User, rule: Rule) =>
  rule.collectionId === undefined && !rule.offerDeclined && canCreateCollections(actor);

/**
 * A rule's history rows: its owner's, whoever looks. An admin on someone else's rule sees and
 * forgets what keeps that rule's episodes out, not what their own history holds.
 */
const historyWhere = (rule: Rule) =>
  and(eq(episodeHistory.ruleId, rule.id), eq(episodeHistory.userId, rule.ownerId));

/** What deleting a rule was asked to do. */
export interface RuleRemoval {
  readonly collection?: RuleRemoveCollection | undefined;
  readonly undo?: boolean | undefined;
}

const makeRules = Effect.gen(function* () {
  const { write, read } = yield* Db;
  const guide = yield* Guide;
  const recorder = yield* Recorder;
  const planning = yield* Planning;
  const config = yield* ServerConfig;
  const bus = yield* EventBus;

  const check = (input: typeof RuleInput.Type) =>
    Effect.gen(function* () {
      const problems = ruleProblems(input);
      if (input.collectionId !== undefined) {
        const [collection] = yield* read
          .select({ id: collections.id })
          .from(collections)
          .where(eq(collections.id, input.collectionId))
          .pipe(Effect.orDie);
        if (collection === undefined)
          problems.push({ path: "collectionId", code: "unknownCollection" });
      }
      if (problems.length > 0) return yield* new InvalidInput({ problems });
    });

  /**
   * Whether the actor may save this rule: they may record, and a restricted profile keeps it on
   * its own channels and collections.
   */
  const allowed = (actor: User, input: typeof RuleInput.Type, previous?: Rule) =>
    Effect.gen(function* () {
      const viewer = yield* loadViewer(read, actor);
      yield* requireMayRecord(viewer);
      // Where exports land on the server's disk is the admin's call; others keep what is there.
      if (input.exportTemplate !== undefined && input.exportTemplate !== previous?.exportTemplate) {
        yield* requireAdmin(actor);
      }
      if (
        !canSeeRule(viewer.access, {
          channelIds: input.matcher.channels,
          collectionId: input.collectionId,
        })
      ) {
        return yield* new Forbidden();
      }
      return viewer;
    });

  /** A rule the actor may edit (`canEditRule`); others look like they do not exist. */
  const visible = (actor: User, ruleId: string) =>
    Effect.gen(function* () {
      const [row] = yield* read.select().from(rules).where(eq(rules.id, ruleId)).pipe(Effect.orDie);
      const rule = row === undefined ? undefined : toRule(row);
      if (
        rule === undefined ||
        !canEditRule(rule, { id: actor.id, isAdmin: actor.role === "admin" })
      )
        return yield* new NotFound({ entity: "rule", id: ruleId });
      return rule;
    });

  /**
   * Plans again after a committed change and tells the services that cache visibility or a plan
   * (`HouseholdChanged`); a planning failure must not fail the edit that caused it.
   */
  const replan = recorder.replan.pipe(
    Effect.catchCause((cause) => Effect.logError("Planning recordings failed", cause)),
    Effect.andThen(bus.publishHouseholdChanged),
  );

  /** The collection that follows a rule, if any. */
  const followerOf = (db: typeof read | Transaction, ruleId: string) =>
    db
      .select()
      .from(collections)
      .where(eq(collections.ruleId, ruleId))
      .pipe(Effect.map((rows) => rows[0]));

  /**
   * Saves a rule and, in the same transaction, its linked collection (§3.4): the snapshot
   * follows the new *what* conditions, unless Goes to left the collection or someone who may not
   * edit collections changed the conditions; then the collection stops following and keeps
   * today's conditions as its own.
   */
  const save = (actor: User, rule: Rule, previous: Rule | undefined) =>
    write
      .transaction((tx) =>
        Effect.gen(function* () {
          yield* tx
            .insert(rules)
            .values({
              id: rule.id,
              ownerId: rule.ownerId,
              createdAt: DateTime.toEpochMillis(rule.createdAt),
              ...ruleColumns(rule),
            })
            .onConflictDoUpdate({ target: rules.id, set: ruleColumns(rule) });
          const follower = yield* followerOf(tx, rule.id);
          if (follower === undefined) return;
          const leaves = rule.collectionId !== follower.id;
          const conditionsChanged =
            previous !== undefined && !matcherEquals(previous.matcher, rule.matcher);
          if (leaves || (conditionsChanged && !canCreateCollections(actor))) {
            yield* tx
              .update(collections)
              .set({ ruleId: null })
              .where(eq(collections.id, follower.id));
            return;
          }
          const snapshot = whatConditions(rule.matcher);
          if (hasWhatConditions(snapshot)) {
            yield* tx
              .update(collections)
              .set({ matcher: snapshot })
              .where(eq(collections.id, follower.id));
          }
        }),
      )
      .pipe(Effect.orDie);

  /** The collection offer for programmes of one series recording (§3.3), if they scatter. */
  const offerOf = (items: ReadonlyArray<GroupSubject>) =>
    Effect.gen(function* () {
      const names = yield* loadChannelNames(read);
      return collectionOffer(items, {
        timeZone: config.timeZone,
        channelName: (id) => names.get(id),
        collections: yield* loadCollections(read),
      });
    });

  /** The offer for a stored rule: what it recorded plus what the 8-day plan schedules for it. */
  const offerFor = (rule: Rule) =>
    Effect.gen(function* () {
      const plan = yield* planning.inputs;
      const { planned } = planRecordings(plan.rules, plan.programmes, plan.existing, plan.context);
      const made = plan.recordings.filter(
        (recording) =>
          recording.ruleId === rule.id &&
          recording.hiddenAt === undefined &&
          recording.state !== "scheduled" &&
          recording.state !== "cancelled",
      );
      const upcoming = planned
        .filter((item) => item.ruleIds.includes(rule.id))
        .map((item) => ({ ...item.programme, labels: [], ruleId: rule.id }));
      return yield* offerOf([...made, ...upcoming]);
    });

  const preview = (actor: User, input: typeof RuleInput.Type, until: Instant | undefined) =>
    Effect.gen(function* () {
      // A bad draft (an unsafe regex above all) is refused before anything matches it. Previews
      // then obey the same access as saving: no recording rights, no preview, and a restricted
      // profile sees only matches on its own channels. The export path plays no part here.
      yield* check(input);
      const { exportTemplate: _exportTemplate, ...matching } = input;
      const viewer = yield* allowed(actor, matching);
      const now = yield* Clock.currentTimeMillis;
      const end =
        until === undefined ? now + PLANNING_HORIZON_MILLIS : DateTime.toEpochMillis(until);
      if (end <= now) return { matches: [] } satisfies RulePreview;
      const draft: Rule = {
        ...matching,
        enabled: true,
        id: RuleId.make("preview"),
        ownerId: actor.id,
        createdAt: DateTime.makeUnsafe(now),
        offerDeclined: false,
      };
      const upcoming = (yield* guide.between(now, end)).filter(
        (programme) =>
          DateTime.toEpochMillis(programme.end) > now && seesChannel(viewer, programme.channelId),
      );
      // The scheduler's context (history, access, stream limits); every recording counts as
      // existing, so an airing already scheduled shows as the same airing.
      const plan = yield* planning.inputs;
      const { planned, skipped } = planRecordings([draft], upcoming, plan.recordings, plan.context);
      const collectionList = yield* loadCollections(read);
      const names = yield* loadChannelNames(read);
      /** Where a match would land: the rule's collection, else what "Automatic" picks today. */
      const groupOf = (programme: Programme) =>
        groupRecording({ ...programme, labels: [], ruleId: draft.id }, collectionList, {
          timeZone: config.timeZone,
          channelName: (id) => names.get(id),
          ruleCollectionId: draft.collectionId,
        }).path;
      const matches: Array<RuleMatchPreview> = [
        ...planned.map((item) => ({
          programme: item.programme,
          range: item.range,
          group: groupOf(item.programme),
        })),
        ...skipped.map((skip) => ({
          programme: skip.programme,
          range: padRange(skip.programme, draft.padding),
          skip: skip.reason,
          group: groupOf(skip.programme),
        })),
      ].toSorted(byStart);
      const offer: CollectionOffer | undefined = offerApplies(actor, draft)
        ? yield* offerOf(
            matches.map((match) => ({ ...match.programme, labels: [], ruleId: draft.id })),
          )
        : undefined;
      return {
        matches,
        ...(offer === undefined ? {} : { offer }),
      } satisfies RulePreview;
    });

  /**
   * What deleting `rule` does to the upcoming recordings it has a part in: the ones it scheduled
   * and the ones it added its owner to (`addedByRuleId`). A recording nobody else owns is
   * deleted. One with other owners stays theirs: only the rule's owner (on one it scheduled) and
   * the owners this rule added leave it, and it moves to a remaining owner's rule that wants the
   * same airing, or to none (a hand recording from then on). Returns one `RecordingRemoved` per
   * recording someone lost: every owner of a deleted one, the leaving owners of one that stays.
   */
  const releaseUpcoming = (tx: Transaction, rule: Rule) =>
    Effect.gen(function* () {
      const upcoming = yield* loadRecordings(
        tx,
        and(
          eq(recordings.state, "scheduled"),
          or(
            eq(recordings.ruleId, rule.id),
            inArray(
              recordings.id,
              tx
                .select({ id: recordingOwners.recordingId })
                .from(recordingOwners)
                .where(eq(recordingOwners.addedByRuleId, rule.id)),
            ),
          ),
        ),
      );
      const removed: Array<RecordingRemoved> = [];
      for (const { recording, ownersAddedBy } of upcoming) {
        const scheduledByRule = recording.ruleId === rule.id;
        const [first, ...others] = recording.ownerIds.filter(
          (owner) =>
            ownersAddedBy[owner] === rule.id || (scheduledByRule && owner === rule.ownerId),
        );
        if (first === undefined) continue;
        const leaving: RecordingRemoved["ownerIds"] = [first, ...others];
        const staying = recording.ownerIds.filter((owner) => !leaving.includes(owner));
        if (staying.length === 0) {
          yield* tx.delete(recordings).where(eq(recordings.id, recording.id));
          removed.push({
            _tag: "RecordingRemoved",
            recordingId: recording.id,
            ownerIds: recording.ownerIds,
          });
          continue;
        }
        yield* tx
          .delete(recordingOwners)
          .where(
            and(
              eq(recordingOwners.recordingId, recording.id),
              inArray(recordingOwners.userId, leaving),
            ),
          );
        removed.push({ _tag: "RecordingRemoved", recordingId: recording.id, ownerIds: leaving });
        if (!scheduledByRule) continue;
        const candidates = (yield* tx
          .select()
          .from(rules)
          .where(and(inArray(rules.ownerId, staying), ne(rules.id, rule.id)))
          .orderBy(rules.createdAt)).map(toRule);
        // A rule only schedules guide programmes, so its recordings carry the airing's id.
        const { programmeId } = recording;
        const next =
          programmeId === undefined
            ? undefined
            : candidates.find(
                (candidate) =>
                  matchRule(candidate, { ...recording, id: programmeId }, config.timeZone) !==
                  undefined,
              );
        yield* tx
          .update(recordings)
          .set({ ruleId: next?.id ?? null })
          .where(eq(recordings.id, recording.id));
      }
      return removed;
    });

  const remove = (actor: User, ruleId: string, removal: RuleRemoval) =>
    Effect.gen(function* () {
      const rule = yield* visible(actor, ruleId);
      const now = yield* Clock.currentTimeMillis;
      const undo = removal.undo === true;
      if (undo && now - DateTime.toEpochMillis(rule.createdAt) > ruleUndoWindowMillis) {
        return yield* new Conflict({ code: "undoExpired" });
      }
      // People who may not edit collections always keep the collection (§3.4), on an undo too.
      // For everyone else an undo takes back a collection that follows the rule: one can only
      // follow it after it was created.
      const removeCollection =
        canCreateCollections(actor) && (undo || removal.collection === "remove");
      const { removed, ofRule } = yield* write
        .transaction((tx) =>
          Effect.gen(function* () {
            // Its upcoming recordings go with it; what it already recorded stays in the library.
            const released = yield* releaseUpcoming(tx, rule);
            const takenBack = undo
              ? yield* tx
                  .delete(recordingOwners)
                  .where(eq(recordingOwners.addedByRuleId, ruleId))
                  .returning({
                    recordingId: recordingOwners.recordingId,
                    userId: recordingOwners.userId,
                  })
              : [];
            // Deleting the rule clears `rule_id` on what it recorded: read those first, so the
            // recorder can end their repeat searches once this commits.
            const kept = yield* tx
              .select({ id: recordings.id })
              .from(recordings)
              .where(eq(recordings.ruleId, ruleId));
            const follower = yield* followerOf(tx, ruleId);
            if (follower !== undefined) {
              yield* removeCollection
                ? tx.delete(collections).where(eq(collections.id, follower.id))
                : tx
                    .update(collections)
                    .set({ ruleId: null })
                    .where(eq(collections.id, follower.id));
            }
            yield* tx.delete(rules).where(eq(rules.id, ruleId));
            return {
              removed: [
                ...released,
                ...takenBack.map((owner): RecordingRemoved => ({
                  _tag: "RecordingRemoved",
                  recordingId: RecordingId.make(owner.recordingId),
                  ownerIds: [UserId.make(owner.userId)],
                })),
              ],
              ofRule: kept.map((row) => RecordingId.make(row.id)),
            };
          }),
        )
        .pipe(Effect.orDie);
      // Those owners lose the recording from their "Mine"; everyone else keeps it as it is.
      yield* Effect.forEach(removed, bus.publish, { discard: true });
      // Its damaged recordings stop looking for a repeat (§3.7 step 7); those deleted while
      // looking were only kept as the search's anchor and go now.
      const ended = yield* recorder.endChains(ofRule);
      yield* Effect.forEach(
        ended.declined,
        (recording) =>
          bus.publish({
            _tag: "RecordingChanged",
            recordingId: recording.id,
            state: recording.state,
          }),
        { discard: true },
      );
      yield* replan;
    });

  /** "Group them" (§3.3): a collection that follows the rule, and the rule records into it. */
  const group = (actor: User, ruleId: string, request: RuleCollectionRequest) =>
    Effect.gen(function* () {
      if (!canCreateCollections(actor)) return yield* new Forbidden();
      const rule = yield* visible(actor, ruleId);
      if (rule.collectionId !== undefined) return yield* new Conflict({ code: "alreadyGrouped" });
      const snapshot = whatConditions(rule.matcher);
      const layout = request.layout ?? (yield* offerFor(rule))?.layout ?? defaultLayout;
      const draft = { name: request.name, rank: 0, matcher: snapshot, labels: [], layout };
      const problems = collectionProblems(draft);
      if (problems.length > 0) return yield* new InvalidInput({ problems });
      const id = newId();
      // Two "Group them" at once both pass the check above; the writer runs one transaction at a
      // time, so the second sees the first's link here (a follower always is the rule's
      // collection), and never reaches the unique index.
      const row = yield* write
        .transaction((tx) =>
          Effect.gen(function* () {
            const [current] = yield* tx
              .select({ collectionId: rules.collectionId })
              .from(rules)
              .where(eq(rules.id, rule.id));
            if (current === undefined) return "gone" as const;
            if (current.collectionId !== null) return "grouped" as const;
            const [last] = yield* tx.select({ rank: max(collections.rank) }).from(collections);
            const inserted = {
              ...draft,
              id,
              rank: (last?.rank ?? -1) + 1,
              retention: null,
              ruleId: rule.id,
            };
            yield* tx.insert(collections).values(inserted);
            yield* tx.update(rules).set({ collectionId: id }).where(eq(rules.id, rule.id));
            return inserted;
          }),
        )
        .pipe(Effect.orDie);
      if (row === "gone") return yield* new NotFound({ entity: "rule", id: ruleId });
      if (row === "grouped") return yield* new Conflict({ code: "alreadyGrouped" });
      yield* bus.publishHouseholdChanged;
      return yield* resolveCollection(read, row);
    });

  /** The undo of "Group them": the linked collection goes, the offer stays possible. */
  const ungroup = (actor: User, ruleId: string) =>
    Effect.gen(function* () {
      if (!canCreateCollections(actor)) return yield* new Forbidden();
      yield* visible(actor, ruleId);
      const follower = yield* followerOf(read, ruleId).pipe(Effect.orDie);
      if (follower === undefined) return yield* new NotFound({ entity: "collection", id: ruleId });
      yield* write
        .transaction((tx) =>
          Effect.gen(function* () {
            yield* tx
              .update(rules)
              .set({ collectionId: null })
              .where(and(eq(rules.id, ruleId), eq(rules.collectionId, follower.id)));
            yield* tx.delete(collections).where(eq(collections.id, follower.id));
          }),
        )
        .pipe(Effect.orDie);
      yield* bus.publishHouseholdChanged;
    });

  return {
    list: (actor: User) =>
      (actor.role === "admin"
        ? read.select().from(rules)
        : read.select().from(rules).where(eq(rules.ownerId, actor.id))
      )
        .orderBy(rules.createdAt)
        .pipe(
          Effect.map((rows) => rows.map(toRule)),
          Effect.orDie,
        ),
    get: visible,
    create: (actor: User, input: typeof RuleInput.Type) =>
      Effect.gen(function* () {
        yield* check(input);
        yield* allowed(actor, input);
        const rule: Rule = {
          ...input,
          id: RuleId.make(newId()),
          ownerId: actor.id,
          createdAt: DateTime.makeUnsafe(yield* Clock.currentTimeMillis),
          offerDeclined: false,
        };
        yield* save(actor, rule, undefined);
        yield* replan;
        return rule;
      }),
    update: (actor: User, ruleId: string, patch: typeof RuleUpdate.Type) =>
      Effect.gen(function* () {
        const current = yield* visible(actor, ruleId);
        // Fields the patch leaves out keep their value (an older client never resets
        // `skipRepeats`); `offerDeclined` changes only through its own action.
        const { collectionId, ...rest } = patch;
        const { collectionId: _previous, ...kept } = current;
        // null sends the rule back to Automatic; an absent key keeps its collection.
        const target =
          collectionId === undefined ? current.collectionId : (collectionId ?? undefined);
        const next: Rule = {
          ...kept,
          ...rest,
          ...(target === undefined ? {} : { collectionId: target }),
        };
        yield* check(next);
        yield* allowed(actor, next, current);
        yield* save(actor, next, current);
        yield* replan;
        return next;
      }),
    remove,
    preview,
    offer: (actor: User, ruleId: string) =>
      Effect.gen(function* () {
        const rule = yield* visible(actor, ruleId);
        if (!offerApplies(actor, rule)) return {} satisfies RuleOffer;
        const offer = yield* offerFor(rule);
        return (offer === undefined ? {} : { offer }) satisfies RuleOffer;
      }),
    /** "No thanks": the offer never comes back for this rule (Goes to keeps the action). */
    declineOffer: (actor: User, ruleId: string) =>
      Effect.gen(function* () {
        const rule = yield* visible(actor, ruleId);
        yield* write
          .update(rules)
          .set({ offerDeclined: true })
          .where(eq(rules.id, ruleId))
          .pipe(Effect.orDie);
        return { ...rule, offerDeclined: true } satisfies Rule;
      }),
    group,
    ungroup,
    /** How many deleted episodes the owner's history keeps out for this rule (§3.2). */
    history: (actor: User, ruleId: string) =>
      Effect.gen(function* () {
        const rule = yield* visible(actor, ruleId);
        const [row] = yield* read
          .select({ count: count() })
          .from(episodeHistory)
          .where(historyWhere(rule))
          .pipe(Effect.orDie);
        return { count: row?.count ?? 0 };
      }),
    /** "Forget them": the owner's history for this rule is cleared and the rule plans again. */
    forgetHistory: (actor: User, ruleId: string) =>
      Effect.gen(function* () {
        const rule = yield* visible(actor, ruleId);
        yield* write.delete(episodeHistory).where(historyWhere(rule)).pipe(Effect.orDie);
        yield* replan;
        return { count: 0 };
      }),
  };
});

/** Recording rules (series recordings), their previews, offers and history. */
export class Rules extends Context.Service<Rules, Effect.Success<typeof makeRules>>()(
  "@slipstream/server/Rules",
) {
  static readonly layer = Layer.effect(Rules, makeRules);
}
