/**
 * Collections (PLAN 6.6 Grouping): household-wide groups with a matcher and a layout. Everyone
 * reads them (a collection-limited profile only its own); admins edit, rank and preview them
 * against the existing library (previews and suggestions show the whole household's library, so
 * they are admin-only too). The preview uses the real placement precedence
 * (`previewCollection`): what would move into the draft, from where, and what it matches but
 * loses to another collection. Suggestions
 * propose collections for recordings no collection holds, and "also move similar ones" widens a
 * collection's matcher after a recording was moved into it by hand.
 */
import { eq, isNull } from "drizzle-orm";
import { Clock, Context, Effect, Layer } from "effect";
import {
  type CollectionInput,
  type CollectionPreview,
  type CollectionUpdate,
  Conflict,
  type InputProblem,
  InvalidInput,
  NotFound,
  type SimilarItem,
  type SimilarPreview,
} from "@slipstream/api";
import {
  type AffectedSubject,
  type Collection,
  CollectionId,
  type CollectionSubject,
  collectionOverlaps,
  extendMatcher,
  layoutProblems,
  linkProblems,
  matcherProblems,
  previewCollection,
  previewMatcherChange,
  type ProgrammeId,
  type RecordingId,
  type User,
} from "@slipstream/domain";
import { requireAdmin } from "../auth/service.ts";
import { ServerConfig } from "../config.ts";
import { Db } from "../db/client.ts";
import { collections, recordings, rules } from "../db/schema.ts";
import { Guide } from "../guide/service.ts";
import { loadViewer, seesCollection } from "../household/viewer.ts";
import { newId } from "../ids.ts";
import { EventBus } from "../events.ts";
import { PLANNING_HORIZON_MILLIS } from "../planning/service.ts";
import {
  loadChannelNames,
  loadCollections,
  loadFollowedRules,
  loadRecording,
  loadRecordings,
  loadRuleCollections,
  resolveCollection,
  toCollection,
} from "../recordings/store.ts";

/** A recording or upcoming programme that "also move similar ones" looks at. */
interface SimilarSubject extends CollectionSubject {
  readonly recordingId?: RecordingId | undefined;
  readonly programmeId?: ProgrammeId | undefined;
}

const toSimilarItem = ({ subject, from }: AffectedSubject<SimilarSubject>): SimilarItem => ({
  ...(subject.recordingId === undefined ? {} : { recordingId: subject.recordingId }),
  ...(subject.recordingId !== undefined || subject.programmeId === undefined
    ? {}
    : { programmeId: subject.programmeId }),
  channelId: subject.channelId,
  title: subject.title,
  start: subject.start,
  ...(from === undefined ? {} : { fromCollectionId: from }),
});

/** Editor checks: a valid layout, and a matcher that is valid and (without labels) restrictive. */
export const collectionProblems = (input: typeof CollectionInput.Type): Array<InputProblem> => [
  ...matcherProblems(input.matcher).flatMap((problem): Array<InputProblem> => {
    switch (problem._tag) {
      case "MatchesEverything":
        return input.labels.length > 0 ? [] : [{ path: "matcher", code: "matchesEverything" }];
      case "InvalidRegex":
        return [{ path: "matcher.title", code: "invalidRegex" }];
      case "UnsafeRegex":
        return [{ path: "matcher.title", code: "unsafeRegex" }];
      case "InvertedDuration":
        return [{ path: "matcher.maxDurationMinutes", code: "invertedDuration" }];
    }
  }),
  ...layoutProblems(input.layout).map((problem) => ({
    path: "layout",
    code:
      problem._tag === "UnknownVariable"
        ? "unknownVariable"
        : problem._tag === "ReservedPartName"
          ? "reservedPartName"
          : "duplicatePartName",
  })),
];

const check = (input: typeof CollectionInput.Type) => {
  const problems = collectionProblems(input);
  return problems.length === 0 ? Effect.void : Effect.fail(new InvalidInput({ problems }));
};

