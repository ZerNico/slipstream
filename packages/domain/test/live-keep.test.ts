import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import {
  initialLiveKeep,
  keepBufferChoices,
  keepRunningChoices,
  keepRunningUntil,
  LiveKeep,
} from "../src/live-keep.ts";
import { HOUR, MINUTE } from "../src/time.ts";

const left = Date.parse("2026-11-22T12:00:00Z");

describe("keepRunningUntil", () => {
  it("keeps a channel running for the chosen minutes", () => {
    expect(keepRunningUntil(10, left, undefined)).toBe(left + 10 * MINUTE);
    expect(keepRunningUntil(60, left, left + 5 * MINUTE)).toBe(left + HOUR);
  });

  it("keeps it until the programme on air ends", () => {
    expect(keepRunningUntil("programmeEnd", left, left + 42 * MINUTE)).toBe(left + 42 * MINUTE);
  });

  it("keeps a programme's linger between a minute and four hours", () => {
    expect(keepRunningUntil("programmeEnd", left, left + 10_000)).toBe(left + MINUTE);
    expect(keepRunningUntil("programmeEnd", left, left + 9 * HOUR)).toBe(left + 4 * HOUR);
  });

  it("keeps the default 10 minutes without a guide entry", () => {
    expect(keepRunningUntil("programmeEnd", left, undefined)).toBe(left + 10 * MINUTE);
  });
});

describe("LiveKeep", () => {
  const decode = Schema.decodeUnknownSync(LiveKeep);

  it("accepts the shipped value and every offered choice", () => {
    expect(decode(initialLiveKeep)).toEqual(initialLiveKeep);
    for (const keepRunning of keepRunningChoices) {
      for (const keepBufferMinutes of keepBufferChoices) {
        expect(decode({ keepRunning, keepBufferMinutes })).toEqual({
          keepRunning,
          keepBufferMinutes,
        });
      }
    }
  });

  it("refuses values outside the ranges", () => {
    const valid = Schema.is(LiveKeep);
    expect(valid({ keepRunning: 0, keepBufferMinutes: 60 })).toBe(false);
    expect(valid({ keepRunning: 61, keepBufferMinutes: 60 })).toBe(false);
    expect(valid({ keepRunning: 2.5, keepBufferMinutes: 60 })).toBe(false);
    expect(valid({ keepRunning: "forever", keepBufferMinutes: 60 })).toBe(false);
    expect(valid({ keepRunning: 10, keepBufferMinutes: -1 })).toBe(false);
    expect(valid({ keepRunning: 10, keepBufferMinutes: 24 * 60 + 1 })).toBe(false);
  });
});
