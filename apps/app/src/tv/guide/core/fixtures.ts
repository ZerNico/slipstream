import { makeGuide, type Guide, type GuideChannel } from "./guide.ts";
import { HOUR, MINUTE } from "@slipstream/domain";

/** Midnight UTC on the day the fixtures describe (Sunday 22 November 2026). */
export const BASE = Date.UTC(2026, 10, 22);

/** Epoch ms for "HH:MM" on the fixture day; hours past 24 roll into the next days. */
export const at = (clock: string): number => {
  const [hours = "0", minutes = "0"] = clock.split(":");
  return BASE + Number(hours) * HOUR + Number(minutes) * MINUTE;
};

/** A channel from `[start, end]` clock pairs. */
export const channel = (
  id: string,
  number: number,
  slots: readonly (readonly [string, string])[],
): GuideChannel => ({
  id,
  number,
  programmes: slots.map(([start, end]) => ({
    id: `${id}@${start}`,
    start: at(start),
    end: at(end),
  })),
});

/** A channel with one-hour programmes from midnight for `hours` hours. */
export const hourly = (id: string, number: number, hours = 48): GuideChannel => ({
  id,
  number,
  programmes: Array.from({ length: hours }, (_, hour) => ({
    id: `${id}@${hour}`,
    start: BASE + hour * HOUR,
    end: BASE + (hour + 1) * HOUR,
  })),
});

/**
 * The mockup's morning plus filler rows:
 * row 0 Das Erste (1), row 1 ZDF (2), row 2 no data (3), row 3 a gap 06:00 to 07:00 (7),
 * row 4 Eurosport 1 (130), rows 5 to 24 hourly for two days (200 to 219).
 */
export const sampleGuide = (): Guide =>
  makeGuide([
    channel("ard", 1, [
      ["04:55", "06:20"],
      ["06:20", "06:30"],
      ["06:30", "08:00"],
      ["08:00", "09:00"],
    ]),
    channel("zdf", 2, [
      ["05:45", "06:30"],
      ["06:30", "07:00"],
      ["07:00", "08:30"],
      ["08:30", "09:00"],
    ]),
    channel("empty", 3, []),
    channel("gap", 7, [
      ["05:00", "06:00"],
      ["07:00", "09:00"],
    ]),
    channel("e1", 130, [
      ["05:30", "06:30"],
      ["06:30", "08:00"],
      ["08:00", "09:30"],
    ]),
    ...Array.from({ length: 20 }, (_, index) => hourly(`h${index}`, 200 + index)),
  ]);
