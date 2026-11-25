import { channelChangePayload, moveItem } from "../src/channel-order.ts";
import { ChannelId } from "../src/ids.ts";
import { describe, expect, it } from "vitest";

const [a, b, c] = ["a", "b", "c"].map((id) => ChannelId.make(id)) as [
  ChannelId,
  ChannelId,
  ChannelId,
];

describe("channel order", () => {
  it("moves an item down and up", () => {
    expect(moveItem([a, b, c], 0, 2)).toEqual([b, c, a]);
    expect(moveItem([a, b, c], 2, 0)).toEqual([c, a, b]);
  });
});

describe("channelChangePayload", () => {
  it("sends a logo set back to automatic as null and leaves absent fields out", () => {
    expect(channelChangePayload({ logoUrl: undefined })).toEqual({ logoUrl: null });
    expect(channelChangePayload({ hidden: true })).toEqual({ hidden: true });
    expect(channelChangePayload({ logoUrl: "http://a/l.png" })).toEqual({
      logoUrl: "http://a/l.png",
    });
  });
});
