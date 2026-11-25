import { afterEach, describe, expect, it } from "vitest";
import { DateTime } from "effect";
import type { ScheduleConflict } from "@slipstream/api";
import { conflictRoom, RecordingId, SourceId } from "@slipstream/domain";
import { type Locale, resolveIntro, setLocale } from "@slipstream/i18n";
import { issueText } from "~/modules/home/issue-text.ts";

afterEach(() => setLocale("en"));

const tvproxy = SourceId.make("tvproxy");
const start = Date.UTC(2026, 10, 22, 19);
const end = Date.UTC(2026, 10, 22, 21);

const conflict = (count: number, capacity: number): ScheduleConflict => ({
  range: { start: DateTime.makeUnsafe(start), end: DateTime.makeUnsafe(end) },
  channelIds: [],
  recordingIds: Array.from({ length: count }, (_, index) => RecordingId.make(`r${index}`)),
  sourceIds: [tvproxy],
  capacity,
});

/** Every number a sentence states before "can record" or "stream(s)": the room it claims. */
const claimedRoom = (text: string): readonly number[] =>
  [
    ...text.matchAll(
      /(?:only|nur) (\d+) (?:can|können|streams?|Streams?)|(?:dann (?:ist|sind) nur) (\d+)/gu,
    ),
  ].map((match) => Number(match[1] ?? match[2]));

describe("conflict copy", () => {
  it("phrases free streams below the limit as 'only N free then'", () => {
    const sources = [{ id: tvproxy, maxStreams: 4 }];
    expect(conflictRoom(conflict(3, 1), sources)).toEqual({ kind: "free", streams: 1 });
    expect(conflictRoom(conflict(3, 4), sources)).toEqual({ kind: "unknown" });
    expect(conflictRoom(conflict(5, 4), sources)).toEqual({ kind: "limit", streams: 4 });
    const room = conflictRoom(conflict(3, 1), sources);
    expect(resolveIntro({ count: 3, from: start, to: end, room })).toContain(
      "but only 1 stream is free then",
    );
    expect(
      resolveIntro({ count: 3, from: start, to: end, room: { kind: "free", streams: 0 } }),
    ).toContain("but no stream is free then");
    setLocale("de");
    expect(resolveIntro({ count: 3, from: start, to: end, room })).toContain(
      "aber dann ist nur 1 Stream frei",
    );
  });

  it("never states room for as many recordings as overlap", () => {
    const locales: readonly Locale[] = ["en", "de"];
    for (const locale of locales) {
      setLocale(locale);
      for (let count = 2; count <= 5; count += 1) {
        for (let capacity = 0; capacity <= 6; capacity += 1) {
          for (const maxStreams of [undefined, 1, 2, 4, 8]) {
            const sources = [
              maxStreams === undefined ? { id: tvproxy } : { id: tvproxy, maxStreams },
            ];
            const overlap = conflict(count, capacity);
            const room = conflictRoom(overlap, sources);
            const intro = resolveIntro({ count, from: start, to: end, room });
            const { text } = issueText(
              {
                id: "c",
                tone: "warn",
                kind: "conflict",
                conflict: overlap,
                titles: ["Rennen", "NBA"],
                room,
              },
              start - 3_600_000,
              "Europe/Berlin",
            );
            for (const sentence of [intro, text]) {
              for (const claimed of claimedRoom(sentence)) {
                expect(
                  claimed,
                  `${locale} ${count}/${capacity}/${maxStreams}: ${sentence}`,
                ).toBeLessThan(count);
              }
            }
            // With room for every recording the copy names no number at all.
            const named = [...claimedRoom(intro), ...claimedRoom(text)];
            expect(capacity >= count ? named : []).toEqual([]);
          }
        }
      }
    }
  });
});
