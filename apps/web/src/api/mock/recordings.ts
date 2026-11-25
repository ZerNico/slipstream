import { DateTime, Effect } from "effect";
import { HttpApiBuilder } from "effect/http-api";
import {
  Conflict,
  CurrentUser,
  InvalidInput,
  type RecordingEntry,
  type RetentionCandidate,
  SlipstreamApi,
} from "@slipstream/api";
import {
  applyRetention,
  canSeeDestination,
  DAY,
  defaultExtraTime,
  epochMs,
  eventOf,
  exportPath,
  findDuplicate,
  governingRetention,
  historyEntryFor,
  isAnchor,
  isRecorded,
  needsRepeat,
  overlaps,
  type PathLabels,
  RecordingId,
  rerunState,
  type Retention,
} from "@slipstream/domain";
import { type MockData, mockTimeZone, toEntry } from "./fixtures.ts";
import { type MockContext, notFound, now } from "./context.ts";
import { accessOf } from "./household.ts";
import { currentPlan, listed, originalOf, planningContext, withRerun } from "./series.ts";

/** English path words for export paths, the way the server renders them for the library folder. */
const exportLabels: PathLabels = {
  other: "Other",
  films: "Films",
  season: (season) => `Season ${season}`,
  episode: (episode, subtitle) =>
    subtitle === undefined ? `Episode ${episode}` : `Episode ${episode} - ${subtitle}`,
  month: (year, month) => `${year}-${String(month).padStart(2, "0")}`,
  airing: (start) => DateTime.formatIso(start).slice(0, 16).replace("T", " "),
  film: (title, year) => (year === undefined ? title : `${title} (${year})`),
};

/** The library folder the mock exports to (Settings › Storage, `{library}`). */
const libraryRoot = "/media/tv";

/**
 * Adds the absolute export path the server reports: where a finished recording was exported,
 * or where a scheduled or running one will be. Nothing for a failed one.
 */
const withExportPath = (entry: RecordingEntry): RecordingEntry =>
  entry.state === "failed" || entry.state === "cancelled"
    ? entry
    : { ...entry, exportPath: `${libraryRoot}/${exportPath(entry.group, exportLabels, "mkv")}` };

/** How long a replaced original may come back ("Keep the original"), like the server's. */
const keepOriginalMillis = 7 * DAY;

/**
 * On a repeat, whether it replaced its original and until when that can be undone, the way the
 * server fills `replaces`: `replacedAt` while the original is hidden as replaced by this repeat,
 * `keepUntil` while it is also no anchor and within the hidden retention.
 */
export const withReplaced = (
  data: Pick<MockData, "recordings">,
  entry: RecordingEntry,
  at: number,
): RecordingEntry => {
  if (entry.replaces === undefined) return entry;
  const original = data.recordings.find((r) => r.id === entry.replaces?.recordingId);
  const { replacedAt: _replacedAt, keepUntil: _keepUntil, ...ref } = entry.replaces;
  const hiddenAt = original?.hiddenAt;
  if (original === undefined || hiddenAt === undefined || original.replacedById !== entry.id) {
    return { ...entry, replaces: ref };
  }
  const until = epochMs(hiddenAt) + keepOriginalMillis;
  return {
    ...entry,
    replaces: {
      ...ref,
      replacedAt: hiddenAt,
      ...(isAnchor(original) || at >= until ? {} : { keepUntil: DateTime.makeUnsafe(until) }),
    },
  };
};

/**
 * The mock's `recordings` group: the library, scheduling, conflicts, retention.
 * The shared state is in context.ts.
 */
