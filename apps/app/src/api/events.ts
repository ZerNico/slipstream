import { ServerEvent } from "@slipstream/api";
import type { RecordingId } from "@slipstream/domain";
import type { QueryClient } from "@tanstack/react-query";
import { Cause, Data, Effect, Option, Queue, Schedule, Schema, Stream } from "effect";
import type { Connection } from "./client.ts";
import { queryKeys, type QueryKey } from "./keys.ts";
import { feedSse, initialSse } from "./sse.ts";

/** The event stream ended or failed; the app reconnects with backoff. */
export class EventStreamLost extends Data.TaggedError("EventStreamLost")<{
  /** HTTP status when the server answered with an error, otherwise undefined. */
  readonly status: number | undefined;
}> {}

/**
 * The server answered 401: the device token was revoked or has expired. Reconnecting cannot
 * help, so the stream stops with this and the session forgets the profile.
 */
export class TokenRevoked extends Data.TaggedError("TokenRevoked") {}

/** Callbacks a transport reports to while one request is open. */
export interface SseHandlers {
  readonly onChunk: (text: string) => void;
  /** The request failed or the server answered with a non-2xx status. */
  readonly onError: (status: number | undefined) => void;
  /** The server closed the stream normally. */
  readonly onClose: () => void;
}

/**
 * Opens a long-lived GET and reports the body as it arrives. Returns a function that aborts
 * the request. The app uses XMLHttpRequest (see `xhrTransport`); tests use a fake.
 */
export interface SseTransport {
  readonly open: (
    request: { readonly url: string; readonly headers: Readonly<Record<string, string>> },
    handlers: SseHandlers,
  ) => () => void;
}

const decodeEvent = Schema.decodeUnknownOption(Schema.fromJsonString(ServerEvent));

/** Decodes one event's data; events this version does not know are skipped. */
export const parseServerEvent = (data: string): ServerEvent | undefined =>
  Option.getOrUndefined(decodeEvent(data));

/**
 * The events of one connection to `GET /events`, failing with `EventStreamLost` when the
 * request fails or closes, and with `TokenRevoked` on a 401. The request is aborted when the
 * stream is interrupted.
 */
export const eventStreamOnce = (
  transport: SseTransport,
  connection: Connection,
): Stream.Stream<ServerEvent, EventStreamLost | TokenRevoked> =>
  Stream.callback<ServerEvent, EventStreamLost | TokenRevoked>((queue) =>
    Effect.acquireRelease(
      Effect.sync(() => {
        let state = initialSse;
        const headers: Record<string, string> = { accept: "text/event-stream" };
        if (connection.token !== undefined) headers.authorization = `Bearer ${connection.token}`;
        return transport.open(
          { url: `${connection.baseUrl}/api/events`, headers },
          {
            onChunk: (text) => {
              const result = feedSse(state, text);
              state = result.state;
              for (const message of result.messages) {
                const event = parseServerEvent(message.data);
                if (event !== undefined) Queue.offerUnsafe(queue, event);
              }
            },
            onError: (status) =>
              Queue.failCauseUnsafe(
                queue,
                Cause.fail(status === 401 ? new TokenRevoked() : new EventStreamLost({ status })),
              ),
            onClose: () =>
              Queue.failCauseUnsafe(queue, Cause.fail(new EventStreamLost({ status: undefined }))),
          },
        );
      }),
      (abort) => Effect.sync(abort),
    ),
  );

/**
 * Backoff between reconnects: 1 s doubling, capped at 30 s, with jitter so a server restart
 * does not see every TV reconnect in the same instant. It resets once an event arrives; the
 * server sends `Connected` first on every connection, so each successful reconnect resets it.
 */
export const reconnectSchedule = Schedule.min([
  Schedule.exponential("1 second"),
  Schedule.spaced("30 seconds"),
]).pipe(Schedule.jittered);

/**
 * Live server events that survive drops: reconnects with {@link reconnectSchedule} after
 * `EventStreamLost`, and stops with `TokenRevoked`, which no reconnect can fix.
 */
