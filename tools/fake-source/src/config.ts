import { Context } from "effect";

/** Settings every part of the fake source reads. */
export interface FakeSourceSettings {
  /** IANA zone of the schedule, the XMLTV offsets and the burned-in clock. */
  readonly timeZone: string;
  /** How far ahead the guide reaches. */
  readonly guideHours: number;
  /** Write every guide programme twice, like the tvproxy feed (also `?duplicates=1`). */
  readonly duplicateProgrammes: boolean;
  readonly ffmpegPath: string;
  /** Font for the overlay; found automatically when null. */
  readonly fontFile: string | null;
}

/**
 * Defaults: Berlin time, 72 hours of guide (the F1 weekend loops over three days, so every
 * session type is always ahead, whatever the hour), `ffmpeg` from `PATH`.
 */
export const defaultSettings: FakeSourceSettings = {
  timeZone: "Europe/Berlin",
  guideHours: 72,
  duplicateProgrammes: false,
  ffmpegPath: "ffmpeg",
  fontFile: null,
};

/** The resolved settings of the running fake source. */
export class FakeSourceConfig extends Context.Service<FakeSourceConfig, FakeSourceSettings>()(
  "@slipstream/fake-source/FakeSourceConfig",
) {}
