import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { DateTime, Effect } from "effect";
import type {
  PlaybackSession,
  PlaybackSessionUpdate,
  PlaybackSource,
  StreamLimitReason,
} from "@slipstream/api";
import {
  type NetworkKind,
  type QualityRequest,
  renewalDelayMillis,
  type SourceId,
} from "@slipstream/domain";
import { useApi } from "~/api/hooks.ts";
import { keys } from "~/api/queries.ts";
import { browserCapabilities } from "./capabilities.ts";

/** The server refused a live stream: no free watching stream, or this profile's limit. */
export interface StreamLimit {
  readonly _tag: "StreamLimit";
  readonly reason: StreamLimitReason;
  readonly sourceId?: SourceId;
}

/**
 * A refusal the player explains rather than fails on: the stream limit, a range the pause
 * buffer no longer holds (`RangeNotCaptured`), a range this profile may not watch (`Forbidden`).
 */
export type SessionRefusal = StreamLimit | { readonly _tag: "NotCaptured" | "Forbidden" };

/** What opening a session gave: a session, or a refusal. */
type SessionResult = PlaybackSession | SessionRefusal;

/** Whether a session result is a session to play. */
const isSession = (result: SessionResult | undefined): result is PlaybackSession =>
  result !== undefined && !("_tag" in result);

/** A failed renewal tries again this often before the token runs out, then gives up. */
const renewalAttempts = 3;

const sourceKey = (source: PlaybackSource): string =>
  source._tag === "Live"
    ? `live:${source.channelId}`
    : source._tag === "Recording"
      ? `recording:${source.recordingId}`
      : `range:${source.channelId}:${DateTime.toEpochMillis(source.range.start)}`;

/** How this browser is connected, for the "Auto" quality: cellular where the browser says so. */
export const networkKind = (): NetworkKind => {
  const connection = (navigator as Navigator & { connection?: { type?: string } }).connection;
  return connection?.type === "cellular" ? "mobile" : "lan";
};

/**
 * Opens a playback session for `source` while mounted: the browser reports what it can
 * decode, the server answers with a signed playlist URL, its delivery decision and where to
 * start (the resume position, or the programme start). A live stream the source has no room
 * for, a range the buffer no longer holds or may not be watched come back as a
 * {@link SessionRefusal}, not as an error. `update` tells the server about a new speed or quality (surround sound
 * turns stereo above 1×); its answer carries a new playlist URL.
 *
 * The playlist token is short-lived: five minutes before it expires (`renewalDelayMillis`) the
 * session renews itself with an empty update, and again after every renewal, so the player
 * swaps in the fresh URL and keeps playing. `renew` does the same on demand (the stream was
 * refused with 401/403). The timer stops on unmount and when the session changes. The session
 * ends on unmount so the server can stop any conversion it started. `attempt` opens a fresh
 * one (Try again).
 */
export function usePlaybackSession(
  source: PlaybackSource | undefined,
  quality: QualityRequest,
  attempt = 0,
) {
  const api = useApi();
  const key = source === undefined ? "none" : sourceKey(source);
  const query = useQuery({
    queryKey: keys.playbackSession(key, attempt),
    enabled: source !== undefined,
    queryFn: () =>
      api.call((client) =>
        client.playback
          .createSession({
            payload: {
              // Only runs while enabled, so there is a source.
              source: source as PlaybackSource,
              capabilities: browserCapabilities(),
              quality,
              network: networkKind(),
            },
          })
          .pipe(
            Effect.map((session): SessionResult => session),
            Effect.catchTag("StreamLimitReached", (error) =>
              Effect.succeed<SessionResult>({
                _tag: "StreamLimit",
                reason: error.reason,
                ...(error.sourceId === undefined ? {} : { sourceId: error.sourceId }),
              }),
            ),
            Effect.catchTag("RangeNotCaptured", () =>
              Effect.succeed<SessionResult>({ _tag: "NotCaptured" }),
            ),
            Effect.catchTag("Forbidden", () =>
              Effect.succeed<SessionResult>({ _tag: "Forbidden" }),
            ),
          ),
      ),
    // A session is a server resource: never share, refetch or revive it. Its short-lived token
    // is kept fresh by renewing the session (below), never by asking for another one.
    staleTime: Infinity,
    gcTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  // The latest answer to an update replaces the one the session started with.
  const [updated, setUpdated] = useState<PlaybackSession | undefined>(undefined);
  const created = isSession(query.data) ? query.data : undefined;
  const session = updated !== undefined && updated.id === created?.id ? updated : created;

  const id = created?.id;
  const queryClient = useQueryClient();
  useEffect(() => {
    if (id === undefined) return;
    return () => {
      // The ended session leaves the cache with it: a player mounted again before the cache
      // let go (gcTime counts from now) must open a fresh session, not play a dead token.
      queryClient.removeQueries({ queryKey: keys.playbackSession(key, attempt), exact: true });
      // Best effort: an expired or already-ended session is no reason to bother anyone.
      api
        .call((client) => client.playback.endSession({ params: { playbackSessionId: id } }))
        .catch(() => {});
    };
  }, [api, queryClient, id, key, attempt]);

  /** Sends `patch` and keeps the answer; undefined when the server refused or is gone. */
  const send = async (patch: PlaybackSessionUpdate): Promise<PlaybackSession | undefined> => {
    if (id === undefined) return undefined;
    try {
      const next = await api.call((client) =>
        client.playback.updateSession({ params: { playbackSessionId: id }, payload: patch }),
      );
      setUpdated(next);
      return next;
    } catch {
      return undefined;
    }
  };
  // The timer reads the latest `send`, so it never renews through a stale session.
  const sendRef = useRef(send);
  useEffect(() => {
    sendRef.current = send;
  });

  // Renews before the token expires, and again from each answer's expiry. A failed renewal
  // tries again (no sooner than the floor) a few times, then leaves it to the 401/403 path.
  // A new expiry (any update's answer) or another session starts the timer afresh.
  const expiresAt = session === undefined ? undefined : DateTime.toEpochMillis(session.expiresAt);
  useEffect(() => {
    if (id === undefined || expiresAt === undefined) return;
    let alive = true;
    let timer: number | undefined;
    let failures = 0;
    const schedule = (expiry: number) => {
      timer = window.setTimeout(
        () => {
          void sendRef.current({}).then((next) => {
            if (!alive) return;
            if (next !== undefined) {
              failures = 0;
              schedule(DateTime.toEpochMillis(next.expiresAt));
              return;
            }
            failures += 1;
            if (failures < renewalAttempts) schedule(expiry);
          });
        },
        renewalDelayMillis(expiry, Date.now()),
      );
    };
    schedule(expiresAt);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [id, expiresAt]);

  return {
    query,
    session,
    /** The server's refusal, for the player to explain. */
    refusal: query.data !== undefined && !isSession(query.data) ? query.data : undefined,
    /** Reports a new speed or quality. A server without the endpoint keeps the session as is. */
    update: async (patch: PlaybackSessionUpdate): Promise<void> => {
      // Not fatal when it fails: the stream keeps playing as it was.
      await send(patch);
    },
    /** Renews the playlist token now; the fresh playlist URL, or undefined when it failed. */
    renew: async (): Promise<string | undefined> => (await send({}))?.playlistUrl,
  };
}
