import { type Channel, ChannelId } from "@slipstream/domain";
import { describe, expect, it } from "vitest";
import { numberMoveText } from "./number-text.ts";

const channel = (id: string, name: string, number: number): Channel => ({
  id: ChannelId.make(id),
  name,
  number,
  favourite: false,
  hidden: false,
});

const lineup = [
  channel("vox", "VOX HD", 6),
  channel("kabel", "kabel eins", 7),
  channel("maxx", "ProSieben MAXX", 19),
  channel("sixx", "sixx", 20),
];

describe("the number preview", () => {
  it("names the one channel that makes room and where it goes", () => {
    expect(numberMoveText(lineup, [ChannelId.make("maxx")], 6)).toBe(
      "Move to 6 · VOX HD moves to 8",
    );
  });

  it("says a run for several, and when nothing else moves", () => {
    expect(numberMoveText(lineup, [ChannelId.make("maxx"), ChannelId.make("sixx")], 30)).toBe(
      "Move to 30–31 · Nothing else changes",
    );
  });

  it("counts several channels that make room", () => {
    expect(numberMoveText(lineup, [ChannelId.make("maxx"), ChannelId.make("sixx")], 6)).toBe(
      "Move to 6–7 · 2 channels move to the next free number",
    );
  });
});
