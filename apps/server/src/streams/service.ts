/**
 * Streams (SPEC 7.9): each source's stream budget and who uses it right now, for the Server
 * strip, Settings › Sources and the player's "No free stream for watching" error, and stopping
 * someone's live stream to free one.
 *
 * One upstream stream is one channel capture: recordings and viewers of the same channel share
 * it. A stream with a recording on it counts as recording, every other one as watching.
 */
import { eq, inArray } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";
import { Forbidden, NotFound, type SourceStreams, type StreamUse } from "@slipstream/api";
import {
  ChannelId,
  PlaybackSessionId,
  RecordingId,
  SourceId,
  type User,
  UserId,
} from "@slipstream/domain";
import { Db } from "../db/client.ts";
import { toInstant } from "../db/codec.ts";
import { recordings, sources, users } from "../db/schema.ts";
import { loadViewer, seesChannel } from "../household/viewer.ts";
import { type LiveSession, Playback } from "../playback/service.ts";
import { type UpstreamStream, Recorder } from "../recorder/engine.ts";
import { retainedStartSql } from "../recordings/store.ts";

/** A source row with what the overview needs. */
interface SourceRow {
  readonly id: string;
  readonly name: string;
  readonly maxStreams: number | null;
  readonly keptForRecordings: number | null;
}

/** When a running recording started using its stream: its padded start, or the capture start. */
interface RecordingStart {
  readonly channelId: string;
  readonly startMs: number;
}

/**
 * Builds the overview from sources, running captures and live sessions. `showUser` decides
 * whether a viewer's user id is shown (guests do not learn who else watches).
 */
export const streamOverview = (input: {
  readonly sources: ReadonlyArray<SourceRow>;
  readonly streams: ReadonlyArray<UpstreamStream>;
  readonly live: ReadonlyMap<string, LiveSession>;
  readonly recordings: ReadonlyMap<string, RecordingStart>;
  readonly showUser: (userId: string) => boolean;
  readonly showChannel: (channelId: string) => boolean;
}): Array<SourceStreams> =>
  input.sources.map((source) => {
    const onSource = input.streams.filter((stream) => stream.sourceId === source.id);
    const recording = onSource.filter((stream) =>
      stream.consumers.some((consumer) => consumer.kind === "recording"),
    ).length;
    const uses = onSource.flatMap((stream): Array<StreamUse> => {
      if (!input.showChannel(stream.channelId)) return [];
      const channelId = ChannelId.make(stream.channelId);
      return stream.consumers.flatMap((consumer): Array<StreamUse> => {
        if (consumer.kind === "recording") {
          const known = input.recordings.get(consumer.id);
          const since = Math.max(known?.startMs ?? stream.startedAtMs, stream.startedAtMs);
          return [
            {
              _tag: "Recording",
              channelId,
              recordingId: RecordingId.make(consumer.id),
              since: toInstant(since),
            },
          ];
        }
        const session = consumer.kind === "live" ? input.live.get(consumer.id) : undefined;
        if (session === undefined) return [];
        return [
          {
            _tag: "Watching",
            channelId,
            playbackSessionId: PlaybackSessionId.make(session.id),
            since: toInstant(session.createdAt),
            ...(input.showUser(session.userId) ? { userId: UserId.make(session.userId) } : {}),
            ...(session.deviceName === undefined ? {} : { deviceName: session.deviceName }),
          },
        ];
      });
    });
    return {
      sourceId: SourceId.make(source.id),
      name: source.name,
      counts: {
        ...(source.maxStreams === null ? {} : { maxStreams: source.maxStreams }),
        keptForRecordings: source.keptForRecordings ?? 0,
        recording,
        watching: onSource.length - recording,
      },
      uses,
    };
  });

const makeStreams = Effect.gen(function* () {
  const { read } = yield* Db;
  const recorder = yield* Recorder;
  const playback = yield* Playback;

  const list = (actor: User) =>
    Effect.gen(function* () {
      const viewer = yield* loadViewer(read, actor);
      const sourceRows = yield* read
        .select({
          id: sources.id,
          name: sources.name,
          maxStreams: sources.maxStreams,
          keptForRecordings: sources.keptForRecordings,
        })
        .from(sources)
        .orderBy(sources.name)
        .pipe(Effect.orDie);
      const streams = yield* recorder.streams;
      const live = new Map((yield* playback.liveSessions).map((session) => [session.id, session]));
      const recordingIds = streams.flatMap((stream) =>
        stream.consumers.flatMap((consumer) =>
          consumer.kind === "recording" ? [consumer.id] : [],
        ),
      );
      const recordingRows =
        recordingIds.length === 0
          ? []
          : yield* read
              .select({
                id: recordings.id,
                channelId: recordings.channelId,
                startMs: retainedStartSql,
              })
              .from(recordings)
              .where(inArray(recordings.id, recordingIds))
              .pipe(Effect.orDie);
      return streamOverview({
        sources: sourceRows,
        streams,
        live,
        recordings: new Map(
          recordingRows.map((row) => [row.id, { channelId: row.channelId, startMs: row.startMs }]),
        ),
        showUser: (userId) => viewer.kind === "household" || userId === actor.id,
        showChannel: (channelId) => seesChannel(viewer, channelId),
      });
    });

  /**
   * Stops a live stream: your own, or as a household profile a household viewer's; admins stop
   * anyone's. Guests stop only their own.
   */
  const stopWatching = (actor: User, sessionId: string) =>
    Effect.gen(function* () {
      const session = (yield* playback.liveSessions).find(
        (candidate) => candidate.id === sessionId,
      );
      if (session === undefined) {
        return yield* new NotFound({ entity: "playbackSession", id: sessionId });
      }
      if (session.userId !== actor.id && actor.role !== "admin") {
        const viewer = yield* loadViewer(read, actor);
        const [owner] = yield* read
          .select({ kind: users.kind })
          .from(users)
          .where(eq(users.id, session.userId))
          .pipe(Effect.orDie);
        if (viewer.kind !== "household" || owner?.kind !== "household") {
          return yield* new Forbidden();
        }
      }
      yield* playback.stopLive(sessionId);
      yield* Effect.logInfo("Stopped a live stream").pipe(
        Effect.annotateLogs({ sessionId, by: actor.id }),
      );
    });

  return { list, stopWatching };
});

/** The stream budget overview. */
export class Streams extends Context.Service<Streams, Effect.Success<typeof makeStreams>>()(
  "@slipstream/server/Streams",
) {
  static readonly layer = Layer.effect(Streams, makeStreams);
}
