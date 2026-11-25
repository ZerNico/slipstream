import { describe, expect, it } from "vitest";
import { ChannelId } from "../src/ids.ts";
import {
  type LineupFilter,
  lineupCounts,
  matchesLineup,
  parseLineupNumber,
  previewNumberMove,
  rangeBetween,
  topNumber,
} from "../src/lineup.ts";

const id = (value: string) => ChannelId.make(value);

const channel = (
  name: string,
  number: number | undefined,
  extra: { hidden?: boolean; favourite?: boolean; guideChannelId?: string } = {},
) => ({
  id: id(name.toLowerCase().replaceAll(" ", "-")),
  name,
  ...(number === undefined ? {} : { number }),
  hidden: extra.hidden ?? false,
  favourite: extra.favourite ?? false,
  ...(extra.guideChannelId === undefined ? {} : { guideChannelId: extra.guideChannelId }),
});

const any: LineupFilter = { view: "all", search: "", noGuide: false, favourites: false };

describe("lineup filter", () => {
  const ard = channel("Das Erste HD", 1, { favourite: true, guideChannelId: "daserste.de" });
  const vox = channel("VOX HD", 6, { hidden: true });
  const origin = { sourceIds: new Set(["zattoo"]), groups: new Set(["Deutschland"]) };

  it("keeps visible or hidden channels, those without guide and favourites", () => {
    expect(matchesLineup(ard, { ...any, view: "visible" }, origin)).toBe(true);
    expect(matchesLineup(vox, { ...any, view: "visible" }, origin)).toBe(false);
    expect(matchesLineup(vox, { ...any, view: "hidden" }, origin)).toBe(true);
    expect(matchesLineup(ard, { ...any, noGuide: true }, origin)).toBe(false);
    expect(matchesLineup(vox, { ...any, noGuide: true }, origin)).toBe(true);
    expect(matchesLineup(vox, { ...any, favourites: true }, origin)).toBe(false);
  });

  it("keeps channels of a source or group, never one whose streams are unknown", () => {
    expect(matchesLineup(ard, { ...any, sourceId: "zattoo" }, origin)).toBe(true);
    expect(matchesLineup(ard, { ...any, sourceId: "other" }, origin)).toBe(false);
    expect(matchesLineup(ard, { ...any, group: "Deutschland" }, origin)).toBe(true);
    expect(matchesLineup(ard, { ...any, group: "Sport" }, undefined)).toBe(false);
  });

  it("searches the name, the number from its start and the guide id", () => {
    expect(matchesLineup(ard, { ...any, search: "erste" }, origin)).toBe(true);
    expect(matchesLineup(vox, { ...any, search: "6" }, origin)).toBe(true);
    expect(matchesLineup(ard, { ...any, search: "daserste.de" }, origin)).toBe(true);
    expect(matchesLineup(ard, { ...any, search: "zdf" }, origin)).toBe(false);
  });

  it("counts every chip over the whole lineup", () => {
    expect(lineupCounts([ard, vox])).toEqual({
      all: 2,
      visible: 1,
      hidden: 1,
      noGuide: 1,
      favourites: 1,
    });
  });
});

describe("typing a number", () => {
  const lineup = [
    channel("ProSieben", 5),
    channel("VOX HD", 6),
    channel("kabel eins", 7),
    channel("ProSieben MAXX", 19),
  ];

  it("says who makes room: the holder moves to the next free number, nothing else", () => {
    const move = previewNumberMove(lineup, [id("prosieben-maxx")], 6);
    expect(move).toEqual({
      first: 6,
      last: 6,
      displaced: [{ id: id("vox-hd"), name: "VOX HD", number: 8 }],
      changes: true,
    });
  });

  it("moves several to a run and changes nothing when they are there already", () => {
    expect(previewNumberMove(lineup, [id("prosieben"), id("vox-hd")], 30)).toMatchObject({
      first: 30,
      last: 31,
      displaced: [],
    });
    expect(previewNumberMove(lineup, [id("vox-hd")], 6).changes).toBe(false);
  });

  it("goes to the top at the lowest number", () => {
    expect(topNumber(lineup)).toBe(5);
    expect(topNumber([channel("Unnumbered", undefined)])).toBe(1);
  });

  it("reads whole numbers from 0 only", () => {
    expect(parseLineupNumber(" 12 ")).toBe(12);
    expect(parseLineupNumber("0")).toBe(0);
    expect(parseLineupNumber("-1")).toBeUndefined();
    expect(parseLineupNumber("1.5")).toBeUndefined();
    expect(parseLineupNumber("")).toBeUndefined();
  });
});

describe("shift-click", () => {
  const order = ["a", "b", "c", "d"].map(id);
  it("selects the range between the anchor and the row, either way round", () => {
    expect(rangeBetween(order, id("b"), id("d"))).toEqual(["b", "c", "d"]);
    expect(rangeBetween(order, id("d"), id("b"))).toEqual(["b", "c", "d"]);
    expect(rangeBetween(order, id("x"), id("c"))).toEqual(["c"]);
  });
});
