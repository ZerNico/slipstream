import type { PlaybackSession, PlaybackSessionRequest, StreamLimitReason } from "@slipstream/api";
import {
  type ChannelId,
  epochMs,
  type MediaCapabilities,
  type NetworkKind,
  type QualityRequest,
  type PlayTarget as PickedTarget,
  playTargetFor,
  type ProgrammeId,
  type Recording,
  type RecordingId,
} from "@slipstream/domain";
import { DateTime, Effect } from "effect";
import type { Api } from "../api/client.ts";
import { apiActions } from "../api/queries.ts";
import { assumedCapabilities } from "./capabilities.ts";
import type { PlayerProgress } from "./seek.ts";

/** Where playback starts: the oldest captured data, the live edge, or the server's resume point. */
export type StartAt = "start" | "live" | "resume";

/** What the player route plays, read from its search params. */
export type PlayTarget =
  | { readonly _tag: "Live"; readonly channelId: ChannelId; readonly from: StartAt }
  | { readonly _tag: "Recording"; readonly recordingId: RecordingId; readonly from: StartAt }
  | {
      readonly _tag: "Range";
      readonly channelId: ChannelId;
      readonly start: number;
      readonly end: number;
      readonly from: StartAt;
    };

/** The player route's search params, all strings as Expo Router hands them over. */
export interface PlayerParams {
  readonly kind?: string | undefined;
  readonly channelId?: string | undefined;
  readonly recordingId?: string | undefined;
  readonly start?: string | undefined;
  readonly end?: string | undefined;
  readonly from?: string | undefined;
}

const startAt = (value: string | undefined, fallback: StartAt): StartAt =>
  value === "start" || value === "live" || value === "resume" ? value : fallback;

const nonEmpty = (value: string | undefined): value is string =>
  value !== undefined && value.length > 0;

/** Reads the route params; undefined when they name nothing playable. */
export const parsePlayerParams = (params: PlayerParams): PlayTarget | undefined => {
  const kind: string = params.kind ?? "";
  switch (kind) {
    case "live":
      return nonEmpty(params.channelId)
        ? {
            _tag: "Live",
            channelId: params.channelId as ChannelId,
            from: startAt(params.from, "live"),
          }
        : undefined;
    case "recording":
      return nonEmpty(params.recordingId)
        ? {
            _tag: "Recording",
            recordingId: params.recordingId as RecordingId,
            from: startAt(params.from, "resume"),
          }
        : undefined;
    case "range": {
      const start = Number(params.start);
      const end = Number(params.end);
      return nonEmpty(params.channelId) &&
        Number.isFinite(start) &&
        Number.isFinite(end) &&
        end > start
        ? {
            _tag: "Range",
            channelId: params.channelId as ChannelId,
            start,
            end,
            from: startAt(params.from, "start"),
          }
        : undefined;
    }
    default:
      return undefined;
  }
};

/** Route params for a target, the inverse of {@link parsePlayerParams}. */
export const playerParams = (target: PlayTarget): Record<string, string> => {
  switch (target._tag) {
    case "Live":
      return { kind: "live", channelId: target.channelId, from: target.from };
    case "Recording":
      return { kind: "recording", recordingId: target.recordingId, from: target.from };
    case "Range":
      return {
        kind: "range",
        channelId: target.channelId,
        start: String(target.start),
        end: String(target.end),
        from: target.from,
      };
  }
};

/** The player route's target for what the domain picked to play (`playTargetFor`). */
export const routeTarget = (picked: PickedTarget): PlayTarget => {
  switch (picked._tag) {
    case "Live":
      return { _tag: "Live", channelId: picked.channelId, from: "live" };
    case "Recording":
      return { _tag: "Recording", recordingId: picked.recordingId, from: picked.from };
    case "Range":
      return {
        _tag: "Range",
        channelId: picked.channelId,
        start: epochMs(picked.range.start),
        end: epochMs(picked.range.end),
        from: "start",
      };
  }
};

/** What picking needs of the viewer's recordings (the library entries the app has). */
export type PickableRecording = Pick<
  Recording,
  "id" | "state" | "channelId" | "programmeId" | "title" | "subtitle" | "start" | "end"
>;

/**
 * A channel picked (a phone guide row, Home's "Watch live"): live, or when this profile has a
 * recording running on it, that recording from its live edge, so pausing and rewinding reach
 * back to where it started.
 */
export const channelPlayTarget = (
  channelId: ChannelId,
  recordings: readonly PickableRecording[],
  now: number,
): PlayTarget | undefined => {
  const picked = playTargetFor({ channelId, recordings, now });
  return picked === undefined ? undefined : routeTarget(picked);
};

/** A guide programme as the pick needs it. Times are epoch ms. */
export interface PickedProgramme {
  readonly programmeId: ProgrammeId;
  readonly channelId: ChannelId;
  readonly title: string;
  readonly subtitle?: string | undefined;
  readonly start: number;
  readonly end: number;
}

/**
 * A guide programme picked, resolved entirely by the domain's `playTargetFor`, which also decides
 * which of the viewer's recordings belong to the airing (`recordingsOfAiring`). Undefined before
 * it starts.
 */
export const programmePlayTarget = (
  programme: PickedProgramme,
  recordings: readonly PickableRecording[],
  now: number,
): PlayTarget | undefined => {
  const picked = playTargetFor({
    channelId: programme.channelId,
    programme: {
      ...programme,
      id: programme.programmeId,
      start: DateTime.makeUnsafe(programme.start),
      end: DateTime.makeUnsafe(programme.end),
    },
    recordings,
    now,
  });
  return picked === undefined ? undefined : routeTarget(picked);
};

