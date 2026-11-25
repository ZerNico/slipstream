import { watchChoice } from "@slipstream/domain";
import { afterEach, describe, expect, it } from "vitest";
import { setLocale, setRegion, setTimeZone } from "./runtime.ts";
import { watchOptionText } from "./watch-choice-text.ts";

afterEach(() => {
  setLocale("en");
  setRegion(undefined);
  setTimeZone(undefined);
});

const nbsp = String.fromCodePoint(0xa0);
const minus = String.fromCodePoint(0x2212);
/** 17:55 to 19:10 in Berlin (UTC+1), a window of 1:15:00. */
const windowStart = Date.UTC(2026, 10, 22, 16, 55);
const windowEnd = Date.UTC(2026, 10, 22, 18, 10);
/** 46:30 in: 18:41:30. */
const resumeAt = windowStart + 46.5 * 60_000;

const texts = (input: Parameters<typeof watchChoice>[0]) =>
  watchChoice(input).options.map((option) => watchOptionText(option, input));

describe("watch choice words", () => {
  it("writes a running recording's options on the wall clock", () => {
    setRegion("DE");
    setTimeZone("Europe/Berlin");
    const now = resumeAt + 10 * 60_000;
    expect(texts({ windowStart, windowEnd, live: true, now, resumeAt })).toEqual([
      { title: "Resume at 18:41", detail: `Where you stopped · ${minus}10:00 behind live` },
      { title: "Watch from start", detail: `From 17:55 · ${minus}56:30 behind live` },
      { title: "Watch live", detail: "Join now at 18:51" },
    ]);
  });

  it("writes a finished recording's options as positions with the length", () => {
    setRegion("DE");
    setTimeZone("Europe/Berlin");
    expect(texts({ windowStart, windowEnd, live: false, now: windowEnd, resumeAt })).toEqual([
      { title: "Resume from 46:30", detail: `46:30 of 1:15:00 · 29${nbsp}min left` },
      { title: "Play from the beginning", detail: "The whole recording, 1:15:00" },
    ]);
    setLocale("de");
    expect(texts({ windowStart, windowEnd, live: false, now: windowEnd, resumeAt })[0]).toEqual({
      title: "Weiter ab 46:30",
      detail: `46:30 von 1:15:00 · noch 29${nbsp}Min.`,
    });
  });
});
