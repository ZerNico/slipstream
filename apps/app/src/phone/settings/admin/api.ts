import type { PlaybackSettings, RecordingSettings } from "@slipstream/api";
import type { LiveKeep } from "@slipstream/domain";
import { m } from "@slipstream/i18n";
import { Effect, Predicate } from "effect";
import { Api } from "../../../api/client.ts";

/* The writes of Settings › Recording, Playback and Storage on a phone; their reads are shared. */

/** The settings writes, as effects for the session's `runAction`. */
export const adminSettingsActions = {
  /** Saves the recording defaults; changing a default never rewrites existing rules. */
  saveRecording: (settings: RecordingSettings) =>
    Effect.flatMap(Api, (api) => api.settings.saveRecording({ payload: settings })),
  /** Saves how long live TV keeps running and its rewind buffer after viewers leave. */
  saveLive: (settings: LiveKeep) =>
    Effect.flatMap(Api, (api) => api.settings.saveLive({ payload: settings })),
  /** Connects TMDB with a key, or disconnects it with `null`. */
  saveArtwork: (tmdbKey: string | null) =>
    Effect.flatMap(Api, (api) => api.settings.saveArtwork({ payload: { tmdbKey } })),
  savePlayback: (settings: PlaybackSettings) =>
    Effect.flatMap(Api, (api) => api.settings.savePlayback({ payload: settings })),
};

/**
 * Why TMDB refused a key, from the server's answer: it does not accept the key, or it could not
 * be reached (also for any other failure, which retrying may fix).
 */
export const tmdbProblem = (error: unknown): string => {
  const invalid =
    Predicate.isTagged(error, "InvalidInput") &&
    Predicate.hasProperty(error, "problems") &&
    Array.isArray(error.problems) &&
    error.problems.some(
      (problem: unknown) => Predicate.hasProperty(problem, "code") && problem.code === "invalidKey",
    );
  return invalid ? m.rec_tmdb_invalid() : m.rec_tmdb_unreachable();
};
