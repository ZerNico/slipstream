import { describe, expect, it } from "vitest";
import { mergeEpisodeNum, parseOnscreen, parseXmltvNs } from "./episode.ts";
import { parseXmltvTime } from "./xmltv-time.ts";

describe("parseXmltvTime", () => {
  it.each([
    ["20261121063000 +0000", "2026-11-21T06:30:00Z"],
    ["20261121074400 +0100", "2026-11-21T06:44:00Z"],
    ["20261121074400 -0230", "2026-11-21T10:14:00Z"],
    ["20261121074400+0100", "2026-11-21T06:44:00Z"],
    ["20261121074400 +01:00", "2026-11-21T06:44:00Z"],
    ["20261121074400 Z", "2026-11-21T07:44:00Z"],
    ["20261121074400", "2026-11-21T07:44:00Z"],
    ["202611210744", "2026-11-21T07:44:00Z"],
    ["2026112107", "2026-11-21T07:00:00Z"],
    ["20261121", "2026-11-21T00:00:00Z"],
    ["  20261121063000 +0000  ", "2026-11-21T06:30:00Z"],
  ])("reads %s", (input, iso) => {
    expect(parseXmltvTime(input)).toBe(Date.parse(iso));
  });

  it.each(["undefined", "", "2026-11-21", "20261321063000", "20260231000000", "20261121256000"])(
    "rejects %j",
    (input) => {
      expect(parseXmltvTime(input)).toBeUndefined();
    },
  );
});

describe("episode numbers", () => {
  it("reads xmltv_ns as 1-based numbers with totals", () => {
    expect(parseXmltvNs("0.4.")).toEqual({
      season: 1,
      episode: 5,
      episodeCount: undefined,
      part: undefined,
      partCount: undefined,
      xmltvNs: "0.4.",
    });
    expect(parseXmltvNs(".11/24.")).toMatchObject({
      season: undefined,
      episode: 12,
      episodeCount: 24,
    });
    expect(parseXmltvNs("..")).toBeUndefined();
    expect(parseXmltvNs("not-ns")).toBeUndefined();
  });

  it.each([
    ["S1 E104", { season: 1, episode: 104 }],
    ["S01E04", { season: 1, episode: 4 }],
    ["s2.e3", { season: 2, episode: 3 }],
    ["Staffel 3 Folge 7", { season: 3, episode: 7 }],
    ["Season 10, Episode 2", { season: 10, episode: 2 }],
    ["1x04", { season: 1, episode: 4 }],
    ["E0", { episode: 0 }],
    ["Folge 12", { episode: 12 }],
    ["Ep. 5", { episode: 5 }],
  ])("reads onscreen %s", (input, expected) => {
    expect(parseOnscreen(input)).toEqual({ ...expected, onscreen: input });
  });

  it("keeps unrecognised onscreen text raw", () => {
    expect(parseOnscreen("Pilot")).toEqual({ onscreen: "Pilot" });
  });

  it("prefers xmltv_ns numbers but keeps both raw values", () => {
    const fromOnscreen = mergeEpisodeNum(undefined, "onscreen", "S9 E9");
    expect(mergeEpisodeNum(fromOnscreen, "xmltv_ns", "1.2.")).toEqual({
      season: 2,
      episode: 3,
      episodeCount: undefined,
      part: undefined,
      partCount: undefined,
      xmltvNs: "1.2.",
      onscreen: "S9 E9",
    });
    expect(mergeEpisodeNum(fromOnscreen, "dd_progid", "EP0123")).toBe(fromOnscreen);
  });
});
