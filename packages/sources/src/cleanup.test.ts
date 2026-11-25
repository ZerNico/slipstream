// The vitest plugin does not see it.effect / it.live as test blocks (chat and siva turn it off).
/* oxlint-disable vitest/no-standalone-expect */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "@effect/vitest";
import { Effect, Schema } from "effect";
import {
  applyRewrites,
  cleanGuide,
  compileRewrites,
  dedupeProgrammes,
  fillMissingStops,
  RewriteRule,
} from "./cleanup.ts";
import { parseXmltv, type XmltvProgramme } from "./xmltv.ts";

const fixture = readFileSync(new URL("../fixtures/tvproxy-guide.xml", import.meta.url), "utf8");

const programme = (fields: Partial<XmltvProgramme>): XmltvProgramme => ({
  _tag: "Programme",
  channel: "c",
  start: 0,
  stop: 60_000,
  title: "T",
  categories: [],
  isNew: false,
  premiere: false,
  previouslyShown: false,
  live: false,
  ...fields,
});

describe("duplicate removal on the tvproxy fixture", () => {
  it.effect("removes the second copy of every Sky Sport programme and repeated channels", () =>
    Effect.gen(function* () {
      const guide = yield* parseXmltv(fixture);
      const cleaned = cleanGuide(guide);
      expect(cleaned.report).toEqual({
        duplicatesRemoved: 15,
        duplicateChannelsMerged: 2,
        rewritten: 0,
      });
      expect(cleaned.channels.map((channel) => channel.id)).toEqual([
        "ch1001",
        "ch1004",
        "ch1007",
        "3f0c2a9d8e7b6a5f4e3d2c1b0a9f8e7d6c5b4a39",
        "eventbeta0",
      ]);
      const f1 = cleaned.programmes.filter((entry) => entry.channel === "ch1004");
      expect(f1).toHaveLength(12);
      const starts = f1.map((entry) => entry.start);
      expect(new Set(starts).size).toBe(12);
      expect(starts).toEqual(starts.toSorted((a, b) => a - b));
    }),
  );
});

describe("dedupeProgrammes", () => {
  it("keeps overlapping but different programmes and merges details of real duplicates", () => {
    const first = programme({ title: "A", categories: ["Sport"] });
    const copy = programme({
      title: "A",
      description: "Details",
      categories: ["Motorsport"],
      live: true,
    });
    const other = programme({ title: "B" });
    const { programmes, removed } = dedupeProgrammes([first, other, copy]);
    expect(removed).toBe(1);
    expect(programmes).toEqual([
      { ...first, description: "Details", categories: ["Sport", "Motorsport"], live: true },
      other,
    ]);
  });

  it("treats a different sub-title or stop as a different programme", () => {
    const { removed } = dedupeProgrammes([
      programme({ subTitle: "Part 1" }),
      programme({ subTitle: "Part 2" }),
      programme({ subTitle: "Part 1", stop: 120_000 }),
    ]);
    expect(removed).toBe(0);
  });
});

describe("fillMissingStops", () => {
  it("uses the next start on the same channel, whatever the input order", () => {
    const filled = fillMissingStops([
      programme({ start: 200, stop: undefined }),
      programme({ start: 100, stop: undefined }),
      programme({ channel: "other", start: 150, stop: 400 }),
      programme({ start: 300, stop: undefined }),
    ]);
    expect(filled.map((entry) => entry.stop)).toEqual([300, 200, 400, undefined]);
  });
});

describe("rewrite rules", () => {
  const decode = Schema.decodeUnknownSync(Schema.Array(RewriteRule));

  it.effect("splits the tvproxy F1 title into title and sub-title", () =>
    Effect.gen(function* () {
      const rewrites = yield* compileRewrites(
        decode([
          {
            field: "title",
            pattern: "^F1: (?<session>[^-]+?) - (?<event>.+)$",
            set: { title: "Formel 1", subTitle: "$<event>: $<session>" },
            channels: ["ch1004"],
          },
        ]),
      );
      const guide = yield* parseXmltv(fixture);
      const cleaned = cleanGuide(guide, { rewrites });
      const f1 = cleaned.programmes.filter((entry) => entry.channel === "ch1004");
      expect(f1.map((entry) => [entry.title, entry.subTitle]).slice(0, 2)).toEqual([
        ["Formel 1", "GP Las Vegas: Qualifying"],
        [
          "Ferrari Challenge Europe: Trofeo Pirelli - 1. Rennen in Barcelona",
          "Trofeo Pirelli - 1. Rennen in Barcelona",
        ],
      ]);
      expect(
        f1.find(
          (entry) =>
            entry.title === "Formel 1" &&
            entry.subTitle?.startsWith("GP Las Vegas: Pressekonferenz"),
        ),
      ).toBeDefined();
      // Rewrites run before duplicate removal, so both copies still collapse into one.
      expect(cleaned.report.duplicatesRemoved).toBe(15);
      expect(cleaned.report.rewritten).toBe(14);
    }),
  );

  it.effect("applies rules in order, supports flags, $& and $$, and ignores other channels", () =>
    Effect.gen(function* () {
      const rewrites = yield* compileRewrites(
        decode([
          {
            field: "title",
            pattern: "^live: (.*)$",
            flags: "i",
            set: { title: "$1", subTitle: "Live $$ $&" },
          },
          { field: "title", pattern: "^Race$", set: { title: "Grand Prix" } },
          { field: "subTitle", pattern: "Live", set: { subTitle: "" }, channels: ["elsewhere"] },
        ]),
      );
      const result = applyRewrites(rewrites, programme({ title: "LIVE: Race" }));
      expect(result).toMatchObject({ title: "Grand Prix", subTitle: "Live $ LIVE: Race" });
    }),
  );

  it.effect("never empties a title, and an empty sub-title removes it", () =>
    Effect.gen(function* () {
      const rewrites = yield* compileRewrites(
        decode([
          { field: "subTitle", pattern: "^(Wiederholung)$", set: { title: "", subTitle: "" } },
        ]),
      );
      const result = applyRewrites(
        rewrites,
        programme({ title: "Show", subTitle: "Wiederholung" }),
      );
      expect(result).toMatchObject({ title: "Show", subTitle: undefined });
      const untouched = programme({ title: "Show" });
      expect(applyRewrites(rewrites, untouched)).toBe(untouched);
    }),
  );

  it("rejects invalid patterns and stateful flags when decoding", () => {
    expect(() => decode([{ field: "title", pattern: "(", set: {} }])).toThrow(
      /not a valid regular expression/,
    );
    expect(() => decode([{ field: "title", pattern: "a", flags: "g", set: {} }])).toThrow(
      /flags g and y are not allowed/,
    );
  });

  it.effect("reports which rule failed to compile", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        compileRewrites([
          { field: "title", pattern: "ok", set: {} },
          { field: "title", pattern: "[", set: {} },
        ]),
      );
      expect(error._tag).toBe("InvalidRewriteRule");
      expect(error.index).toBe(1);
    }),
  );
});
