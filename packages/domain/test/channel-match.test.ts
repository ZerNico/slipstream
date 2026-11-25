import { describe, expect, it } from "vitest";
import {
  channelKey,
  channelPairKey,
  groupVariants,
  guideSuggestions,
  mergeSuggestions,
  qualityRank,
  streamMatcher,
  streamQuality,
} from "../src/channel-match.ts";
import { dedupeNumbers, importNumber, nextFreeNumber, placeNumbers } from "../src/channel-order.ts";
import { ChannelId } from "../src/ids.ts";

describe("channelKey", () => {
  it("gives copies of one channel the same key", () => {
    const erste = [
      "Das Erste",
      "Das Erste HD",
      "ARD Das Erste FHD",
      "DE: Das Erste SD",
      "DE | Das Erste HEVC",
      "|DE| Das Erste UHD",
      "[DE] Das Erste 4K",
      "DE - Das Erste HD",
      "Das Erste (DE)",
      "Das Erste H.265 50fps",
      "das-erste 1080p",
      "ARD",
    ];
    expect(new Set(erste.map(channelKey))).toEqual(new Set(["daserste"]));
    expect(channelKey("ZDF")).toBe("zdf");
    expect(channelKey("ZDF HD")).toBe("zdf");
    expect(channelKey("Sat.1")).toBe(channelKey("SAT 1 HD"));
    expect(channelKey("ProSieben FHD")).toBe(channelKey("ProSieben"));
    expect(channelKey("Österreich 1")).toBe(channelKey("Osterreich 1"));
  });

  it("keeps different channels apart", () => {
    expect(channelKey("kabel eins")).not.toBe(channelKey("Kabel 1"));
    expect(channelKey("ZDF")).not.toBe(channelKey("ZDFneo"));
    expect(channelKey("RTL")).not.toBe(channelKey("RTL+1"));
    expect(channelKey("WDR (Köln)")).not.toBe(channelKey("WDR (Aachen)"));
    expect(channelKey("ARD alpha")).not.toBe(channelKey("Das Erste"));
    expect(channelKey("Sky Sport 1")).not.toBe(channelKey("Sky Sport 2"));
    // A prefix that is not a country is part of the name.
    expect(channelKey("Sky Sport: Bundesliga 1")).toBe("skysportbundesliga1");
  });

  it("has no key for a name that is only tags", () => {
    expect(channelKey("HD")).toBeUndefined();
    expect(channelKey("  ")).toBeUndefined();
    expect(channelKey("DE: FHD")).toBeUndefined();
  });
});

describe("streamQuality", () => {
  it("reads the quality a name claims", () => {
    expect(streamQuality("Das Erste UHD")).toBe("uhd");
    expect(streamQuality("Das Erste 4K")).toBe("uhd");
    expect(streamQuality("ARD Das Erste FHD")).toBe("fhd");
    expect(streamQuality("ZDF 1080p")).toBe("fhd");
    expect(streamQuality("ZDF HD")).toBe("hd");
    expect(streamQuality("DE: Das Erste SD")).toBe("sd");
    expect(streamQuality("ZDF")).toBe("unknown");
    expect(streamQuality("Das Erste HEVC")).toBe("unknown");
  });

  it("ranks UHD over FHD over HD over SD over unknown", () => {
    const ranks = (["uhd", "fhd", "hd", "sd", "unknown"] as const).map(qualityRank);
    expect(ranks).toEqual(ranks.toSorted((a, b) => b - a));
    expect(new Set(ranks).size).toBe(5);
  });
});

describe("groupVariants", () => {
  it("makes one group per channel, best quality first, playlist order among equals", () => {
    const streams = [
      { id: "1", name: "DE: Das Erste SD" },
      { id: "2", name: "ZDF" },
      { id: "3", name: "Das Erste HD" },
      { id: "4", name: "ARD Das Erste FHD" },
      { id: "5", name: "kabel eins" },
      { id: "6", name: "Kabel 1" },
      { id: "7", name: "ZDF HD" },
      { id: "8", name: "HD" },
      { id: "9", name: "HD" },
    ];
    expect(groupVariants(streams).map((group) => group.map((stream) => stream.id))).toEqual([
      ["4", "3", "1"],
      ["7", "2"],
      ["5"],
      ["6"],
      ["8"],
      ["9"],
    ]);
  });
});

describe("streamMatcher", () => {
  const match = streamMatcher([
    { id: "erste", name: "Das Erste HD", guideIds: ["DasErste.de"] },
    { id: "zdf", name: "ZDF", guideIds: [] },
    { id: "k1", name: "Kabel 1", guideIds: ["kabeleins.de"] },
    { id: "wdr-a", name: "WDR", guideIds: ["WDR.de"] },
    { id: "wdr-b", name: "WDR HD", guideIds: ["WDR.de"] },
  ]);

  it("matches by guide id first, then by key", () => {
    expect(match({ name: "Erstes Programm", tvgId: "DasErste.de" })).toEqual({
      channelId: "erste",
      reason: "sameGuide",
    });
    expect(match({ name: "ZDF FHD" })).toEqual({ channelId: "zdf", reason: "similarName" });
    // Same guide id claims even a differently spelled name.
    expect(match({ name: "kabel eins", tvgId: "kabeleins.de" })).toEqual({
      channelId: "k1",
      reason: "sameGuide",
    });
  });

  it("never claims a different spelling or an ambiguous channel", () => {
    expect(match({ name: "kabel eins" })).toBeUndefined();
    expect(match({ name: "WDR Köln", tvgId: "WDR.de" })).toBeUndefined();
    expect(match({ name: "WDR FHD" })).toBeUndefined();
  });
});

