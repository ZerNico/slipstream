import { DateTime } from "effect";
import { describe, expect, it } from "vitest";
import { ChannelId, RecordingId } from "../src/ids.ts";
import {
  type ChainEntry,
  problemChains,
  replacedCardMillis,
  replacedChains,
  scheduledRepeatStart,
} from "../src/problem-chains.ts";

const T = Date.UTC(2026, 10, 22, 20);
const HOUR = 3_600_000;

const entry = (
  id: string,
  state: ChainEntry["state"],
  start: number,
  more: Partial<ChainEntry> = {},
): ChainEntry => ({ id: RecordingId.make(id), state, start: DateTime.makeUnsafe(start), ...more });

describe("problemChains", () => {
  const original = entry("original", "incomplete", T - 48 * HOUR);
  const repeat = entry("repeat", "incomplete", T - 24 * HOUR, {
    replacesId: RecordingId.make("original"),
    replaces: { recordingId: RecordingId.make("original") },
  });

  it("shows a damaged original and its damaged repeat as the original", () => {
    expect(problemChains([repeat, original]).map((e) => e.id)).toEqual(["original"]);
  });

  it("falls back to the newest damaged repeat when the original is gone", () => {
    expect(problemChains([repeat]).map((e) => e.id)).toEqual(["repeat"]);
  });

  it("leaves out good recordings and chains already replaced, newest first", () => {
    const good = entry("good", "completed", T);
    const replaced = entry("old", "failed", T - 72 * HOUR, { rerun: { state: "replaced" } });
    const failed = entry("failed", "failed", T - HOUR);
    expect(problemChains([original, good, replaced, failed]).map((e) => e.id)).toEqual([
      "failed",
      "original",
    ]);
  });
});

describe("scheduledRepeatStart", () => {
  it("is the repeat the rerun view names, else a listed repeat still to come", () => {
    const named = entry("a", "incomplete", T, {
      rerun: {
        state: "scheduled",
        repeat: {
          recordingId: RecordingId.make("r"),
          start: DateTime.makeUnsafe(T + HOUR),
          channelId: ChannelId.make("ard"),
        },
      },
    });
    expect(scheduledRepeatStart(named, [])).toBe(T + HOUR);
    const plain = entry("b", "incomplete", T, { rerun: { state: "scheduled" } });
    const listed = entry("r2", "scheduled", T + 2 * HOUR, {
      replaces: { recordingId: RecordingId.make("b") },
    });
    expect(scheduledRepeatStart(plain, [listed])).toBe(T + 2 * HOUR);
    expect(scheduledRepeatStart(plain, [])).toBeUndefined();
  });
});

describe("replacedChains", () => {
  const replacedAt = T - 2 * HOUR;
  const repeat = entry("repeat", "completed", T - 3 * HOUR, {
    replaces: {
      recordingId: RecordingId.make("original"),
      replacedAt: DateTime.makeUnsafe(replacedAt),
    },
  });

  it("keeps the replaced card for a day, keyed by the original", () => {
    expect(replacedChains([repeat], T).map((chain) => chain.key)).toEqual(["replaced:original"]);
    expect(replacedChains([repeat], replacedAt + replacedCardMillis)).toEqual([]);
    expect(
      replacedChains([{ ...repeat, replaces: { recordingId: RecordingId.make("original") } }], T),
    ).toEqual([]);
  });
});
