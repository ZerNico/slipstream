/**
 * Household settings (SPEC 7.7, 7.4, PLAN 6.11): the default extra time with its channel and
 * category overrides, the artwork order, and the server's playback settings. Everyone reads
 * them; admins save. Values live as JSON in the `settings` table and fall back to the shipped
 * defaults until someone saves.
 *
 * Changing a default never rewrites existing rules or scheduled recordings: the default is read
 * when a one-off recording is created without its own padding.
 */
import { and, eq, inArray } from "drizzle-orm";
import { Context, Effect, Layer, Option, Schema } from "effect";
import {
  InvalidInput,
  NotFound,
  PlaybackSettings,
  type PlaybackSettingsUpdate,
  RecordingSettings,
  type InputProblem,
} from "@slipstream/api";
import {
  defaultArtworkOrder,
  defaultPictureConversionLimit,
  extraTimeDefaultsProblems,
  initialExtraTimeDefaults,
  initialLiveKeep,
  LiveKeep,
  PictureConversionLimit,
  type User,
} from "@slipstream/domain";
import { requireAdmin } from "../auth/service.ts";
import { type Database, Db } from "../db/client.ts";
import { toInstant } from "../db/codec.ts";
import { channels, settings } from "../db/schema.ts";
import { Hardware } from "../system/hardware.ts";
import { liveChannel } from "../channels/lineup.ts";

const RECORDING_KEY = "recording";
const PLAYBACK_KEY = "playback";
const LIVE_KEY = "live";

/** What Settings › Recording ships with: 2 minutes early, 10 after, guide image then frame. */
export const initialRecordingSettings: RecordingSettings = {
  extraTime: initialExtraTimeDefaults,
  artworkOrder: defaultArtworkOrder,
};

/**
 * The stored part of the playback settings; `detected` comes from the hardware probe. A value
 * saved before "Simultaneous picture conversions" existed reads as its default.
 */
const StoredPlayback = PlaybackSettings.mapFields(({ detected: _detected, ...rest }) => ({
  ...rest,
  pictureConversions: PictureConversionLimit.pipe(
    Schema.withDecodingDefaultKey(Effect.succeed(defaultPictureConversionLimit)),
  ),
}));
type StoredPlayback = typeof StoredPlayback.Type;

/**
 * Playback defaults: hardware acceleration when it works, quality first, no limit on picture
 * conversions, automatic quality.
 */
export const initialPlaybackSettings: StoredPlayback = {
  hardwareAcceleration: "auto",
  preference: "quality",
  pictureConversions: defaultPictureConversionLimit,
  quality: { home: "auto", away: "auto", mobile: "auto" },
};

const LiveJson = Schema.fromJsonString(Schema.toCodecJson(LiveKeep));

/**
 * The saved Live TV settings, or the defaults (also for a value that no longer decodes). The
 * recorder reads them each time a viewer leaves (`LiveKeepPolicyLive`).
 */
export const loadLiveKeep = (db: Database): Effect.Effect<LiveKeep> =>
  db
    .select({ value: settings.value })
    .from(settings)
    .where(eq(settings.key, LIVE_KEY))
    .pipe(
      Effect.map((rows) => {
        const value = rows[0]?.value;
        return (
          Option.getOrUndefined(
            value === undefined ? Option.none() : Schema.decodeUnknownOption(LiveJson)(value),
          ) ?? initialLiveKeep
        );
      }),
      Effect.orDie,
    );

const RecordingJson = Schema.fromJsonString(Schema.toCodecJson(RecordingSettings));
const StoredPlaybackJson = Schema.fromJsonString(Schema.toCodecJson(StoredPlayback));

/** The saved playback settings, or the defaults (also for a value that no longer decodes). */
export const readStoredPlayback = (value: string | undefined): StoredPlayback =>
  Option.getOrUndefined(
    value === undefined ? Option.none() : Schema.decodeUnknownOption(StoredPlaybackJson)(value),
  ) ?? initialPlaybackSettings;

/** The problems of a recording settings payload, paths as the form shows them. */
export const recordingSettingsProblems = (input: RecordingSettings): Array<InputProblem> => [
  ...extraTimeDefaultsProblems(input.extraTime).map((problem) => ({
    path: `extraTime.overrides.${problem.index}`,
    code: problem._tag === "DuplicateChannel" ? "duplicateChannel" : "duplicateCategory",
  })),
  ...(new Set(input.artworkOrder).size === input.artworkOrder.length
    ? []
    : [{ path: "artworkOrder", code: "duplicateSource" }]),
];