describe("mergeSuggestions", () => {
  it("groups channels by shared guide id, then by key, keeping lineup order", () => {
    const suggestions = mergeSuggestions([
      { id: "1", name: "Das Erste HD", guideIds: ["DasErste.de"] },
      { id: "2", name: "ZDF", guideIds: ["ZDF.de"] },
      { id: "3", name: "kabel eins", guideIds: ["kabeleins.de"] },
      { id: "4", name: "ARD", guideIds: ["ARD.de", "DasErste.de"] },
      { id: "5", name: "ZDF HD", guideIds: [] },
      { id: "6", name: "Kabel 1", guideIds: [] },
      { id: "7", name: "Das Erste SD", guideIds: ["ARD.de"] },
    ]);
    expect(suggestions).toEqual([
      { channelIds: ["1", "4", "7"], reason: "sameGuide" },
      { channelIds: ["2", "5"], reason: "similarName" },
    ]);
  });

  it("never suggests channels kept apart together", () => {
    const lineup = [
      { id: "1", name: "Das Erste HD", guideIds: ["DasErste.de"] },
      { id: "2", name: "SPORT1", guideIds: [] },
      { id: "3", name: "DE: Das Erste FHD", guideIds: ["DasErste.de"] },
      { id: "4", name: "Sport 1 HD", guideIds: [] },
      { id: "5", name: "Das Erste SD", guideIds: ["DasErste.de"] },
    ];
    expect(mergeSuggestions(lineup, new Set([channelPairKey("3", "1")]))).toEqual([
      { channelIds: ["1", "5"], reason: "sameGuide" },
      { channelIds: ["2", "4"], reason: "similarName" },
    ]);
    expect(
      mergeSuggestions(
        lineup,
        new Set([channelPairKey("1", "3"), channelPairKey("1", "5"), channelPairKey("4", "2")]),
      ),
    ).toEqual([{ channelIds: ["3", "5"], reason: "sameGuide" }]);
  });

  it("suggests nothing for a tidy lineup", () => {
    expect(
      mergeSuggestions([
        { id: "1", name: "kabel eins", guideIds: [] },
        { id: "2", name: "Kabel 1", guideIds: [] },
      ]),
    ).toEqual([]);
  });
});

describe("channel numbers", () => {
  const [a, b, c, d] = ["a", "b", "c", "d"].map((id) => ChannelId.make(id)) as [
    ChannelId,
    ChannelId,
    ChannelId,
    ChannelId,
  ];

  it("finds the next free number and an import's number", () => {
    expect(nextFreeNumber(new Set([3, 4, 6]), 3)).toBe(5);
    expect(importNumber(new Set([1, 2, 9]), 5)).toBe(5);
    expect(importNumber(new Set([1, 2, 9]), 2)).toBe(10);
    expect(importNumber(new Set([1, 2, 9]), undefined)).toBe(10);
    expect(importNumber(new Set(), undefined)).toBe(1);
  });

  it("moves the holder of a taken number to the next free one above, nothing else", () => {
    const lineup = [
      { id: a, name: "A", number: 1 },
      { id: b, name: "B", number: 2 },
      { id: c, name: "C", number: 3 },
      { id: d, name: "D", number: 7 },
    ];
    expect(placeNumbers(lineup, [d], 2)).toEqual([
      { id: b, number: 4 },
      { id: d, number: 2 },
    ]);
    // A free number moves only the channel itself.
    expect(placeNumbers(lineup, [a], 5)).toEqual([{ id: a, number: 5 }]);
  });

  it("moves several channels to a run, displaced ones above it", () => {
    const lineup = [
      { id: a, name: "A", number: 1 },
      { id: b, name: "B", number: 2 },
      { id: c, name: "C", number: 3 },
      { id: d, name: "D" },
    ];
    // C leaves 3 free, so A (displaced from 1) takes it and B (from 2) the next one.
    expect(placeNumbers(lineup, [d, c], 1)).toEqual([
      { id: a, number: 3 },
      { id: b, number: 4 },
      { id: c, number: 2 },
      { id: d, number: 1 },
    ]);
  });

  it("dedupes numbers: later duplicates move to the next free number", () => {
    expect(
      dedupeNumbers([
        { id: a, name: "ZDF", number: 2 },
        { id: b, name: "Das Erste", number: 2 },
        { id: c, name: "arte", number: 3 },
        { id: d, name: "3sat", number: 2 },
      ]),
    ).toEqual([
      { id: b, number: 4 },
      { id: a, number: 5 },
    ]);
  });
});

describe("guideSuggestions", () => {
  it("puts the streams' own guide id first, then guide channels with the same key", () => {
    const guides = [
      { xmltvId: "ZDF.de", displayName: "ZDF" },
      { xmltvId: "DasErste.de", displayName: "Das Erste" },
      { xmltvId: "ard.hd@SD", displayName: "Erstes Programm" },
      { xmltvId: "kabeleins.de", displayName: "kabel eins" },
      { xmltvId: "ARD.de", displayName: "ARD HD" },
    ];
    expect(
      guideSuggestions({ name: "Das Erste HD", tvgIds: ["ard.hd@SD"] }, guides).map((entry) => [
        entry.guide.xmltvId,
        entry.reason,
      ]),
    ).toEqual([
      ["ard.hd@SD", "sameGuide"],
      ["DasErste.de", "similarName"],
      ["ARD.de", "similarName"],
    ]);
    expect(guideSuggestions({ name: "Kabel 1", tvgIds: [] }, guides)).toEqual([]);
  });
});
