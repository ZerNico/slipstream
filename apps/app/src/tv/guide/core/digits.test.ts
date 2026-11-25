import { describe, expect, it } from "vitest";
import {
  defaultDigitConfig,
  digitDeadline,
  expireDigits,
  typeDigit,
  type DigitEntry,
} from "./digits.ts";

const numbers = [1, 2, 7, 13, 130, 201];

/** Types digits 100 ms apart, returning the open entry and every commit. */
const typeAll = (digits: number[], known?: readonly number[]) => {
  let entry: DigitEntry | undefined;
  const commits: number[] = [];
  digits.forEach((digit, index) => {
    const result = typeDigit(entry, digit, index * 100, defaultDigitConfig, known);
    entry = result.entry;
    if (result.commit !== undefined) commits.push(result.commit);
  });
  return { entry, commits };
};

describe("typeDigit", () => {
  it("collects digits while a longer channel number could still follow", () => {
    expect(typeAll([1, 3], numbers)).toEqual({
      entry: { digits: "13", lastAt: 100 },
      commits: [],
    });
  });

  it("commits as soon as no longer number starts with the digits", () => {
    expect(typeAll([1, 3, 0], numbers)).toEqual({ entry: undefined, commits: [130] });
    expect(typeAll([7], numbers)).toEqual({ entry: undefined, commits: [7] });
  });

  it("commits at the maximum length without a channel list", () => {
    expect(typeAll([1, 2, 3, 4, 5])).toEqual({
      entry: { digits: "5", lastAt: 400 },
      commits: [1234],
    });
  });

  it("ignores keys that are not digits", () => {
    const entry = { digits: "1", lastAt: 0 };
    expect(typeDigit(entry, 12, 50)).toEqual({ entry, commit: undefined });
    expect(typeDigit(entry, 1.5, 50)).toEqual({ entry, commit: undefined });
  });

  it("drops a stale entry and starts fresh", () => {
    const stale = { digits: "1", lastAt: 0 };
    expect(typeDigit(stale, 2, 5000).entry).toEqual({ digits: "2", lastAt: 5000 });
  });
});

describe("expireDigits", () => {
  it("commits once the pause has run out", () => {
    const entry = { digits: "20", lastAt: 1000 };
    expect(digitDeadline(entry)).toBe(2500);
    expect(expireDigits(entry, 2499)).toEqual({ entry, commit: undefined });
    expect(expireDigits(entry, 2500)).toEqual({ entry: undefined, commit: 20 });
    expect(expireDigits(undefined, 9999)).toEqual({ entry: undefined, commit: undefined });
  });
});
