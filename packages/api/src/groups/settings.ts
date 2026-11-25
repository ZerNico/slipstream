import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/http-api";
import {
  ArtworkOrder,
  ExtraTimeDefaults,
  Instant,
  LiveKeep,
  PictureConversionLimit,
  QualityChoice,
} from "@slipstream/domain";
import { Forbidden, InvalidInput, NotFound } from "../errors.ts";
import { Authentication } from "../security.ts";

/**
 * Settings › Recording (SPEC 7.7, 7.4): the default extra time with its channel and category
 * overrides, and the artwork order. Clients resolve the default for a programme or rule draft
 * with `defaultExtraTime` / `describeExtraTime` from the domain, so every hint names the same
 * default the server applies.
 */
export const RecordingSettings = Schema.Struct({
  extraTime: ExtraTimeDefaults,
  artworkOrder: ArtworkOrder,
}).annotate({ identifier: "RecordingSettings" });
export type RecordingSettings = typeof RecordingSettings.Type;

/**
 * Pictures found online (Settings › Recording): whether a TMDB key is set. The key itself is
 * write-only, sealed at rest like source passwords and never sent back.
 */
export const ArtworkSettings = Schema.Struct({
  tmdb: Schema.Boolean,
}).annotate({ identifier: "ArtworkSettings" });
export type ArtworkSettings = typeof ArtworkSettings.Type;

/**
 * Sets the TMDB key (a v3 API key or a v4 read access token) or removes it with `null`. The
 * server tries the key first and answers `InvalidInput` with `{ path: "tmdbKey", code:
 * "invalidKey" }` when TMDB refuses it, or `code: "unreachable"` when TMDB cannot be reached.
 */
export const ArtworkSettingsUpdate = Schema.Struct({
  tmdbKey: Schema.NullOr(Schema.String.check(Schema.isMaxLength(512))),
}).annotate({ identifier: "ArtworkSettingsUpdate" });
export type ArtworkSettingsUpdate = typeof ArtworkSettingsUpdate.Type;

/**
 * Server-wide playback and conversion settings (PLAN 6.11, Settings › Default quality). Per-device
 * overrides of the quality and the player's fill, fit and volume stay on the device; a device on
 * "Household default" plays at `quality` for its situation.
 */
export const PlaybackSettings = Schema.Struct({
  hardwareAcceleration: Schema.Literals(["auto", "off"]),
  /** The startup probe's result; absent until the first test ran. */
  detected: Schema.optionalKey(
    Schema.Struct({
      name: Schema.String,
      ok: Schema.Boolean,
      testedAt: Instant,
      /** Driver details for "Details", e.g. constant-quality mode only. */
      detail: Schema.optionalKey(Schema.String),
    }),
  ),
  preference: Schema.Literals(["quality", "power"]),
  /**
   * "Simultaneous picture conversions": how many distinct picture conversions may be in use at
   * once (`pictureConversionCount` in the domain). Over it, a device that plays the original
   * picture gets it; one that cannot waits for a conversion. Read for every new session.
   */
  pictureConversions: PictureConversionLimit,
  /** What the player asks for in each situation (the domain's `QualityChoice`). */
  quality: Schema.Struct({ home: QualityChoice, away: QualityChoice, mobile: QualityChoice }),
}).annotate({ identifier: "PlaybackSettings" });
export type PlaybackSettings = typeof PlaybackSettings.Type;

/**
 * What a client saves: the playback settings, where an app from before "Simultaneous picture
 * conversions" leaves that field out and the server keeps what is stored.
 */
export const PlaybackSettingsUpdate = PlaybackSettings.mapFields((fields) => ({
  ...fields,
  pictureConversions: Schema.optionalKey(PictureConversionLimit),
})).annotate({ identifier: "PlaybackSettingsUpdate" });
export type PlaybackSettingsUpdate = typeof PlaybackSettingsUpdate.Type;

/**
 * Settings. Everyone reads them (other profiles see "Defaults are set by Jonas (admin)"); only
 * admins save. Saving recording settings checks `extraTimeDefaultsProblems` from the domain and
 * answers `InvalidInput` with problems like `{ path: "extraTime.overrides.3", code:
 * "duplicateChannel" }`, or `NotFound` for an override on an unknown channel. Changing a
 * default never rewrites existing rules or scheduled recordings.
 */
export class SettingsGroup extends HttpApiGroup.make("settings")
  .add(
    HttpApiEndpoint.get("recording", "/recording", { success: RecordingSettings }),
    HttpApiEndpoint.put("saveRecording", "/recording", {
      payload: RecordingSettings,
      success: RecordingSettings,
      error: [InvalidInput, NotFound, Forbidden],
    }),
    HttpApiEndpoint.get("artwork", "/artwork", { success: ArtworkSettings }),
    HttpApiEndpoint.put("saveArtwork", "/artwork", {
      payload: ArtworkSettingsUpdate,
      success: ArtworkSettings,
      error: [InvalidInput, Forbidden],
    }),
    HttpApiEndpoint.get("playback", "/playback", { success: PlaybackSettings }),
    HttpApiEndpoint.put("savePlayback", "/playback", {
      payload: PlaybackSettingsUpdate,
      success: PlaybackSettings,
      error: [InvalidInput, Forbidden],
    }),
    /**
     * Live TV after its viewers leave (Settings › Recording): how long a channel keeps running
     * after the last viewer left, and how long its rewind buffer stays once it stopped. A change
     * applies to the next viewer who leaves.
     */
    HttpApiEndpoint.get("live", "/live", { success: LiveKeep }),
    HttpApiEndpoint.put("saveLive", "/live", {
      payload: LiveKeep,
      success: LiveKeep,
      error: [Forbidden],
    }),
  )
  .middleware(Authentication)
  .prefix("/settings")
  .annotateMerge(OpenApi.annotations({ title: "Settings" })) {}
