/** Recording time arithmetic in epoch milliseconds. */
import { MINUTE, type Padding, type Recording, type TimeRange } from "@slipstream/domain";
import { DateTime } from "effect";

/** A half-open range `[startMs, endMs)`. */
export interface MsRange {
  readonly startMs: number;
  readonly endMs: number;
}

/** What a recording retains: its programme times widened by its padding. */
export const paddedMs = (recording: {
  readonly start: DateTime.Utc;
  readonly end: DateTime.Utc;
  readonly padding: Padding;
}): MsRange => ({
  startMs: DateTime.toEpochMillis(recording.start) - recording.padding.beforeMinutes * MINUTE,
  endMs: DateTime.toEpochMillis(recording.end) + recording.padding.afterMinutes * MINUTE,
});

/** A millisecond range as a domain `TimeRange`. */
export const toTimeRange = (range: MsRange): TimeRange => ({
  start: DateTime.makeUnsafe(range.startMs),
  end: DateTime.makeUnsafe(range.endMs),
});

/**
 * Moves a recording's padded range to exactly `[startMs, endMs)`. Programme times stay as they
 * are where whole minutes of padding can express the change; otherwise the programme edge moves
 * to the new padded edge and that side's padding becomes zero. Used for stop and extend.
 */
export const withPaddedRange = <R extends Pick<Recording, "start" | "end" | "padding">>(
  recording: R,
  range: MsRange,
): R => {
  let start = Math.min(
    Math.max(DateTime.toEpochMillis(recording.start), range.startMs),
    range.endMs,
  );
  let end = Math.min(Math.max(DateTime.toEpochMillis(recording.end), start), range.endMs);
  let before = (start - range.startMs) / MINUTE;
  if (!Number.isInteger(before) || before > 24 * 60) {
    start = range.startMs;
    before = 0;
    end = Math.max(end, start);
  }
  let after = (range.endMs - end) / MINUTE;
  if (!Number.isInteger(after) || after > 24 * 60) {
    end = range.endMs;
    after = 0;
  }
  return {
    ...recording,
    start: DateTime.makeUnsafe(start),
    end: DateTime.makeUnsafe(end),
    padding: { beforeMinutes: before, afterMinutes: after },
  };
};
