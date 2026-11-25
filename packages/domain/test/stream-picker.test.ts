import { describe, expect, it } from "vitest";
import { streamQuality } from "../src/channel-match.ts";
import {
  hasStreamsToPick,
  addPlan,
  defaultPicked,
  groupQualities,
  isLanguageGroup,
  type PickerGroup,
  pickedIds,
  pickerKeys,
  pickerRows,
  type PickerStream,
  setPicked,
  shownStreams,
  tickState,
} from "../src/stream-picker.ts";

const stream = (
  id: string,
  name: string,
  group: string | undefined,
  extra: Partial<PickerStream> = {},
): PickerStream => ({
  id,
  name,
  group,
  quality: streamQuality(name),
  hasGuide: true,
  ignored: false,
  ...extra,
});

const group = (name: string | undefined, streams: number): PickerGroup => ({
  name,
  streams,
  guideCoverage: 100,
  added: 0,
  ignored: 0,
});

describe("language groups", () => {
  it.each([
    "DE | Vollprogramm",
    "DE: Sport",
    "[DE] Kinder",
    "|DE| Doku",
    "Sport DE",
    "GER - Nachrichten",
    "Deutschland",
    "German Sports",
  ])("ticks %s for a German reader", (name) => {
    expect(isLanguageGroup(name, "de")).toBe(true);
  });

  it.each([
    "UK | Entertainment",
    "Kinder",
    "Dexter",
    "de luxe",
    "VOD | DE Filme",
    "DE | Radio",
    "DE | XXX",
    "DE Adult",
    "DE | On Demand",
    "18+ DE",
  ])("leaves %s for a German reader", (name) => {
    expect(isLanguageGroup(name, "de")).toBe(false);
  });

  it("knows English groups and nothing for a language without markers", () => {
    expect(isLanguageGroup("UK | Entertainment", "en")).toBe(true);
    expect(isLanguageGroup("US: News", "en-GB")).toBe(true);
    expect(isLanguageGroup("DE | Sport", "en")).toBe(false);
    expect(isLanguageGroup("DE | Sport", "fr")).toBe(false);
  });

  it("ticks the reader's groups of a fresh playlist, never ignored streams", () => {
    const streams = [
      stream("a", "Das Erste HD", "DE | Vollprogramm"),
      stream("b", "ZDF", "DE | Vollprogramm", { ignored: true }),
      stream("c", "BBC One", "UK | Entertainment"),
      stream("d", "Film", "VOD | Filme"),
      stream("e", "Loose", undefined),
    ];
    expect([...defaultPicked(streams, "de", true)]).toEqual(["a"]);
    expect([...defaultPicked(streams, "en", true)]).toEqual(["c"]);
    expect(defaultPicked(streams, "fr", true).size).toBe(0);
  });

  it("ticks nothing on a source already reviewed", () => {
    const streams = [stream("b", "ZDF", "DE | Vollprogramm")];
    expect(defaultPicked(streams, "de", false).size).toBe(0);
  });

  it("still ticks a fresh source whose few streams joined channels by guide id", () => {
    const streams = [
      stream("a", "Das Erste HD", "DE | Vollprogramm", {
        channel: { id: "c1", name: "Das Erste" },
      }),
      stream("b", "ZDF", "DE | Vollprogramm"),
    ];
    expect([...defaultPicked(streams, "de", true)]).toEqual(["b"]);
  });
});

describe("add plan", () => {
  const streams = [
    stream("1", "Das Erste HD", "DE"),
    stream("2", "Das Erste", "DE"),
    stream("3", "DE: Das Erste FHD", "DE"),
    stream("4", "ZDF HD", "DE", {
      match: { channelId: "z", name: "ZDF", reason: "sameGuide" },
    }),
    stream("5", "ZDF SD", "DE"),
    stream("6", "RTL", "DE", { match: { channelId: "r", name: "RTL", reason: "similarName" } }),
    stream("7", "HD", "DE"),
    stream("8", "HD", "DE"),
    stream("9", "Sat.1", "DE", { channel: { id: "s", name: "Sat.1" } }),
  ];
  const keys = pickerKeys(streams);

  it("counts copies as one channel and copies of a guide match as joining", () => {
    const all = new Set(streams.map((item) => item.id));
    // Das Erste (3 copies), RTL (a name match is only a hint), two nameless streams; ZDF joins.
    expect(addPlan(streams, all, keys)).toEqual({ channels: 4, joining: 2 });
    expect(addPlan(streams, new Set(["2", "3"]), keys)).toEqual({ channels: 1, joining: 0 });
    expect(addPlan(streams, new Set(["5"]), keys)).toEqual({ channels: 1, joining: 0 });
    expect(addPlan(streams, new Set(), keys)).toEqual({ channels: 0, joining: 0 });
  });

  it("sends picked streams in list order without the ones already added", () => {
    expect(pickedIds(streams, new Set(["9", "3", "1"]))).toEqual(["1", "3"]);
  });
});

