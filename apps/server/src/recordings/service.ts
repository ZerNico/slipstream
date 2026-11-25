/**
 * Recordings (PLAN 6.6): one-off recordings of a programme or a time range, the library with
 * group paths and placement explanations, red-flag changes, and stream-limit conflicts.
 *
 * The library is household-wide (`mine` filters it); changing or deleting a recording is for
 * its owners and admins. Two people recording the same programme share one recording. Entries
 * carry the caller's own watched state and resume position, and their artwork.
 *
 * Restricted profiles and guests (SPEC 7.8) see only recordings on their channels that land in
 * their collections, record only when allowed, and must send a collection-limited recording to
 * one of their own collections. One-off recordings without their own padding get the household
 * default extra time for the programme (`defaultExtraTime`: channel, then category, then global).
 *
 * Starting, stopping and settling recordings is the recorder's job (the `Recorder` service); this
 * service validates requests, keeps the library fields and answers queries.
 */
import { and, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { Clock, Context, DateTime, Effect, Layer } from "effect";
import {
  Conflict,
  Forbidden,
  InvalidInput,
  NotFound,
  type RecordingEntry,
  type RecordingRequest,
  type RecordingUpdate,
  type ReplacesRef,
  type ScheduleConflict,
} from "@slipstream/api";
import { keepOriginalUntil } from "@slipstream/recorder";
import {
  type ChainMember,
  type ChannelId,
  ChannelId as ChannelIdSchema,
  type CollectionId,
  defaultExtraTime,
  detectConflicts,
  type EpisodeHistoryEntry,
  explainPlacement,
  groupRecording,
  historyEntryFor,
  type Instant,
  isAnchor,
  needsRepeat,
  type Recording,
  RecordingId as RecordingIdSchema,
  type RecordingRef,
  type RecordingState,
  rerunState,
  type RuleId,
  type User,
  type UserId,
} from "@slipstream/domain";
import { ServerConfig } from "../config.ts";
import { Db } from "../db/client.ts";
import { toInstant } from "../db/codec.ts";
import {
  channels,
  collections,
  playbackStates,
  recordingDeclines,
  recordingLabels,
  recordingOwners,
  recordings,
  rules,
} from "../db/schema.ts";
import { recordingArtwork } from "../artwork/service.ts";
import { Guide } from "../guide/service.ts";
import {
  loadViewer,
  requireChannel,
  requireMayRecord,
  requireOwnDestination,
  seesRecording,
  visibleRecordings,
  type Viewer,
} from "../household/viewer.ts";
import { EventBus } from "../events.ts";
import { addHistory } from "../planning/history.ts";
import { Planning } from "../planning/service.ts";
import { Recorder } from "../recorder/engine.ts";
import { Settings } from "../settings/service.ts";
import { loadStreamLimits } from "../sources/limits.ts";
import {
  deleteRecording,
  loadChannelNames,
  loadCollections,
  loadRecording,
  loadRecordings,
  loadRuleCollections,
  recordingSizes,
  retainedRange,
  type StoredRecording,
} from "./store.ts";
import { liveChannel } from "../channels/lineup.ts";

/** The longest manual time range. */
const MAX_MANUAL_MILLIS = 24 * 3_600_000;

/** What deleting a recording was asked to do (`DELETE /recordings/:id?history&rerun`). */
export interface RecordingRemoval {
  /** "Delete, record it again when repeated": no history row. */
  readonly history?: "skip" | undefined;
  /** "Delete and stop looking for a repeat". */
  readonly rerun?: "stop" | undefined;
}

/** Filters for the library list. */
export interface RecordingFilter {
  readonly state?: RecordingState | undefined;
  readonly channelId?: ChannelId | undefined;
  readonly ruleId?: RuleId | undefined;
  readonly collectionId?: CollectionId | undefined;
  readonly mine?: boolean | undefined;
  readonly watched?: boolean | undefined;
}

/** The caller's playback state of a recording, as library entries show it. */
interface Progress {
  readonly watched: boolean;
  readonly positionMillis: number;
}

const unwatched: Progress = { watched: false, positionMillis: 0 };

const isOwner = (actor: User, recording: Recording) =>
  recording.ownerIds.some((ownerId) => ownerId === actor.id);

const ACTIVE: ReadonlyArray<RecordingState> = ["scheduled", "recording"];

/**
 * Stopping a recording, moving it, changing its extra time or protection changes it for every
 * owner, so a shared recording takes an admin or its sole owner (like deleting it does). Labels
 * stay open to every owner.
 */
const requireSole = (actor: User, recording: Recording) =>
  actor.role === "admin" || recording.ownerIds.length === 1
    ? Effect.void
    : Effect.fail(new Forbidden());

const makeRecordings = Effect.gen(function* () {
  const { write, read } = yield* Db;
  const guide = yield* Guide;
  const recorder = yield* Recorder;
  const config = yield* ServerConfig;
  const settings = yield* Settings;
  const bus = yield* EventBus;
  const planning = yield* Planning;

  /** Everything grouping needs that is the same for every recording in one listing. */
  const groupingContext = Effect.gen(function* () {
    const collectionList = yield* loadCollections(read);
    const ruleCollections = yield* loadRuleCollections(read);
    const channelNames = yield* loadChannelNames(read);
    const { artworkOrder } = yield* settings.recording;
    // Repeat chains (§3.7): every repeat with its original, and the originals they point at.
    const repeats = yield* read
      .select({
        id: recordings.id,
        start: recordings.start,
        channelId: recordings.channelId,
        state: recordings.state,
        replacesId: recordings.replacesId,
      })
      .from(recordings)
      .where(isNotNull(recordings.replacesId))
      .pipe(Effect.orDie);
    const originalIds = [...new Set(repeats.flatMap((row) => row.replacesId ?? []))];
    const originals =
      originalIds.length === 0
        ? []
        : yield* read
            .select({
              id: recordings.id,
              start: recordings.start,
              channelId: recordings.channelId,
              replacedById: recordings.replacedById,
              hiddenAt: recordings.hiddenAt,
              hiddenReason: recordings.hiddenReason,
            })
            .from(recordings)
            .where(inArray(recordings.id, originalIds))
            .pipe(Effect.orDie);
    const chains = new Map<string, Array<ChainMember>>();
    for (const row of repeats) {
      if (row.replacesId === null) continue;
      const member: ChainMember = {
        id: RecordingIdSchema.make(row.id),
        start: toInstant(row.start),
        channelId: ChannelIdSchema.make(row.channelId),
        state: row.state,
        replacesId: RecordingIdSchema.make(row.replacesId),
      };
      chains.set(row.replacesId, [...(chains.get(row.replacesId) ?? []), member]);
    }
    const now = yield* Clock.currentTimeMillis;
    // What a repeat's entry says about its original: when this repeat replaced it, and until
    // when "Keep the original" works. An anchor (deleted while its chain looked) never comes
    // back, whoever replaced it.
    const originalRefs = new Map(
      originals.map((row) => {
        const ref: RecordingRef = {
          recordingId: RecordingIdSchema.make(row.id),
          start: toInstant(row.start),
          channelId: ChannelIdSchema.make(row.channelId),
        };
        const replaced =
          row.replacedById !== null && row.hiddenAt !== null && row.hiddenReason !== "deleted"
            ? { by: row.replacedById, atMs: row.hiddenAt }
            : undefined;
        return [row.id, { ref, replaced }] as const;
      }),
    );
    return {
      collectionList,
      ruleCollections,
      channelNames,
      artworkOrder,
      chains,
      originalRefs,
      now,
    };
  });

  /** The actor's watched state and positions, by recording id. */
  const progressOf = (actor: User, recordingIds?: ReadonlyArray<string>) =>
    read
      .select({
        recordingId: playbackStates.targetId,
        watched: playbackStates.watched,
        positionMillis: playbackStates.positionMillis,
      })
      .from(playbackStates)
      .where(
        and(
          eq(playbackStates.userId, actor.id),
          eq(playbackStates.targetKind, "Recording"),
          recordingIds === undefined
            ? undefined
            : inArray(playbackStates.targetId, [...recordingIds]),
        ),
      )
      .pipe(
        Effect.map(
          (rows) =>
            new Map<string, Progress>(
              rows.map((row) => [
                row.recordingId,
                { watched: row.watched, positionMillis: Math.max(0, row.positionMillis) },
              ]),
            ),
        ),
        Effect.orDie,
      );

  const toEntry = (
    stored: StoredRecording,
    context: Effect.Success<typeof groupingContext>,
    progress: Progress,
    sizeBytes: number,
  ): RecordingEntry => {
    const { recording } = stored;
    const grouping = groupRecording(recording, context.collectionList, {
      timeZone: config.timeZone,
      channelName: (id) => context.channelNames.get(id),
      ruleCollectionId:
        recording.ruleId === undefined ? undefined : context.ruleCollections.get(recording.ruleId),
    });
    const original =
      recording.replacesId === undefined
        ? undefined
        : context.originalRefs.get(recording.replacesId);
    const replacedAtMs =
      original?.replaced?.by === recording.id ? original.replaced.atMs : undefined;
    const keepUntilMs = replacedAtMs === undefined ? undefined : keepOriginalUntil(replacedAtMs);
    const replaces: ReplacesRef | undefined =
      original === undefined
        ? undefined
        : {
            ...original.ref,
            ...(replacedAtMs === undefined ? {} : { replacedAt: toInstant(replacedAtMs) }),
            ...(keepUntilMs === undefined || keepUntilMs < context.now
              ? {}
              : { keepUntil: toInstant(keepUntilMs) }),
          };
    // Only an original has a search for its repeat; repeats point at it instead.
    const rerun =
      recording.replacesId === undefined
        ? rerunState(recording, context.chains.get(recording.id) ?? [], [], context.now)
        : undefined;
    return {
      ...recording,
      group: grouping.path,
      ...(grouping.placement === undefined
        ? {}
        : { placement: explainPlacement(grouping.placement) }),
      sizeBytes,
      watched: progress.watched,
      positionMillis: progress.positionMillis,
      artwork: recordingArtwork(stored, context.artworkOrder),
      ...(replaces === undefined ? {} : { replaces }),
      ...(rerun === undefined ? {} : { rerun }),
    } satisfies RecordingEntry;
  };

  /**
   * One library entry. A recording the actor does not see (`seesRecording`) does not exist, nor
   * does an anchor: a person deleted it, the row only holds its chain's search (§3.7 step 7).
   */
  const entryFor = (actor: User, recordingId: string) =>
    Effect.gen(function* () {
      const stored = yield* loadRecording(read, recordingId);
      const viewer = yield* loadViewer(read, actor);
      if (
        stored === undefined ||
        isAnchor(stored.recording) ||
        !(yield* seesRecording(read, viewer, stored, config.timeZone))
      )
        return yield* new NotFound({ entity: "recording", id: recordingId });
      const progress = yield* progressOf(actor, [recordingId]);
      const sizes = yield* recordingSizes(read, eq(recordings.id, recordingId));
      return toEntry(
        stored,
        yield* groupingContext,
        progress.get(recordingId) ?? unwatched,
        sizes.get(recordingId) ?? 0,
      );
    });

  /**
   * A recording the actor may change: one they see (others do not exist for them), and own,
   * unless they are an admin. Anchors do not exist either, except for deleting (`anchors`).
   */
  const changeable = (actor: User, recordingId: string, options: { anchors?: boolean } = {}) =>
    Effect.gen(function* () {
      const stored = yield* loadRecording(read, recordingId);
      const missing = new NotFound({ entity: "recording", id: recordingId });
      if (stored === undefined) return yield* missing;
      if (isAnchor(stored.recording) && options.anchors !== true) return yield* missing;
      const viewer = yield* loadViewer(read, actor);
      if (!(yield* seesRecording(read, viewer, stored, config.timeZone))) return yield* missing;
      if (actor.role !== "admin" && !isOwner(actor, stored.recording))
        return yield* new Forbidden();
      return { stored, viewer };
    });

  const list = (actor: User, filter: RecordingFilter) =>
    Effect.gen(function* () {
      const conditions = [
        // Replaced recordings, and damaged ones deleted while their repeat is looked for, are
        // out of the library (`get` still answers them).
        isNull(recordings.hiddenAt),
        filter.state === undefined ? undefined : eq(recordings.state, filter.state),
        filter.channelId === undefined ? undefined : eq(recordings.channelId, filter.channelId),
        filter.ruleId === undefined ? undefined : eq(recordings.ruleId, filter.ruleId),
        filter.mine === true
          ? inArray(
              recordings.id,
              read
                .select({ id: recordingOwners.recordingId })
                .from(recordingOwners)
                .where(eq(recordingOwners.userId, actor.id)),
            )
          : undefined,
      ];
      const viewer = yield* loadViewer(read, actor);
      const where = and(...conditions);
      const stored = yield* visibleRecordings(
        read,
        viewer,
        yield* loadRecordings(read, where),
        config.timeZone,
      );
      const context = yield* groupingContext;
      const progress = yield* progressOf(actor);
      const sizes = yield* recordingSizes(read, where);
      const entries = stored.map((item) =>
        toEntry(
          item,
          context,
          progress.get(item.recording.id) ?? unwatched,
          sizes.get(item.recording.id) ?? 0,
        ),
      );
      const filtered = entries.filter(
        (entry) =>
          (filter.collectionId === undefined || entry.group.collectionId === filter.collectionId) &&
          (filter.watched === undefined || entry.watched === filter.watched),
      );
      // Running recordings first, then the newest.
      return filtered.toSorted(
        (a, b) =>
          Number(b.state === "recording") - Number(a.state === "recording") ||
          DateTime.toEpochMillis(b.start) - DateTime.toEpochMillis(a.start),
      );
    });

  /** Checks the "Goes to" pick: an existing collection the viewer may record into. */
  const checkGoesTo = (viewer: Viewer, collectionId: string | undefined, path = "collectionId") =>
    Effect.gen(function* () {
      if (collectionId !== undefined) {
        const [collection] = yield* read
          .select({ id: collections.id })
          .from(collections)
          .where(eq(collections.id, collectionId))
          .pipe(Effect.orDie);
        if (collection === undefined) {
          return yield* new InvalidInput({
            problems: [{ path, code: "unknownCollection" }],
          });
        }
      }
      yield* requireOwnDestination(viewer, collectionId);
    });

  /**
   * Pins a recording to the "Goes to" pick when this request created it. Recording something the
   * household already records only adds the caller as an owner: the recording stays where it is.
   */
  const pin = (recording: Recording, createdFrom: number, collectionId: string | undefined) =>
    collectionId === undefined ||
    recording.pinnedCollectionId !== undefined ||
    DateTime.toEpochMillis(recording.createdAt) < createdFrom
      ? Effect.void
      : write
          .update(recordings)
          .set({ pinnedCollectionId: collectionId })
          .where(eq(recordings.id, recording.id))
          .pipe(Effect.asVoid, Effect.orDie);

  const create = Effect.fn("Recordings.create")(function* (actor: User, request: RecordingRequest) {
    const now = yield* Clock.currentTimeMillis;
    const viewer = yield* loadViewer(read, actor);
    yield* requireMayRecord(viewer);
    if (request._tag === "Programme") {
      const programme = yield* guide.programme(request.programmeId);
      yield* requireChannel(viewer, programme.channelId).pipe(
        Effect.mapError(() => new NotFound({ entity: "programme", id: request.programmeId })),
      );
      yield* checkGoesTo(viewer, request.collectionId);
      if (DateTime.toEpochMillis(programme.end) <= now) {
        return yield* new Conflict({ code: "programmeEnded" });
      }
      const padding =
        request.padding ??
        defaultExtraTime((yield* settings.recording).extraTime, {
          channelIds: [programme.channelId],
          categories: programme.categories,
        }).padding;
      const recording = yield* recorder.recordProgramme(programme.id, {
        ownerId: actor.id,
        padding,
      });
      yield* pin(recording, now, request.collectionId);
      return yield* entryFor(actor, recording.id);
    }

    yield* requireChannel(viewer, request.channelId);
    yield* checkGoesTo(viewer, request.collectionId);

    const [channel] = yield* read
      .select()
      .from(channels)
      .where(and(eq(channels.id, request.channelId), liveChannel))
      .pipe(Effect.orDie);
    if (channel === undefined)
      return yield* new NotFound({ entity: "channel", id: request.channelId });
    const startMs = DateTime.toEpochMillis(request.range.start);
    const endMs = DateTime.toEpochMillis(request.range.end);
    if (endMs <= startMs) {
      return yield* new InvalidInput({ problems: [{ path: "range.end", code: "beforeStart" }] });
    }
    if (endMs - startMs > MAX_MANUAL_MILLIS) {
      return yield* new InvalidInput({ problems: [{ path: "range.end", code: "rangeTooLong" }] });
    }
    if (endMs <= now) return yield* new Conflict({ code: "programmeEnded" });
    const recording = yield* recorder.recordRange({
      channelId: request.channelId,
      title: request.title,
      start: request.range.start,
      end: request.range.end,
      ownerId: actor.id,
    });
    yield* pin(recording, now, request.collectionId);
    return yield* entryFor(actor, recording.id);
  });

  const update = Effect.fn("Recordings.update")(function* (
    actor: User,
    recordingId: string,
    patch: RecordingUpdate,
  ) {
    const { stored, viewer } = yield* changeable(actor, recordingId);
    const { recording } = stored;
    if (
      patch.padding !== undefined ||
      patch.pinnedCollectionId !== undefined ||
      patch.protected !== undefined
    ) {
      yield* requireSole(actor, recording);
    }
    if (patch.pinnedCollectionId !== undefined) {
      // Unpinning (null) sends it back to Automatic, which a collection-limited profile cannot see.
      yield* checkGoesTo(viewer, patch.pinnedCollectionId ?? undefined, "pinnedCollectionId");
    }
    if (patch.padding !== undefined && !ACTIVE.includes(recording.state)) {
      return yield* new InvalidInput({ problems: [{ path: "padding", code: "notActive" }] });
    }
    yield* write
      .transaction((tx) =>
        Effect.gen(function* () {
          const changes = {
            ...(patch.protected === undefined ? {} : { protected: patch.protected }),
            ...(patch.pinnedCollectionId === undefined
              ? {}
              : { pinnedCollectionId: patch.pinnedCollectionId }),
            // A person set it: the rule's re-planning keeps it from now on.
            ...(patch.padding === undefined
              ? {}
              : {
                  paddingBeforeMinutes: patch.padding.beforeMinutes,
                  paddingAfterMinutes: patch.padding.afterMinutes,
                  paddingSource: "user" as const,
                }),
          };
          if (Object.keys(changes).length > 0) {
            yield* tx.update(recordings).set(changes).where(eq(recordings.id, recordingId));
          }
          if (patch.labels !== undefined) {
            const labels = [
              ...new Set(patch.labels.map((label) => label.trim()).filter((label) => label !== "")),
            ];
            yield* tx.delete(recordingLabels).where(eq(recordingLabels.recordingId, recordingId));
            if (labels.length > 0) {
              yield* tx
                .insert(recordingLabels)
                .values(labels.map((label) => ({ recordingId, label })));
            }
          }
        }),
      )
      .pipe(Effect.orDie);
    // The recorder reads the padded range on every tick; this makes it look now.
    if (patch.padding !== undefined) yield* recorder.replan;
    // Labels and pins move it between collections, and so between who may see it; its owners'
    // lists, and the cached plan (which asks who sees it), take it from here.
    yield* bus.publish({
      _tag: "RecordingChanged",
      recordingId: recording.id,
      state: recording.state,
    });
    return yield* entryFor(actor, recordingId);
  });

  /**
   * Ends a running recording now. The answer still says `recording`: it settles (completed,
   * incomplete or failed) a few seconds later, once the last segment has landed, and a
   * `RecordingChanged` event tells clients.
   */
  const stop = (actor: User, recordingId: string) =>
    Effect.gen(function* () {
      const { stored } = yield* changeable(actor, recordingId);
      yield* requireSole(actor, stored.recording);
      if (stored.recording.state !== "recording")
        return yield* new Conflict({ code: "notRecording" });
      yield* recorder.stop(stored.recording.id);
      return yield* entryFor(actor, recordingId);
    });

  /**
   * The history rows deleting a recording leaves for `owners` (§3.6): only for a good finished
   * recording (completed, or incomplete without needing a repeat) of a series recording set to
   * "Only episodes you don't have yet", and not when the person asked to record it again when
   * repeated. A recording that needs a repeat never leaves history.
   */
  const historyFor = (
    recording: Recording,
    owners: ReadonlyArray<UserId>,
    removal: RecordingRemoval,
    now: number,
  ) =>
    Effect.gen(function* () {
      const { ruleId } = recording;
      if (removal.history === "skip" || ruleId === undefined) return [];
      if (recording.state !== "completed" && recording.state !== "incomplete") return [];
      if (needsRepeat(recording)) return [];
      const [rule] = yield* read
        .select({ skipRepeats: rules.skipRepeats })
        .from(rules)
        .where(eq(rules.id, ruleId))
        .pipe(Effect.orDie);
      if (rule === undefined || !rule.skipRepeats) return [];
      const context = yield* planning.episodeContext(now);
      return owners.map((userId) => historyEntryFor(recording, { userId, ruleId }, context));
    });

  /**
   * A co-owner leaves a shared recording: they stop owning it and decline it, so re-planning
   * their rules does not make them an owner again. The others keep it as it is. Leaving a good
   * episode counts as deleting it for them (`historyFor`).
   */
  const leave = (actor: User, recording: Recording, history: ReadonlyArray<EpisodeHistoryEntry>) =>
    Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis;
      yield* write
        .transaction((tx) =>
          Effect.gen(function* () {
            yield* addHistory(tx, history, now);
            yield* tx
              .delete(recordingOwners)
              .where(
                and(
                  eq(recordingOwners.recordingId, recording.id),
                  eq(recordingOwners.userId, actor.id),
                ),
              );
            yield* tx
              .insert(recordingDeclines)
              .values({ recordingId: recording.id, userId: actor.id, declinedAt: now })
              .onConflictDoNothing();
          }),
        )
        .pipe(Effect.orDie);
      yield* bus.publish({
        _tag: "RecordingRemoved",
        recordingId: recording.id,
        ownerIds: [actor.id],
      });
    });

  /**
   * Deletes a recording (§3.6, §3.7). A good episode of a series recording that leaves out
   * repeats leaves history rows unless `history=skip`. A damaged one never does: a plain delete
   * of the original of a chain still looking for its repeat deletes its segments and keeps the
   * row hidden as the chain's anchor; `rerun=stop` ends the search and deletes it. Skipping a
   * planned repeat ends its chain's search too. Active rule recordings stay as tombstones.
   * Deleting an anchor again changes nothing, unless `rerun=stop`.
   */
  const remove = (actor: User, recordingId: string, removal: RecordingRemoval = {}) =>
    Effect.gen(function* () {
      const { stored } = yield* changeable(actor, recordingId, { anchors: true });
      const { recording } = stored;
      const now = yield* Clock.currentTimeMillis;
      if (isAnchor(recording)) {
        // Deleted already: it keeps the moment it was deleted. "Stop looking" ends its chain,
        // and with it the anchor.
        if (removal.rerun !== "stop") return;
        yield* recorder.declineRerun(recording.id);
        const removed = yield* deleteRecording(write, recordingId);
        if (removed !== undefined) yield* bus.publish(removed);
        return;
      }
      if (actor.role !== "admin" && recording.ownerIds.length > 1) {
        return yield* leave(
          actor,
          recording,
          yield* historyFor(recording, [actor.id], removal, now),
        );
      }
      if (ACTIVE.includes(recording.state)) {
        // Scheduled ones are cancelled, and a cancelled repeat ends its chain's search in the
        // recorder ("Skip this one", §3.7 step 7). Running ones end now and release their
        // capture first; deleting a running repeat stops its chain's search too.
        yield* recorder.stopAndSettle(recording.id);
        if (recording.state === "recording" && recording.replacesId !== undefined) {
          yield* recorder.declineRerun(recording.replacesId);
        }
        // Kept as a tombstone so the rule does not schedule the same airing again; the
        // recorder announced its end.
        if (recording.ruleId !== undefined) return;
      }
      if (needsRepeat(recording)) {
        if (removal.rerun === "stop") {
          if (recording.replacesId !== undefined) {
            yield* recorder.declineRerun(recording.replacesId);
          }
        } else if (recording.replacesId === undefined) {
          const chain = yield* read
            .select({
              id: recordings.id,
              start: recordings.start,
              channelId: recordings.channelId,
              state: recordings.state,
            })
            .from(recordings)
            .where(eq(recordings.replacesId, recording.id))
            .pipe(Effect.orDie);
          const search = rerunState(
            recording,
            chain.map((row) => ({
              id: RecordingIdSchema.make(row.id),
              start: toInstant(row.start),
              channelId: ChannelIdSchema.make(row.channelId),
              state: row.state,
              replacesId: recording.id,
            })),
            [],
            now,
          );
          if (search?.state === "looking" || search?.state === "scheduled") {
            return yield* hideAnchor(recording, now);
          }
        }
      }
      const history = yield* historyFor(recording, recording.ownerIds, removal, now);
      const removed = yield* deleteRecording(write, recordingId, { entries: history, now });
      if (removed !== undefined) yield* bus.publish(removed);
    });

  /**
   * Plain "Delete" of a damaged recording whose repeat is still looked for: the recorder hides
   * it as the chain's anchor and deletes its segments at once; the row stays until the chain
   * ends (§3.7 step 7). For people it is gone.
   */
  const hideAnchor = (recording: Recording, now: number) =>
    Effect.gen(function* () {
      yield* recorder.hideAnchor(recording.id, now);
      yield* bus.publish({
        _tag: "RecordingRemoved",
        recordingId: recording.id,
        ownerIds: recording.ownerIds,
      });
    });

  /**
   * "Keep the original" on a repeat that replaced a damaged recording (§3.7 step 3): within 7
   * days the original comes back beside the repeat and its search ends as `kept`. The recorder
   * refuses an anchor, an original this repeat did not replace, and after the 7 days.
   */
  const keepOriginal = (actor: User, repeatId: string) =>
    Effect.gen(function* () {
      const { stored } = yield* changeable(actor, repeatId);
      const now = yield* Clock.currentTimeMillis;
      const original = yield* recorder.keepOriginal(stored.recording.id, now);
      yield* bus.publish({
        _tag: "RecordingChanged",
        recordingId: original.id,
        state: original.state,
      });
      return yield* entryFor(actor, original.id);
    });

  /**
   * Stream-limit conflicts in `[from, to)`. Everyone else sees only conflicts made entirely of
   * recordings they can see; admins see all of them.
   */
  const conflicts = (actor: User, from: Instant, to: Instant) =>
    Effect.gen(function* () {
      const fromMs = DateTime.toEpochMillis(from);
      const toMs = DateTime.toEpochMillis(to);
      const active = (yield* loadRecordings(read, inArray(recordings.state, [...ACTIVE]))).filter(
        (stored) => {
          const range = retainedRange(stored);
          return range.startMs < toMs && range.endMs > fromMs;
        },
      );
      const viewer = yield* loadViewer(read, actor);
      const seen = new Set<string>(
        (yield* visibleRecordings(read, viewer, active, config.timeZone)).map(
          (stored) => stored.recording.id,
        ),
      );
      if (active.length === 0) return [];
      const limits = yield* loadStreamLimits(read);
      const found = detectConflicts(
        active.map((stored) => {
          const range = retainedRange(stored);
          return {
            id: stored.recording.id,
            channelId: stored.recording.channelId,
            range: { start: toInstant(range.startMs), end: toInstant(range.endMs) },
            kind: "recording" as const,
          };
        }),
        limits.channels,
        limits.sources,
      );
      const byId = new Map(
        active.map((stored) => [stored.recording.id as string, stored.recording.id]),
      );
      return found
        .map((conflict) => ({
          range: conflict.range,
          channelIds: conflict.channelIds,
          recordingIds: conflict.demandIds.flatMap((id) => byId.get(id) ?? []),
          sourceIds: conflict.sourceIds,
          capacity: conflict.capacity,
        }))
        .filter((conflict) => {
          // Every recording running during the conflict is part of it, not only those left
          // without a stream (`recordingIds`): who wins says something about the others too.
          const startMs = DateTime.toEpochMillis(conflict.range.start);
          const endMs = DateTime.toEpochMillis(conflict.range.end);
          return active.every((stored) => {
            const range = retainedRange(stored);
            const during = range.startMs < endMs && range.endMs > startMs;
            return !during || seen.has(stored.recording.id);
          });
        }) satisfies Array<typeof ScheduleConflict.Type>;
    });

  return {
    list,
    get: entryFor,
    create,
    update,
    stop,
    remove,
    keepOriginal,
    conflicts,
    retention: recorder.retention,
  };
});

/** The recordings library. */
export class Recordings extends Context.Service<
  Recordings,
  Effect.Success<typeof makeRecordings>
>()("@slipstream/server/Recordings") {
  static readonly layer = Layer.effect(Recordings, makeRecordings);
}
