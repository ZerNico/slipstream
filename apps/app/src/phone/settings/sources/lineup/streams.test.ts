import type { SourceStreamEntry } from "@slipstream/api";
import {
  ChannelId,
  ChannelStreamId,
  SourceId,
  SourceStreamId,
  type ChannelStream,
} from "@slipstream/domain";
import { describe, expect, it } from "vitest";
import { groupOf, moveBy, orderedStreams, originOf, streamsByChannel } from "./streams.ts";

const ard = ChannelId.make("ard");
const zattoo = SourceId.make("zattoo");
const iptv = SourceId.make("iptv");

const entry = (id: string, name: string, extra: Partial<SourceStreamEntry> = {}) =>
  ({
    id: SourceStreamId.make(id),
    name,
    quality: "hd",
    qualityRank: 2,
    hasGuide: true,
    new: false,
    ignored: false,
    gone: false,
    channel: { id: ard, name: "Das Erste HD" },
    ...extra,
  }) satisfies SourceStreamEntry;

const pages = [
  { sourceId: zattoo, sourceName: "Zattoo", streams: [entry("z1", "Das Erste HD")] },
  {
    sourceId: iptv,
    sourceName: "IPTV",
    streams: [
      entry("i1", "DE: Das Erste FHD", { group: "Deutschland", quality: "fhd" }),
      // Not added to a channel: no `channel` at all.
      (({ channel: _channel, ...free }) => free)(entry("i2", "Free stream")),
    ],
  },
];

describe("lineup streams on the phone", () => {
  it("groups added streams by channel with their source, and skips streams not added", () => {
    const streams = streamsByChannel(pages).get(ard) ?? [];
    expect(streams.map((stream) => [stream.name, stream.sourceName])).toEqual([
      ["Das Erste HD", "Zattoo"],
      ["DE: Das Erste FHD", "IPTV"],
    ]);
    expect(groupOf(streams)).toBe("Deutschland");
    expect(originOf(streams)).toEqual({
      sourceIds: new Set([zattoo, iptv]),
      groups: new Set(["", "Deutschland"]),
    });
  });

  it("orders a channel's streams by priority, leaving out unknown ones", () => {
    const known = streamsByChannel(pages).get(ard);
    const link = (id: string, priority: number): ChannelStream => ({
      id: ChannelStreamId.make(`l-${id}`),
      channelId: ard,
      sourceStreamId: SourceStreamId.make(id),
      priority,
    });
    expect(
      orderedStreams([link("z1", 1), link("i1", 0), link("x", 2)], known).map((s) => s.id),
    ).toEqual(["i1", "z1"]);
  });

  it("swaps a row with its neighbour and ignores a move past the ends", () => {
    expect(moveBy(["a", "b", "c"], 0, 1)).toEqual(["b", "a", "c"]);
    expect(moveBy(["a", "b", "c"], 0, -1)).toEqual(["a", "b", "c"]);
  });
});