export const serverEvents = (
  transport: SseTransport,
  connection: Connection,
): Stream.Stream<ServerEvent, EventStreamLost | TokenRevoked> =>
  eventStreamOnce(transport, connection).pipe(
    Stream.retry(
      reconnectSchedule.pipe(
        Schedule.setInputType<EventStreamLost | TokenRevoked>(),
        Schedule.while(({ input }) => input._tag === "EventStreamLost"),
      ),
    ),
  );

/** Everything live events keep fresh; all of it may be stale after a gap in the stream. */
const liveQueries: readonly QueryKey[] = [
  queryKeys.recordingsAll,
  queryKeys.recordOptionsAll,
  queryKeys.conflictsAll,
  queryKeys.continueWatching,
  queryKeys.guideAll,
  queryKeys.channels,
  queryKeys.collections,
  queryKeys.rules,
];

/**
 * Which cached queries an event makes stale. `Connected` after a reconnect marks everything
 * live as stale, since whatever changed while the stream was down sent no event; the first
 * `Connected` changes nothing, the queries were just fetched.
 */
export const invalidationsFor = (event: ServerEvent, reconnected: boolean): readonly QueryKey[] => {
  switch (event._tag) {
    case "Connected":
      return reconnected ? liveQueries : [];
    case "RecordingChanged":
    case "RecordingRemoved":
    case "RecordingReplaced":
      // A recording that changes can make an airing a repeat (or stop it being one).
      return [
        queryKeys.recordingsAll,
        queryKeys.recordOptionsAll,
        queryKeys.conflictsAll,
        queryKeys.continueWatching,
        queryKeys.guideRepeatsAll,
      ];
    case "CaptureChanged":
      return [queryKeys.recordingsAll];
    case "SourceHealthChanged":
      // No screen on the app shows source health yet.
      return [];
    case "GuideRefreshed":
      return [queryKeys.guideAll];
  }
};

/** What one server event changes in the query cache. */
export interface CacheUpdate {
  /** A recording that no longer exists for this profile: dropped from every cached list. */
  readonly removed?: RecordingId;
  /** Queries to mark stale. */
  readonly invalidate: readonly QueryKey[];
  /**
   * A repeat that replaced a damaged recording (`RecordingReplaced`): the app says so while it
   * is open ("Tatort replaced by the repeat from Wed 25").
   */
  readonly replaced?: RecordingId;
}

/** The cache update for one event; undefined when it changes nothing. */
export const cacheUpdateFor = (
  event: ServerEvent,
  reconnected: boolean,
): CacheUpdate | undefined => {
  const invalidate = invalidationsFor(event, reconnected);
  if (event._tag === "RecordingRemoved") return { removed: event.recordingId, invalidate };
  if (event._tag === "RecordingReplaced") return { replaced: event.id, invalidate };
  return invalidate.length === 0 ? undefined : { invalidate };
};

/**
 * Applies a cache update: a removed recording leaves the library lists and its own entry at
 * once (so Home, the library and the guide stop offering it before the refetch answers), then
 * the stale queries refetch.
 */
export const applyCacheUpdate = (client: QueryClient, update: CacheUpdate): Promise<void> => {
  const { removed } = update;
  if (removed !== undefined) {
    client.setQueriesData<readonly { readonly id: string }[]>(
      { queryKey: queryKeys.recordings },
      (list) => list?.filter((entry) => entry.id !== removed),
    );
    client.removeQueries({ queryKey: queryKeys.recording(removed), exact: true });
  }
  return Promise.all(
    update.invalidate.map((queryKey) => client.invalidateQueries({ queryKey })),
  ).then(() => undefined);
};

/**
 * The cache updates as {@link serverEvents} arrive, one per event that changes anything. Tells
 * a reconnect from the first connection by whether `Connected` came before.
 */
export const liveCacheUpdates = (
  transport: SseTransport,
  connection: Connection,
): Stream.Stream<CacheUpdate, EventStreamLost | TokenRevoked> =>
  serverEvents(transport, connection).pipe(
    Stream.mapAccum(
      () => false,
      (connectedBefore, event) => {
        const update = cacheUpdateFor(event, connectedBefore);
        return [
          connectedBefore || event._tag === "Connected",
          update === undefined ? [] : [update],
        ];
      },
    ),
  );