/**
 * Why a playback session did not start, kept from the server's typed error so the player can
 * say it: every stream in use (the source's, or this profile's share), the stretch no longer
 * in pause & rewind, not allowed for this profile, gone, or anything else.
 */
export type SessionFailure =
  | { readonly _tag: "StreamLimitReached"; readonly reason: StreamLimitReason }
  | { readonly _tag: "RangeNotCaptured" }
  | { readonly _tag: "Forbidden" }
  | { readonly _tag: "NotFound" }
  | { readonly _tag: "Other" };

/** How asking for a playback session went: a session to play, or the server's refusal. */
export type SessionStart =
  | { readonly _tag: "Started"; readonly session: PlaybackSession }
  | { readonly _tag: "Refused"; readonly failure: SessionFailure };

/** What `playback.createSession` can fail with. */
type CreateSessionError = Effect.Error<ReturnType<typeof apiActions.startPlayback>>;

const refused = (failure: SessionFailure) =>
  Effect.succeed<SessionStart>({ _tag: "Refused", failure });

/**
 * Reads the typed error channel of `playback.createSession` into a {@link SessionStart}. The
 * refusals a player explains are caught by tag; anything else (offline, a server error) stays
 * an error, which the player shows as unexpected.
 */
export const sessionFailure = <R>(create: Effect.Effect<PlaybackSession, CreateSessionError, R>) =>
  create.pipe(
    Effect.map((session): SessionStart => ({ _tag: "Started", session })),
    Effect.catchTags({
      StreamLimitReached: (error) => refused({ _tag: "StreamLimitReached", reason: error.reason }),
      RangeNotCaptured: () => refused({ _tag: "RangeNotCaptured" }),
      Forbidden: () => refused({ _tag: "Forbidden" }),
      NotFound: () => refused({ _tag: "NotFound" }),
    }),
  );

/** Starts a playback session for `request`, its refusals read by {@link sessionFailure}. */
export const startSession = (request: PlaybackSessionRequest) =>
  sessionFailure<Api>(apiActions.startPlayback(request));

/** Media3's `ERROR_CODE_IO_BAD_HTTP_STATUS` (2004), as react-native-video prefixes it. */
const badHttpStatus = "22004";

/**
 * Whether a player error is the server refusing the playlist or a segment (HTTP 401 or 403):
 * the signed token in the URL expired or no longer opens it, so renewing the session can help.
 * react-native-video reports Media3's error code and the exception, which names the status.
 */
export const isAuthRefusal = (error: {
  readonly errorCode?: string | undefined;
  readonly errorException?: string | undefined;
  readonly errorStackTrace?: string | undefined;
}): boolean =>
  error.errorCode === badHttpStatus &&
  /Response code: 40[13]\b/u.test(`${error.errorException ?? ""}\n${error.errorStackTrace ?? ""}`);

/**
 * Whether two playlist URLs name the same playlist: only their query (the signed token)
 * differs. A converting session's playlist is named by its conversion, so another conversion is
 * another playlist, which the player has to load.
 */
export const samePlaylist = (a: string, b: string): boolean => withoutQuery(a) === withoutQuery(b);

const withoutQuery = (url: string): string => url.split("?")[0] ?? url;

/**
 * How this device is connected, for the server's "Auto" quality, from expo-network's connection
 * type: mobile data where it says so, else the home network (as on the web).
 */
export const networkKindFor = (connectionType: string | undefined): NetworkKind =>
  connectionType === "CELLULAR" ? "mobile" : "lan";

/**
 * The playback session request for a target over `network`, with what the device can play
 * (`deviceCapabilities` probes it natively; assumed without the probe).
 */
export const sessionRequest = (
  target: PlayTarget,
  network: NetworkKind = "lan",
  quality: QualityRequest = { _tag: "Auto" },
  capabilities: MediaCapabilities = assumedCapabilities,
): PlaybackSessionRequest => ({
  source:
    target._tag === "Live"
      ? { _tag: "Live", channelId: target.channelId }
      : target._tag === "Recording"
        ? { _tag: "Recording", recordingId: target.recordingId }
        : {
            _tag: "Range",
            channelId: target.channelId,
            range: {
              start: DateTime.makeUnsafe(target.start),
              end: DateTime.makeUnsafe(target.end),
            },
          },
  capabilities,
  quality,
  network,
  // Live from the start of the buffer or a resume point converts on its own (server limit).
  ...(target._tag === "Live" && target.from !== "live" ? { startsBehindLive: true } : {}),
});

/**
 * The seek position (seconds into the playlist) for a wall-clock instant, such as the session's
 * `startAt` resume point. react-native-video 6 does not report `#EXT-X-PROGRAM-DATE-TIME`, so
 * this needs the wall-clock time the playlist starts at: the padded start of a recording or
 * the start of a range. Undefined for live, whose window start the app does not know.
 */
export const positionForInstant = (
  progress: PlayerProgress,
  windowStart: number | undefined,
  instant: number,
): number | undefined => {
  if (windowStart === undefined) return undefined;
  const target = (instant - windowStart) / 1000;
  const end = Number.isFinite(progress.seekableDuration) ? progress.seekableDuration : target;
  return Math.min(Math.max(0, target), Math.max(0, end));
};
