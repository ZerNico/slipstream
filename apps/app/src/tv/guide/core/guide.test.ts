import { describe, expect, it } from "vitest";
import { at, channel } from "./fixtures.ts";
import {
  ceilTo,
  firstEndingAfter,
  floorTo,
  hasData,
  makeGuide,
  nearestProgrammeIndex,
  programmeIndexAt,
} from "./guide.ts";
import { MINUTE } from "@slipstream/domain";

const morning = channel("ard", 1, [
  ["05:00", "06:00"],
  ["06:00", "06:30"],
  ["07:00", "08:00"],
]);

describe("makeGuide", () => {
  it("sorts programmes, drops empty ones and records the covered range", () => {
    const guide = makeGuide([
      {
        id: "x",
        number: 5,
        programmes: [
          { id: "b", start: at("07:00"), end: at("08:00") },
          { id: "zero", start: at("06:30"), end: at("06:30") },
          { id: "a", start: at("06:00"), end: at("07:00") },
        ],
      },
      channel("y", 6, [["04:00", "05:00"]]),
    ]);
    expect(guide.channels[0]?.programmes.map((programme) => programme.id)).toEqual(["a", "b"]);
    expect(guide.start).toBe(at("04:00"));
    expect(guide.end).toBe(at("08:00"));
    expect(hasData(guide)).toBe(true);
  });

  it("keeps channels that are already clean as the same objects", () => {
    const guide = makeGuide([morning]);
    expect(guide.channels[0]).toBe(morning);
  });

  it("reports no data for a guide without programmes", () => {
    const guide = makeGuide([channel("empty", 1, [])]);
    expect(guide).toMatchObject({ start: 0, end: 0 });
    expect(hasData(guide)).toBe(false);
  });
});

describe("programmeIndexAt", () => {
  it("treats start as inclusive and end as exclusive", () => {
    expect(programmeIndexAt(morning.programmes, at("05:00"))).toBe(0);
    expect(programmeIndexAt(morning.programmes, at("06:00") - 1)).toBe(0);
    expect(programmeIndexAt(morning.programmes, at("06:00"))).toBe(1);
  });

  it("finds nothing in gaps, before the first or after the last programme", () => {
    expect(programmeIndexAt(morning.programmes, at("06:45"))).toBe(-1);
    expect(programmeIndexAt(morning.programmes, at("04:59"))).toBe(-1);
    expect(programmeIndexAt(morning.programmes, at("08:00"))).toBe(-1);
    expect(programmeIndexAt([], at("06:00"))).toBe(-1);
  });
});

describe("nearestProgrammeIndex", () => {
  it("prefers the airing programme", () => {
    expect(nearestProgrammeIndex(morning.programmes, at("06:10"))).toBe(1);
  });

  it("picks the closer neighbour in a gap, the next one on a tie", () => {
    expect(nearestProgrammeIndex(morning.programmes, at("06:35"))).toBe(1);
    expect(nearestProgrammeIndex(morning.programmes, at("06:55"))).toBe(2);
    expect(nearestProgrammeIndex(morning.programmes, at("06:45"))).toBe(2);
  });

  it("falls back to the first or last programme outside the data", () => {
    expect(nearestProgrammeIndex(morning.programmes, at("01:00"))).toBe(0);
    expect(nearestProgrammeIndex(morning.programmes, at("23:00"))).toBe(2);
    expect(nearestProgrammeIndex([], at("06:00"))).toBe(-1);
  });
});

describe("firstEndingAfter", () => {
  it("returns the airing programme or the next one", () => {
    expect(firstEndingAfter(morning.programmes, at("05:30"))).toBe(0);
    expect(firstEndingAfter(morning.programmes, at("06:40"))).toBe(2);
    expect(firstEndingAfter(morning.programmes, at("04:00"))).toBe(0);
    expect(firstEndingAfter(morning.programmes, at("09:00"))).toBe(3);
  });
});

describe("slot rounding", () => {
  it("rounds to epoch-aligned multiples", () => {
    expect(floorTo(at("06:12"), 30 * MINUTE)).toBe(at("06:00"));
    expect(ceilTo(at("06:12"), 30 * MINUTE)).toBe(at("06:30"));
    expect(ceilTo(at("06:30"), 30 * MINUTE)).toBe(at("06:30"));
  });
});
