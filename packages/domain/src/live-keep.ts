import { Schema } from "effect";
import { HOUR, MINUTE } from "./time.ts";

/**
 * How long a channel keeps running after its last live viewer left: minutes (1 to 60), or until
 * the programme on air at that moment ends (`"programmeEnd"`).
 */
export const KeepRunning = Schema.Union([
  Schema.Literal("programmeEnd"),
  Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 60 })),
]).annotate({ identifier: "KeepRunning" });
export type KeepRunning = typeof KeepRunning.Type;

/**
 * What live TV keeps after its viewers leave (Settings › Recording › Live TV): the channel's
 * capture keeps running for `keepRunning`, so a reload or a short break finds the whole rewind
 * buffer; after the capture stopped, what it captured stays rewindable for `keepBufferMinutes`
 * (0 to 24 hours, still within the DVR window and only while disk space allows).
 */
export const LiveKeep = Schema.Struct({
  keepRunning: KeepRunning,
  keepBufferMinutes: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 24 * 60 })),
}).annotate({ identifier: "LiveKeep" });
export type LiveKeep = typeof LiveKeep.Type;

/** What a server ships with: 10 minutes running, the rewind buffer kept for an hour. */
export const initialLiveKeep: LiveKeep = { keepRunning: 10, keepBufferMinutes: 60 };

/** The choices the settings offer for {@link LiveKeep.keepRunning}, shortest first. */
export const keepRunningChoices: readonly KeepRunning[] = [1, 5, 10, 15, 30, 60, "programmeEnd"];

/** The choices the settings offer for {@link LiveKeep.keepBufferMinutes}, 0 meaning off. */
export const keepBufferChoices: readonly number[] = [0, 15, 30, 60, 120, 240, 480, 720, 1440];

/** A keep-running choice back from its picker value (`String(choice)`). */
export const keepRunningFromValue = (value: string): KeepRunning =>
  value === "programmeEnd" ? "programmeEnd" : Number(value);

/** The keep-running choices to offer: a value saved outside the steps still shows as itself, last. */
export const keepRunningChoicesWith = (saved: KeepRunning): readonly KeepRunning[] =>
  keepRunningChoices.includes(saved) ? keepRunningChoices : [...keepRunningChoices, saved];

/** The kept-buffer choices to offer: a value saved outside the steps shows in its place. */
export const keepBufferChoicesWith = (saved: number): readonly number[] =>
  keepBufferChoices.includes(saved)
    ? keepBufferChoices
    : [...keepBufferChoices, saved].toSorted((a, b) => a - b);

/** "Until the programme ends" never keeps a channel running longer than this. */
export const PROGRAMME_LINGER_MAX_MS = 4 * HOUR;
/** "Until the programme ends" keeps a channel running at least this long, for a reload. */
export const PROGRAMME_LINGER_MIN_MS = MINUTE;

/**
 * When a channel whose last live viewer left at `leftAtMs` stops (epoch ms). With
 * `"programmeEnd"` that is the end of the programme on air then (`programmeEndMs`), at least
 * {@link PROGRAMME_LINGER_MIN_MS} and at most {@link PROGRAMME_LINGER_MAX_MS} away; without a
 * guide entry it keeps the default 10 minutes. `0` stops it at once.
 */
export const keepRunningUntil = (
  keep: KeepRunning,
  leftAtMs: number,
  programmeEndMs: number | undefined,
): number => {
  if (keep !== "programmeEnd") return leftAtMs + keep * MINUTE;
  if (programmeEndMs === undefined) return leftAtMs + 10 * MINUTE;
  return Math.min(
    leftAtMs + PROGRAMME_LINGER_MAX_MS,
    Math.max(leftAtMs + PROGRAMME_LINGER_MIN_MS, programmeEndMs),
  );
};
