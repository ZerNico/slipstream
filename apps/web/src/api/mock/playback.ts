import { DateTime, Effect } from "effect";
import { HttpApiBuilder } from "effect/http-api";
import {
  CurrentUser,
  type PlaybackSession,
  RangeNotCaptured,
  SlipstreamApi,
  StreamLimitReached,
  type StreamLimitReason,
} from "@slipstream/api";
import { ChannelId, epochMs, HOUR, PlaybackSessionId, SourceId } from "@slipstream/domain";
import { type MockContext, notFound, now } from "./context.ts";

/**
 * Watching this channel live or from the start finds every watching stream of the source in
 * use, so the player's `streamLimitText` message can be seen in the mock.
 */
export const fullChannel = ChannelId.make("sky-sport-news");
const fullChannelReason: StreamLimitReason = "sourceFull";

/**
 * How far back the mock's timeshift buffer reaches. A start over (range session) older than
 * this answers `RangeNotCaptured`, the way the server does once its buffer has moved on.
 */
export const mockBufferMillis = 6 * HOUR;

/**
 * The mock's `playback` group: playback sessions, resume positions, continue watching.
 * The shared state is in context.ts.
 */
export const playbackGroup = (ctx: MockContext) => {
  const { data, playbackSessions, findRecording, options } = ctx;
  return HttpApiBuilder.group(SlipstreamApi, "playback", (handlers) =>
    handlers
      .handle("createSession", ({ payload }) =>
        Effect.gen(function* () {
          const user = yield* CurrentUser;
          const source = payload.source;
          if (source._tag !== "Recording" && source.channelId === fullChannel) {
            return yield* new StreamLimitReached({
              reason: fullChannelReason,
              sourceId: SourceId.make("tvproxy"),
            });
          }
          if (
            source._tag === "Range" &&
            epochMs(source.range.start) < Date.now() - mockBufferMillis
          ) {
            return yield* new RangeNotCaptured({
              channelId: source.channelId,
              range: source.range,
            });
          }
          let startAt: DateTime.Utc | undefined;
          if (source._tag === "Recording") {
            const recording = yield* findRecording(source.recordingId);
            const saved = data.playback.find(
              (state) =>
                state.userId === user.id &&
                state.target._tag === "Recording" &&
                state.target.recordingId === recording.id,
            );
            if (saved !== undefined && !saved.watched && saved.positionMillis > 0) {
              const start = epochMs(recording.start) - recording.padding.beforeMinutes * 60_000;
              startAt = DateTime.makeUnsafe(start + saved.positionMillis);
            }
          } else if (source._tag === "Range") {
            startAt = source.range.start;
          }
          const session: PlaybackSession = {
            id: PlaybackSessionId.make(crypto.randomUUID()),
            playlistUrl: options.playlistUrl ?? "/dev-stream/index.m3u8",
            ...(startAt ? { startAt } : {}),
            expiresAt: DateTime.makeUnsafe(Date.now() + 3_600_000),
          };
          playbackSessions.set(session.id, session);
          return session;
        }),
      )
      .handle("updateSession", ({ params }) =>
        Effect.suspend(() => {
          // The test stream plays as it is whatever the speed or quality: same session.
          const session = playbackSessions.get(params.playbackSessionId);
          return session
            ? Effect.succeed(session)
            : notFound("playbackSession", params.playbackSessionId);
        }),
      )
      .handle("endSession", ({ params }) =>
        Effect.sync(() => {
          playbackSessions.delete(params.playbackSessionId);
        }),
      )
      .handle("state", ({ params }) =>
        Effect.gen(function* () {
          const user = yield* CurrentUser;
          const found = data.playback.find(
            (state) =>
              state.userId === user.id &&
              state.target._tag === "Recording" &&
              state.target.recordingId === params.recordingId,
          );
          return found ?? (yield* notFound("recording", params.recordingId));
        }),
      )
      .handle("saveState", ({ payload }) =>
        Effect.gen(function* () {
          const user = yield* CurrentUser;
          const state = { ...payload, userId: user.id, updatedAt: now() };
          const same = (other: (typeof data.playback)[number]) =>
            other.userId === user.id &&
            JSON.stringify(other.target) === JSON.stringify(payload.target);
          data.playback = [...data.playback.filter((other) => !same(other)), state];
          return state;
        }),
      )
      .handle("continueWatching", () =>
        Effect.gen(function* () {
          const user = yield* CurrentUser;
          return data.playback.filter((state) => state.userId === user.id && !state.watched);
        }),
      ),
  );
};