const makeCollections = Effect.gen(function* () {
  const { write, read } = yield* Db;
  const config = yield* ServerConfig;
  const guide = yield* Guide;
  const bus = yield* EventBus;

  // The link invariant of §3.4, checked once at startup: every write keeps it, so a break here
  // means a bug or a hand-edited database. It is only reported; resolving falls back safely.
  const broken = linkProblems(
    (yield* read.select().from(collections).pipe(Effect.orDie)).map(toCollection),
    yield* loadFollowedRules(read),
  );
  yield* Effect.forEach(
    broken,
    (problem) =>
      Effect.logWarning("Linked collection breaks the link invariant").pipe(
        Effect.annotateLogs({
          problem: problem._tag,
          collection: problem.collectionId,
          rule: problem.ruleId,
        }),
      ),
    { discard: true },
  );

  const findRow = (collectionId: string) =>
    Effect.gen(function* () {
      const [row] = yield* read
        .select()
        .from(collections)
        .where(eq(collections.id, collectionId))
        .pipe(Effect.orDie);
      if (row === undefined) return yield* new NotFound({ entity: "collection", id: collectionId });
      return row;
    });

  const preview = (
    actor: User,
    input: typeof CollectionInput.Type,
    editingId: string | undefined,
  ) =>
    Effect.gen(function* () {
      yield* requireAdmin(actor);
      yield* check(input);
      const draft: Collection = { ...input, id: CollectionId.make(editingId ?? "draft") };
      const library = yield* loadRecordings(read, isNull(recordings.hiddenAt));
      const byRule = yield* loadRuleCollections(read);
      const subjects = library.map(({ recording }) => ({
        ...recording,
        ruleCollectionId: recording.ruleId === undefined ? undefined : byRule.get(recording.ruleId),
      }));
      const others = yield* loadCollections(read);
      const channelNames = yield* loadChannelNames(read);
      const result = previewCollection(draft, others, subjects, {
        timeZone: config.timeZone,
        channelName: (id) => channelNames.get(id),
      });
      const overlaps = collectionOverlaps(
        draft,
        others.filter((collection) => collection.id !== draft.id),
        subjects,
        config.timeZone,
      ).map((overlap) => ({
        collectionId: overlap.collection.id,
        recordingIds: overlap.shared.map((recording) => recording.id),
      }));
      return {
        recordings: result.placed.map(({ subject, path, from }) => ({
          recordingId: subject.id,
          title: subject.title,
          group: path,
          from,
        })),
        overlaps,
        elsewhere: result.elsewhere.map(({ subject, collectionId, reason }) => ({
          recordingId: subject.id,
          title: subject.title,
          collectionId,
          reason,
        })),
      } satisfies typeof CollectionPreview.Type;
    });

  /** The collection, the moved recording, and how the matcher would widen to take it. */
  const similar = (collectionId: string, recordingId: string) =>
    Effect.gen(function* () {
      const collection = yield* resolveCollection(read, yield* findRow(collectionId));
      const stored = yield* loadRecording(read, recordingId);
      if (stored === undefined) {
        return yield* new NotFound({ entity: "recording", id: recordingId });
      }
      const extension = extendMatcher(
        collection.matcher,
        { ...stored.recording, subtitle: stored.recording.subtitle },
        config.timeZone,
      );
      return { collection, extension };
    });

  const previewSimilar = (actor: User, collectionId: string, recordingId: string) =>
    Effect.gen(function* () {
      yield* requireAdmin(actor);
      const { collection, extension } = yield* similar(collectionId, recordingId);
      if (extension._tag !== "Extended") {
        return { extension, past: [], future: [] } satisfies SimilarPreview;
      }
      const now = yield* Clock.currentTimeMillis;
      const library = (yield* loadRecordings(read, isNull(recordings.hiddenAt))).map(
        ({ recording }) => recording,
      );
      const recorded = new Set(library.flatMap((recording) => recording.programmeId ?? []));
      const upcoming = (yield* guide.between(now, now + PLANNING_HORIZON_MILLIS)).filter(
        (programme) => !recorded.has(programme.id),
      );
      const subjects: Array<SimilarSubject> = [
        ...library.map((recording) => ({ ...recording, recordingId: recording.id })),
        ...upcoming.map((programme) => ({
          ...programme,
          labels: [],
          programmeId: programme.id,
        })),
      ];
      const byRule = yield* loadRuleCollections(read);
      const moved = previewMatcherChange(
        yield* loadCollections(read),
        collection.id,
        extension.matcher,
        subjects,
        {
          timeZone: config.timeZone,
          now,
          ruleCollection: (id) => byRule.get(id),
        },
      );
      return {
        extension,
        past: moved.past.map(toSimilarItem),
        future: moved.future.map(toSimilarItem),
      } satisfies SimilarPreview;
    });

  const moveSimilar = (actor: User, collectionId: string, recordingId: string) =>
    Effect.gen(function* () {
      yield* requireAdmin(actor);
      const { collection, extension } = yield* similar(collectionId, recordingId);
      // A linked collection's conditions are its series recording's until it is unlinked.
      if (collection.follows !== undefined && extension._tag === "Extended") {
        return yield* new InvalidInput({ problems: [{ path: "matcher", code: "followsRule" }] });
      }
      switch (extension._tag) {
        case "AlreadyMatches":
          return collection;
        case "CannotExtend":
          return yield* new InvalidInput({
            problems: [{ path: "matcher", code: "cannotExtend" }],
          });
        case "Extended": {
          yield* write
            .update(collections)
            .set({ matcher: extension.matcher })
            .where(eq(collections.id, collectionId))
            .pipe(Effect.orDie);
          yield* bus.publishHouseholdChanged;
          return { ...collection, matcher: extension.matcher } satisfies Collection;
        }
      }
    });

  return {
    list: (actor: User) =>
      Effect.gen(function* () {
        const viewer = yield* loadViewer(read, actor);
        return (yield* loadCollections(read)).filter((collection) =>
          seesCollection(viewer, collection.id),
        );
      }),
    previewSimilar,
    moveSimilar,
    get: (actor: User, collectionId: string) =>
      Effect.gen(function* () {
        const viewer = yield* loadViewer(read, actor);
        if (!seesCollection(viewer, collectionId)) {
          return yield* new NotFound({ entity: "collection", id: collectionId });
        }
        return yield* resolveCollection(read, yield* findRow(collectionId));
      }),
    create: (actor: User, input: typeof CollectionInput.Type) =>
      Effect.gen(function* () {
        yield* requireAdmin(actor);
        yield* check(input);
        const row = { ...input, id: newId(), retention: input.retention ?? null, ruleId: null };
        yield* write.insert(collections).values(row).pipe(Effect.orDie);
        yield* bus.publishHouseholdChanged;
        return yield* resolveCollection(write, row);
      }),
    update: (actor: User, collectionId: string, patch: typeof CollectionUpdate.Type) =>
      Effect.gen(function* () {
        yield* requireAdmin(actor);
        const row = yield* findRow(collectionId);
        // A linked collection's conditions are its series recording's (§3.5).
        if (row.ruleId !== null && patch.matcher !== undefined) {
          return yield* new Conflict({ code: "followsRule" });
        }
        const current = yield* resolveCollection(read, row);
        const next = { ...current, ...patch };
        yield* check(next);
        yield* write
          .update(collections)
          .set({
            name: next.name,
            rank: next.rank,
            // A linked collection keeps its snapshot; the rule's saves rewrite it.
            ...(row.ruleId === null ? { matcher: next.matcher } : {}),
            labels: next.labels,
            layout: next.layout,
            retention: next.retention ?? null,
          })
          .where(eq(collections.id, collectionId))
          .pipe(Effect.orDie);
        yield* bus.publishHouseholdChanged;
        return next;
      }),
    /**
     * "Use its own conditions instead" (§3.5): the collection keeps a copy of the effective
     * matcher and stops following its series recording.
     */
    unlink: (actor: User, collectionId: string) =>
      Effect.gen(function* () {
        yield* requireAdmin(actor);
        const current = yield* resolveCollection(read, yield* findRow(collectionId));
        yield* write
          .update(collections)
          .set({ matcher: current.matcher, ruleId: null })
          .where(eq(collections.id, collectionId))
          .pipe(Effect.orDie);
        yield* bus.publishHouseholdChanged;
        const { follows: _follows, ...own } = current;
        return own satisfies Collection;
      }),
    /**
     * Deletes a collection. Series recordings that recorded into it go back to Automatic and keep
     * recording; the offer does not come back for them straight away (§3.4).
     */
    remove: (actor: User, collectionId: string) =>
      Effect.gen(function* () {
        yield* requireAdmin(actor);
        yield* findRow(collectionId);
        yield* write
          .transaction((tx) =>
            Effect.gen(function* () {
              yield* tx
                .update(rules)
                .set({ collectionId: null, offerDeclined: true })
                .where(eq(rules.collectionId, collectionId));
              yield* tx.delete(collections).where(eq(collections.id, collectionId));
            }),
          )
          .pipe(Effect.orDie);
        yield* bus.publishHouseholdChanged;
      }),
    /** Ranks collections in the given order; collections not listed keep their order after them. */
    reorder: (actor: User, ids: ReadonlyArray<string>) =>
      Effect.gen(function* () {
        yield* requireAdmin(actor);
        const all = yield* loadCollections(read);
        const known = new Set(all.map((collection) => collection.id as string));
        const problems = ids.flatMap((id, index) =>
          known.has(id) ? [] : [{ path: `collectionIds.${index}`, code: "unknownCollection" }],
        );
        if (problems.length > 0) return yield* new InvalidInput({ problems });
        const listed = new Set(ids);
        const order = [
          ...ids,
          ...all.flatMap((collection) => (listed.has(collection.id) ? [] : [collection.id])),
        ];
        yield* write
          .transaction((tx) =>
            Effect.forEach(
              order,
              (id, rank) => tx.update(collections).set({ rank }).where(eq(collections.id, id)),
              { discard: true },
            ),
          )
          .pipe(Effect.orDie);
        // Rank decides placement, and with it what a collection-limited profile sees.
        yield* bus.publishHouseholdChanged;
        return yield* loadCollections(read);
      }),
    preview,
  };
});

/** Collections and their previews. */
export class Collections extends Context.Service<
  Collections,
  Effect.Success<typeof makeCollections>
>()("@slipstream/server/Collections") {
  static readonly layer = Layer.effect(Collections, makeCollections);
}