export const recordingsGroup = (ctx: MockContext) => {
  const { data, publish, personalise, findRecording } = ctx;
  const replaceRecording = (entry: RecordingEntry) => {
    data.recordings = data.recordings.map((r) => (r.id === entry.id ? entry : r));
    publish({ _tag: "RecordingChanged", recordingId: entry.id, state: entry.state });
    return entry;
  };

  /** Runs a recording lookup or change and answers with the caller's view of it. */
  const forCaller = <E, R>(effect: Effect.Effect<RecordingEntry, E, R>) =>
    Effect.gen(function* () {
      const entry = yield* effect;
      const user = yield* CurrentUser;
      const at = Date.now();
      const plan = currentPlan(data, at);
      return withReplaced(
        data,
        withRerun(data, withExportPath(personalise(entry, user)), plan, at),
        at,
      );
    });

  /** What retention would delete now, policy by policy, like the server's sweeper. */
  const retentionCandidates = (): RetentionCandidate[] => {
    const at = now();
    const candidates: RetentionCandidate[] = [];
    const governed = new Map<
      string,
      { policy: Retention; from: RetentionCandidate["policyFrom"]; items: RecordingEntry[] }
    >();
    for (const entry of data.recordings) {
      const collection = data.collections.find((c) => c.id === entry.group.collectionId);
      const rule = data.rules.find((r) => r.id === entry.ruleId);
      const governing = governingRetention(collection, rule);
      if (governing === undefined || governing.retention._tag === "KeepAll") continue;
      const { retention: policy, from } = governing;
      const key = from._tag === "Collection" ? `c:${from.collectionId}` : `r:${from.ruleId}`;
      const group = governed.get(key) ?? { policy, from, items: [] };
      group.items.push(entry);
      governed.set(key, group);
    }
    for (const { policy, from, items } of governed.values()) {
      const collection =
        from._tag === "Collection"
          ? data.collections.find((c) => c.id === from.collectionId)
          : undefined;
      // A chain still looking for (or with) a repeat is never deleted; one counts per episode.
      const plan = currentPlan(data, epochMs(at));
      const verdict = applyRetention(
        policy,
        items.map((entry) => ({
          entry,
          id: entry.id,
          replacesId: entry.replacesId,
          hiddenAt: entry.hiddenAt,
          rerun: withRerun(data, entry, plan, epochMs(at)).rerun?.state,
          start: entry.start,
          end: entry.end,
          state: entry.state,
          protected: entry.protected,
          event: collection === undefined ? undefined : eventOf(collection, entry, mockTimeZone),
        })),
        epochMs(at),
      );
      for (const { item, reason } of verdict.remove) {
        candidates.push({ recordingId: item.entry.id, reason, policyFrom: from });
      }
    }
    return candidates;
  };

  return HttpApiBuilder.group(SlipstreamApi, "recordings", (handlers) =>
    handlers
      .handle("list", ({ query }) =>
        Effect.gen(function* () {
          const user = yield* CurrentUser;
          const access = accessOf(data, user);
          const at = Date.now();
          const plan = currentPlan(data, at);
          return data.recordings
            .filter(listed)
            .map((entry) =>
              withReplaced(
                data,
                withRerun(data, withExportPath(personalise(entry, user)), plan, at),
                at,
              ),
            )
            .filter(
              (r) =>
                canSeeDestination(access, {
                  channelId: r.channelId,
                  collectionId: r.group.collectionId,
                }) &&
                (query.state === undefined || r.state === query.state) &&
                (query.channelId === undefined || r.channelId === query.channelId) &&
                (query.ruleId === undefined || r.ruleId === query.ruleId) &&
                (query.collectionId === undefined || r.group.collectionId === query.collectionId) &&
                (query.watched === undefined || r.watched === query.watched) &&
                (!query.mine || r.ownerIds.includes(user.id)),
            );
        }),
      )
      .handle("get", ({ params }) => forCaller(findRecording(params.recordingId)))
      .handle("create", ({ payload }) =>
        Effect.gen(function* () {
          const user = yield* CurrentUser;
          if (payload._tag === "Manual") {
            return yield* Effect.fail(
              new InvalidInput({ problems: [{ path: "", code: "notInMock" }] }),
            );
          }
          const programme = data.programmes.find((p) => p.id === payload.programmeId);
          if (programme === undefined) return yield* notFound("programme", payload.programmeId);
          if (findDuplicate({ ...programme, programmeId: programme.id }, data.recordings)) {
            return yield* Effect.fail(new Conflict({ code: "alreadyScheduled" }));
          }
          const { id: programmeId, ...info } = programme;
          const airing = epochMs(programme.start) <= Date.now();
          const entry = toEntry(
            {
              id: RecordingId.make(crypto.randomUUID()),
              programmeId,
              ...info,
              // Without padding the household default applies: channel beats category beats global.
              padding:
                payload.padding ??
                defaultExtraTime(data.household.recording.extraTime, {
                  channelIds: [programme.channelId],
                  categories: programme.categories,
                }).padding,
              ...(payload.collectionId === undefined
                ? {}
                : { pinnedCollectionId: payload.collectionId }),
              state: airing ? "recording" : "scheduled",
              problems: [],
              ownerIds: [user.id],
              protected: false,
              labels: [],
              exportStatus: "none",
              createdAt: now(),
            },
            data,
            0,
          );
          data.recordings = [...data.recordings, entry];
          publish({ _tag: "RecordingChanged", recordingId: entry.id, state: entry.state });
          return entry;
        }),
      )
      .handle("update", ({ params, payload }) =>
        forCaller(
          Effect.map(findRecording(params.recordingId), (entry) => {
            const { pinnedCollectionId, ...rest } = payload;
            const { pinnedCollectionId: _pinned, ...withoutPin } = entry;
            const changed = {
              ...(pinnedCollectionId === null ? withoutPin : entry),
              ...rest,
              ...(pinnedCollectionId ? { pinnedCollectionId } : {}),
            };
            return replaceRecording(
              pinnedCollectionId === undefined ? changed : toEntry(changed, data, entry.sizeBytes),
            );
          }),
        ),
      )
      .handle("stop", ({ params }) =>
        forCaller(
          Effect.flatMap(findRecording(params.recordingId), (entry) =>
            entry.state === "recording"
              ? Effect.succeed(replaceRecording({ ...entry, state: "completed", end: now() }))
              : Effect.fail(new Conflict({ code: "notRecording" })),
          ),
        ),
      )
      .handle("remove", ({ params, query }) =>
        Effect.map(findRecording(params.recordingId), (entry) => {
          const at = Date.now();
          const rule = data.rules.find((r) => r.id === entry.ruleId);
          const damaged = needsRepeat(entry);
          const looking =
            damaged && rerunState(entry, [], [], at)?.state === "looking" && query.rerun !== "stop";
          if (looking) {
            // Plain Delete keeps looking for the repeat: the row stays hidden as the chain's
            // anchor (§3.7 step 7).
            replaceRecording({ ...entry, hiddenAt: now(), hiddenReason: "deleted" });
            return;
          }
          // Deleting a good episode of "Only episodes you don't have yet" remembers it for each
          // owner, unless the person asked to record it again when repeated (§3.6).
          const good = isRecorded(entry);
          if (good && !damaged && rule?.skipRepeats === true && query.history !== "skip") {
            const context = planningContext(data, at);
            data.history = [
              ...data.history,
              ...entry.ownerIds.map((userId) =>
                historyEntryFor(entry, { userId, ruleId: rule.id }, context),
              ),
            ];
          }
          data.recordings = data.recordings.filter((r) => r.id !== entry.id);
          // The row is gone: its owners at removal (and admins) hear it, like on the server.
          publish({ _tag: "RecordingRemoved", recordingId: entry.id, ownerIds: entry.ownerIds });
        }),
      )
      .handle("keepOriginal", ({ params }) =>
        Effect.gen(function* () {
          yield* findRecording(params.recordingId);
          const original = originalOf(data, params.recordingId);
          // Only a recording this repeat replaced comes back: never an anchor (deleted by hand,
          // hidden only while its search for a repeat runs) or one another repeat replaced.
          if (
            original === undefined ||
            original.hiddenAt === undefined ||
            original.replacedById !== params.recordingId ||
            isAnchor(original)
          ) {
            return yield* Effect.fail(new Conflict({ code: "notReplaced" }));
          }
          const {
            hiddenAt: _hidden,
            hiddenReason: _reason,
            replacedById: _replaced,
            ...rest
          } = original;
          return yield* forCaller(
            Effect.succeed(replaceRecording({ ...rest, rerunOutcome: "kept" })),
          );
        }),
      )
      .handle("conflicts", ({ query }) =>
        Effect.sync(() =>
          data.conflicts.filter((c) => overlaps(c.range, { start: query.from, end: query.to })),
        ),
      )
      .handle("retention", () => Effect.sync(retentionCandidates)),
  );
};