describe("ticks", () => {
  const streams = [
    stream("a", "A", "G"),
    stream("b", "B", "G"),
    stream("c", "C", "G", { channel: { id: "x", name: "C" } }),
  ];

  it("reads a group's box over its pickable streams", () => {
    expect(tickState(streams, new Set())).toBe("off");
    expect(tickState(streams, new Set(["a"]))).toBe("some");
    expect(tickState(streams, new Set(["a", "b"]))).toBe("on");
    expect(tickState([streams[2] as PickerStream], new Set(["c"]))).toBe("off");
  });

  it("ticks and unticks only pickable streams", () => {
    expect([...setPicked(new Set(["z"]), streams, true)].toSorted()).toEqual(["a", "b", "z"]);
    expect([...setPicked(new Set(["a", "z"]), streams, false)]).toEqual(["z"]);
  });

  it("names a group's qualities best first", () => {
    expect(
      groupQualities([stream("1", "X SD", "G"), stream("2", "X FHD", "G"), stream("3", "Y", "G")]),
    ).toEqual(["fhd", "sd"]);
  });
});

describe("rows", () => {
  const groups = [group("DE | Sport", 2), group("UK | News", 1), group(undefined, 1)];
  const streams = [
    stream("1", "Eurosport 1 HD", "DE | Sport"),
    stream("2", "Sport1", "DE | Sport"),
    stream("3", "BBC News", "UK | News"),
    stream("4", "Loose", undefined),
  ];
  const view = { search: "", onlyPicked: false };

  it("lists closed groups, and the streams of open ones", () => {
    const rows = pickerRows(groups, streams, new Set(), new Set(["UK | News"]), view);
    expect(rows.map((row) => row.key)).toEqual(["g:DE | Sport", "g:UK | News", "3", "g:"]);
    expect(shownStreams(rows).map((item) => item.id)).toEqual(["1", "2", "3", "4"]);
  });

  it("keeps groups whose streams have not loaded, closed", () => {
    const rows = pickerRows(groups, [], new Set(), new Set(["DE | Sport"]), view);
    expect(rows.map((row) => row.key)).toEqual(["g:DE | Sport", "g:UK | News", "g:"]);
  });

  it("shows only groups with matches, opened, for a search", () => {
    const rows = pickerRows(groups, streams, new Set(), new Set(), { ...view, search: " SPORT" });
    expect(rows.map((row) => row.key)).toEqual(["g:DE | Sport", "1", "2"]);
  });

  it("shows only ticked streams under Selected", () => {
    const rows = pickerRows(groups, streams, new Set(["3"]), new Set(), {
      ...view,
      onlyPicked: true,
    });
    expect(rows.map((row) => row.key)).toEqual(["g:UK | News", "3"]);
  });

  it("shows only new streams under New", () => {
    const fresh = streams.map((item) => (item.id === "2" ? { ...item, new: true } : item));
    const rows = pickerRows(groups, fresh, new Set(), new Set(), { ...view, onlyNew: true });
    expect(rows.map((row) => row.key)).toEqual(["g:DE | Sport", "2"]);
  });
});

/** A group's counts for {@link hasStreamsToPick}. */
const counts = (streams: number, added: number, ignored = 0) => ({
  streams,
  guideCoverage: 0,
  added,
  ignored,
});

describe("hasStreamsToPick", () => {
  it("asks for picking while streams are left, even with some joined by guide id", () => {
    expect(hasStreamsToPick([counts(4782, 8)])).toBe(true);
    expect(hasStreamsToPick([counts(25, 25)])).toBe(false);
    expect(hasStreamsToPick([counts(10, 4, 6)])).toBe(false);
    expect(hasStreamsToPick([])).toBe(false);
  });
});
