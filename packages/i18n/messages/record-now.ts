/**
 * Messages for Record in the player (web, phone, TV): recording the programme being watched,
 * including what the channel's capture already holds of it. English is the source; German
 * follows each key.
 */
import type { Formatters } from "../src/format.ts";
import { defineArea, sampleStart } from "./area.ts";

type F = Formatters;

/** The record-now area of the catalogue. */
export const recordNow = defineArea({
  en: {
    record_now_action: "Record",
    record_now_key: "Record the programme you're watching",
    record_now_options: "Record options",
    // The toast's second line after Record: where the recording starts, and how much of it the
    // capture already had when the button was pressed.
    record_now_from: (p: { from: Date }, f: F) => `From ${f.time(p.from)}`,
    record_now_from_earlier: (p: { from: Date; minutes: number }, f: F) =>
      `From ${f.time(p.from)} · ${f.number(p.minutes)} min before you pressed`,
  },
  de: {
    record_now_action: "Aufnehmen",
    record_now_key: "Die laufende Sendung aufnehmen",
    record_now_options: "Aufnahmeoptionen",
    record_now_from: (p, f) => `Ab ${f.time(p.from)}`,
    record_now_from_earlier: (p, f) =>
      `Ab ${f.time(p.from)} · ${f.number(p.minutes)} Min. bevor du gedrückt hast`,
  },
  samples: {
    record_now_from: { from: sampleStart },
    record_now_from_earlier: { from: sampleStart, minutes: 12 },
  },
  sameInGerman: [],
});
