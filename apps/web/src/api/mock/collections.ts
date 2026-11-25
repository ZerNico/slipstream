import { Effect } from "effect";
import { HttpApiBuilder } from "effect/http-api";
import { Conflict, InvalidInput, type SimilarItem, SlipstreamApi } from "@slipstream/api";
import {
  type Collection,
  CollectionId,
  type CollectionSubject,
  epochMs,
  extendMatcher,
  previewMatcherChange,
  type ProgrammeId,
  RecordingId,
} from "@slipstream/domain";
import { mockTimeZone } from "./fixtures.ts";
import { type MockContext, notFound, notInMock, now, requireAdmin } from "./context.ts";

/**
 * The mock's `collections` group: collections, suggestions, moving recordings.
 * The shared state is in context.ts.
 */
export const collectionsGroup = (ctx: MockContext) => {
  const { data, regroupAll, findRecording } = ctx;
  /** Recordings and upcoming programmes nothing records yet, as "move similar" sees them. */
  type SimilarSubject = CollectionSubject & {
    readonly recordingId?: RecordingId;
    readonly programmeId?: ProgrammeId;
  };
  const similarSubjects = (): SimilarSubject[] => {
    const recorded = new Set(data.recordings.map((entry) => entry.programmeId));
    const upcoming = data.programmes
      .filter((p) => epochMs(p.start) > Date.now() && !recorded.has(p.id))
      .map((p): SimilarSubject => ({ ...p, labels: [], programmeId: p.id }));
    return [
      ...data.recordings.map((entry): SimilarSubject => ({ ...entry, recordingId: entry.id })),
      ...upcoming,
    ];
  };

  const toSimilarItem = ({
    subject,
    from,
  }: {
    readonly subject: SimilarSubject;
    readonly from?: CollectionId | undefined;
  }): SimilarItem => ({
    ...(subject.recordingId === undefined ? {} : { recordingId: subject.recordingId }),
    ...(subject.programmeId === undefined ? {} : { programmeId: subject.programmeId }),
    channelId: subject.channelId,
    title: subject.title,
    start: subject.start,
    ...(from === undefined ? {} : { fromCollectionId: from }),
  });

  const findCollection = (id: CollectionId) =>
    Effect.suspend(() => {
      const found = data.collections.find((c) => c.id === id);
      return found ? Effect.succeed(found) : notFound("collection", id);
    });

  const replaceCollection = (collection: Collection) => {
    data.collections = data.collections.map((c) => (c.id === collection.id ? collection : c));
    regroupAll();
    return collection;
  };

  return HttpApiBuilder.group(SlipstreamApi, "collections", (handlers) =>
    handlers
      .handle("list", () => Effect.sync(() => data.collections))
      .handle("get", () => notInMock)
      .handle("create", ({ payload }) =>
        Effect.gen(function* () {
          yield* requireAdmin;
          const created: Collection = { ...payload, id: CollectionId.make(crypto.randomUUID()) };
          data.collections = [...data.collections, created];
          regroupAll();
          return created;
        }),
      )
      .handle("update", ({ params, payload }) =>
        Effect.gen(function* () {
          yield* requireAdmin;
          const found = yield* findCollection(params.collectionId);
          // A linked collection's conditions are its series recording's until it is unlinked.
          if (found.follows !== undefined && payload.matcher !== undefined) {
            return yield* new Conflict({ code: "followsRule" });
          }
          return replaceCollection({ ...found, ...payload });
        }),
      )
      .handle("unlink", ({ params }) =>
        Effect.gen(function* () {
          yield* requireAdmin;
          const { follows: _follows, ...own } = yield* findCollection(params.collectionId);
          return replaceCollection(own);
        }),
      )
      .handle("remove", ({ params }) =>
        Effect.gen(function* () {
          yield* requireAdmin;
          const found = yield* findCollection(params.collectionId);
          data.collections = data.collections.filter((c) => c.id !== found.id);
          // A series recording that recorded into it keeps recording, and is not offered it again.
          data.rules = data.rules.map((rule) => {
            if (rule.collectionId !== found.id) return rule;
            const { collectionId: _gone, ...rest } = rule;
            return { ...rest, offerDeclined: true };
          });
        }),
      )
      .handle("reorder", () => notInMock)
      .handle("previewSimilar", ({ params, payload }) =>
        Effect.gen(function* () {
          const collection = yield* findCollection(params.collectionId);
          const recording = yield* findRecording(payload.recordingId);
          const extension = extendMatcher(collection.matcher, recording, mockTimeZone);
          if (extension._tag !== "Extended") return { extension, past: [], future: [] };
          const preview = previewMatcherChange(
            data.collections,
            collection.id,
            extension.matcher,
            similarSubjects().filter((subject) => subject.recordingId !== recording.id),
            {
              timeZone: mockTimeZone,
              now: epochMs(now()),
              ruleCollection: (ruleId) => data.rules.find((r) => r.id === ruleId)?.collectionId,
            },
          );
          return {
            extension,
            past: preview.past.map(toSimilarItem),
            future: preview.future.map(toSimilarItem),
          };
        }),
      )
      .handle("moveSimilar", ({ params, payload }) =>
        Effect.gen(function* () {
          yield* requireAdmin;
          const collection = yield* findCollection(params.collectionId);
          const recording = yield* findRecording(payload.recordingId);
          const extension = extendMatcher(collection.matcher, recording, mockTimeZone);
          if (extension._tag === "CannotExtend") {
            return yield* Effect.fail(
              new InvalidInput({ problems: [{ path: "matcher", code: "cannotExtend" }] }),
            );
          }
          return extension._tag === "Extended"
            ? replaceCollection({ ...collection, matcher: extension.matcher })
            : collection;
        }),
      )
      .handle("preview", () => notInMock),
  );
};
