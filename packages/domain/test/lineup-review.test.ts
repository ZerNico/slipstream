import { describe, expect, it } from "vitest";
import { ChannelId, SourceId, SourceStreamId } from "../src/ids.ts";
import {
  addKind,
  goneChannels,
  hasReview,
  type LineupReview,
  reviewSummary,
  suggestionGroups,
  suggestionKey,
} from "../src/lineup-review.ts";

const zattoo = SourceId.make("zattoo");
const iptv = SourceId.make("iptv");
const ref = (id: string, name: string) => ({ id: ChannelId.make(id), name });
const candidate = (id: string, name: string, source: string) => ({
  ...ref(id, name),
  streams: [{ name, sourceName: source }],
});

const review: LineupReview = {
  mergeSuggestions: [
    {
      channels: [candidate("zdf", "ZDF HD", "Zattoo"), candidate("zdf2", "DE: ZDF FHD", "IPTV")],
      reason: "sameGuide",
    },
    {
      channels: [candidate("ntv", "n-tv HD", "Zattoo"), candidate("ntv2", "DE: NTV HD", "IPTV")],
      reason: "similarName",
    },
    {
      channels: [candidate("ard", "Das Erste", "Zattoo"), candidate("ard2", "DE: ARD", "IPTV")],
      reason: "sameGuide",
    },
  ],
  sources: [
    { sourceId: zattoo, name: "Zattoo", newStreams: 0, goneStreams: 0 },
    { sourceId: iptv, name: "IPTV", newStreams: 14, goneStreams: 3 },
  ],
  goneStreams: [
    {
      sourceStreamId: SourceStreamId.make("s1"),
      sourceId: iptv,
      name: "DE: Sky Sport News",
      channel: ref("sky", "Sky Sport News"),
      playsFrom: "Zattoo",
    },
    {
      sourceStreamId: SourceStreamId.make("s2"),
      sourceId: iptv,
      name: "DE: Comedy Central",
      channel: ref("cc", "Comedy Central"),
    },
    {
      sourceStreamId: SourceStreamId.make("s3"),
      sourceId: iptv,
      name: "DE: Comedy Central SD",
      channel: ref("cc", "Comedy Central"),
    },
  ],
  withoutStreams: [ref("cc", "Comedy Central"), ref("empty", "Empty")],
};

describe("needs review", () => {
  it("counts what the rows say", () => {
    const summary = reviewSummary(review);
    expect(summary).toEqual({
      merge: 3,
      mergeSources: 2,
      newStreams: 14,
      newSources: [{ id: iptv, name: "IPTV" }],
      goneStreams: 3,
      goneSources: ["IPTV"],
      withoutStreams: 2,
    });
    expect(hasReview(summary)).toBe(true);
    expect(
      hasReview(
        reviewSummary({ mergeSuggestions: [], sources: [], goneStreams: [], withoutStreams: [] }),
      ),
    ).toBe(false);
  });

  it("groups suggestions by confidence, same guide channel first", () => {
    const groups = suggestionGroups(review.mergeSuggestions);
    expect(groups.map((group) => [group.reason, group.suggestions.map(suggestionKey)])).toEqual([
      ["sameGuide", ["zdf+zdf2", "ard+ard2"]],
      ["similarName", ["ntv+ntv2"]],
    ]);
  });

  it("lists channels without a stream first, each once", () => {
    expect(
      goneChannels(review).map((entry) => [
        entry.channel.name,
        entry.gone.length,
        entry.noStream,
        entry.playsFrom,
      ]),
    ).toEqual([
      ["Comedy Central", 2, true, undefined],
      ["Empty", 0, true, undefined],
      ["Sky Sport News", 1, false, "Zattoo"],
    ]);
  });

  it("adds a free stream, moves one from another channel, and leaves one already here", () => {
    const found = {
      id: "s",
      name: "DE: Kabel 1",
      sourceId: iptv,
      sourceName: "IPTV",
      group: undefined,
    };
    const kabel = ChannelId.make("kabel");
    expect(addKind({ ...found, channel: undefined }, kabel)).toBe("add");
    expect(addKind({ ...found, channel: ref("kabel", "kabel eins") }, kabel)).toBe("here");
    expect(addKind({ ...found, channel: ref("doku", "kabel eins Doku") }, kabel)).toBe("move");
  });
});
