import type { PlaybackSession, PlaybackSessionUpdate } from "@slipstream/api";
import type { NetworkKind, QualityRequest } from "@slipstream/domain";
import { DateTime } from "effect";
import * as Network from "expo-network";
import { useCallback, useEffect, useRef, useState } from "react";
import { resolveServerUrl } from "../api/client.ts";
import { apiActions } from "../api/queries.ts";
import { useSession } from "../session/session-context.ts";
import {
  samePlaylist,
  networkKindFor,
  sessionRequest,
  startSession,
  type PlayTarget,
  type SessionFailure,
} from "./playback.ts";
import { startRenewal, type Renewal } from "./renewal.ts";

/** A started playback session, ready for the player. */
export interface ReadySession {
  readonly id: PlaybackSession["id"];
  /** Absolute playlist URL with the server's short-lived signed token; renewals replace it. */
  readonly uri: string;
  /** Resume or start-over instant (epoch ms), when the server named one. */
  readonly startAt: number | undefined;
}

/** Where the session stands. */
export type SessionState =
  | { readonly _tag: "Starting" }
  | { readonly _tag: "Ready"; readonly session: ReadySession }
  | { readonly _tag: "Failed"; readonly failure: SessionFailure };

/** How the device is connected right now; the home network when that cannot be read. */
const currentNetwork = (): Promise<NetworkKind> =>
  Network.getNetworkStateAsync().then(
    (state) => networkKindFor(state.type),
    () => "lan" as const,
  );

const unexpected: SessionState = { _tag: "Failed", failure: { _tag: "Other" } };

/**
 * Starts a playback session for `target` (POST /playback/sessions with this device's
 * capabilities and whether it is on mobile data) and ends it when the player closes, so the
 * server can release the capture or conversion behind it. Closing while the session is still
 * being created does not abort the request: the server may already hold a capture for it, so
 * the hook waits for the answer and ends that session.
 *
 * While the session plays, its signed playlist URL is renewed before it expires (`startRenewal`)
 * and the new URL replaces `session.uri`; the player keeps its position across the swap.
 * `recover` renews right away after the server refused the playlist or a segment (401/403),
 * once until `playing` reports playback works again. `update` reports a new speed;
 * `changeQuality` asks for another quality on the same session and swaps in the playlist the
 * server answers with (the player keeps its position across the swap, as for a renewal). The
 * session starts with `quality`, read once. Pass a memoised `target`: a new object starts a new
 * session.
 */
export const usePlaybackSession = (
  target: PlayTarget | undefined,
  quality: QualityRequest = { _tag: "Auto" },
): {
  readonly state: SessionState;
  readonly update: (patch: PlaybackSessionUpdate) => void;
  readonly changeQuality: (quality: QualityRequest) => void;
  readonly recover: () => boolean;
  readonly playing: () => void;
} => {
  const { stored, runAction } = useSession();
  const baseUrl = stored.server?.url;
  const [state, setState] = useState<SessionState>({ _tag: "Starting" });
  const current = useRef<ReadySession["id"] | undefined>(undefined);
  const renewal = useRef<Renewal | undefined>(undefined);
  // The quality the next session starts with; a change on a running session goes through
  // `changeQuality`, so it never restarts the session.
  const startQuality = useRef(quality);

  useEffect(() => {
    if (target === undefined || baseUrl === undefined) return;
    let closed = false;
    let started: ReadySession["id"] | undefined;
    let running: Renewal | undefined;
    const end = (id: ReadySession["id"]) => {
      runAction(apiActions.endPlayback(id)).catch(() => undefined);
    };
    const playlist = (session: PlaybackSession) => ({
      uri: resolveServerUrl(baseUrl, session.playlistUrl),
      expiresAt: DateTime.toEpochMillis(session.expiresAt),
    });
    currentNetwork()
      .then((network) =>
        runAction(startSession(sessionRequest(target, network, startQuality.current))),
      )
      .then((start) => {
        if (start._tag === "Refused") {
          if (!closed) setState({ _tag: "Failed", failure: start.failure });
          return;
        }
        const { session } = start;
        if (closed) {
          end(session.id);
          return;
        }
        started = session.id;
        current.current = session.id;
        const first = playlist(session);
        setState({
          _tag: "Ready",
          session: {
            id: session.id,
            uri: first.uri,
            startAt:
              session.startAt === undefined ? undefined : DateTime.toEpochMillis(session.startAt),
          },
        });
        running = startRenewal({
          expiresAt: first.expiresAt,
          renew: () => runAction(apiActions.updatePlayback(session.id, {})).then(playlist),
          onRenewed: (uri) =>
            setState((previous) =>
              previous._tag === "Ready" && previous.session.id === session.id
                ? { _tag: "Ready", session: { ...previous.session, uri } }
                : previous,
            ),
          onFailed: () => setState(unexpected),
        });
        renewal.current = running;
      })
      .catch(() => {
        if (!closed) setState(unexpected);
      });
    return () => {
      closed = true;
      current.current = undefined;
      running?.stop();
      renewal.current = undefined;
      if (started !== undefined) end(started);
    };
  }, [target, baseUrl, runAction]);

  const update = useCallback(
    (patch: PlaybackSessionUpdate) => {
      const id = current.current;
      if (id === undefined || baseUrl === undefined) return;
      // Not fatal: the stream keeps playing as it was. A fresh token for the same playlist waits
      // for the renewal timer (swapping would only interrupt playback); another playlist is
      // another conversion (passthrough turns stereo while catching up) and swaps in now.
      runAction(apiActions.updatePlayback(id, patch))
        .then((session) => {
          const uri = resolveServerUrl(baseUrl, session.playlistUrl);
          setState((previous) =>
            previous._tag === "Ready" &&
            previous.session.id === id &&
            !samePlaylist(previous.session.uri, uri)
              ? { _tag: "Ready", session: { ...previous.session, uri } }
              : previous,
          );
        })
        .catch(() => undefined);
    },
    [runAction, baseUrl],
  );

  const changeQuality = useCallback(
    (next: QualityRequest) => {
      startQuality.current = next;
      const id = current.current;
      if (id === undefined || baseUrl === undefined) return;
      runAction(apiActions.updatePlayback(id, { quality: next }))
        .then((session) => {
          const uri = resolveServerUrl(baseUrl, session.playlistUrl);
          setState((previous) =>
            previous._tag === "Ready" && previous.session.id === id
              ? { _tag: "Ready", session: { ...previous.session, uri } }
              : previous,
          );
        })
        // Not fatal: the stream keeps playing in the quality it had.
        .catch(() => undefined);
    },
    [runAction, baseUrl],
  );

  const recover = useCallback(() => renewal.current?.recover() ?? false, []);
  const playing = useCallback(() => renewal.current?.playing(), []);

  return { state, update, changeQuality, recover, playing };
};