const makeSettings = Effect.gen(function* () {
  const { write, read } = yield* Db;
  const hardware = yield* Hardware;

  const stored = (key: string) =>
    read
      .select({ value: settings.value })
      .from(settings)
      .where(eq(settings.key, key))
      .pipe(
        Effect.map((rows) => rows[0]?.value),
        Effect.orDie,
      );

  const store = (key: string, value: string) =>
    write
      .insert(settings)
      .values({ key, value })
      .onConflictDoUpdate({ target: settings.key, set: { value } })
      .pipe(Effect.asVoid, Effect.orDie);

  /** The saved recording settings, or the defaults (also for a value that no longer decodes). */
  const recording: Effect.Effect<RecordingSettings> = Effect.map(
    stored(RECORDING_KEY),
    (value) =>
      Option.getOrUndefined(
        value === undefined ? Option.none() : Schema.decodeUnknownOption(RecordingJson)(value),
      ) ?? initialRecordingSettings,
  );

  const saveRecording = Effect.fn("Settings.saveRecording")(function* (
    actor: User,
    input: RecordingSettings,
  ) {
    yield* requireAdmin(actor);
    const problems = recordingSettingsProblems(input);
    if (problems.length > 0) return yield* new InvalidInput({ problems });
    const channelIds = [
      ...new Set(
        input.extraTime.overrides.flatMap((override) =>
          override._tag === "Channel" ? [override.channelId as string] : [],
        ),
      ),
    ];
    if (channelIds.length > 0) {
      const rows = yield* read
        .select({ id: channels.id })
        .from(channels)
        .where(and(inArray(channels.id, channelIds), liveChannel))
        .pipe(Effect.orDie);
      const known = new Set(rows.map((row) => row.id));
      const unknown = channelIds.find((id) => !known.has(id));
      if (unknown !== undefined) return yield* new NotFound({ entity: "channel", id: unknown });
    }
    yield* store(RECORDING_KEY, Schema.encodeSync(RecordingJson)(input));
    return input;
  });

  /** What the startup probe found, for "Hardware acceleration · Details". */
  const detected = Effect.gen(function* () {
    const caps = yield* hardware.caps;
    const at = yield* hardware.detectedAt;
    if (caps === undefined || at === undefined) return undefined;
    const [best] = caps.encoders;
    return best === undefined
      ? { name: "software", ok: false, testedAt: toInstant(at) }
      : {
          name: best.encoder,
          ok: true,
          testedAt: toInstant(at),
          detail: `${best.codecs.join(", ")} · ${best.rateControl.join(", ")}`,
        };
  });

  const playback = Effect.gen(function* () {
    const saved = readStoredPlayback(yield* stored(PLAYBACK_KEY));
    const probe = yield* detected;
    return {
      ...saved,
      ...(probe === undefined ? {} : { detected: probe }),
    } satisfies PlaybackSettings;
  });

  const savePlayback = Effect.fn("Settings.savePlayback")(function* (
    actor: User,
    input: PlaybackSettingsUpdate,
  ) {
    yield* requireAdmin(actor);
    // The probe's result belongs to the server; a client cannot overwrite it. An app that does
    // not know "Simultaneous picture conversions" yet keeps the stored value.
    const { detected: _ignored, pictureConversions, ...rest } = input;
    const kept =
      pictureConversions ?? readStoredPlayback(yield* stored(PLAYBACK_KEY)).pictureConversions;
    yield* store(
      PLAYBACK_KEY,
      Schema.encodeSync(StoredPlaybackJson)({ ...rest, pictureConversions: kept }),
    );
    return yield* playback;
  });

  const saveLive = Effect.fn("Settings.saveLive")(function* (actor: User, input: LiveKeep) {
    yield* requireAdmin(actor);
    yield* store(LIVE_KEY, Schema.encodeSync(LiveJson)(input));
    return input;
  });

  return {
    recording,
    saveRecording,
    playback,
    savePlayback,
    /** Live TV after its viewers leave; the defaults until an admin saves. */
    live: loadLiveKeep(read),
    saveLive,
    /** The raw value stored under `key`, for services that keep a setting of their own. */
    stored,
    /** Stores a raw value under `key`. */
    store,
    /** Removes what is stored under `key`. */
    forget: (key: string) =>
      write.delete(settings).where(eq(settings.key, key)).pipe(Effect.asVoid, Effect.orDie),
  };
});

/** Household settings. */
export class Settings extends Context.Service<Settings, Effect.Success<typeof makeSettings>>()(
  "@slipstream/server/Settings",
) {
  static readonly layer = Layer.effect(Settings, makeSettings);
}
