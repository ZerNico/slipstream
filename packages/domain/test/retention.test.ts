import { describe, expect, it } from "vitest";
import { CollectionId, RuleId } from "../src/ids.ts";
import type { RecordingState } from "../src/recording.ts";
import {
  applyRetention,
  eventOf,
  governingRetention,
  type RetentionItem,
} from "../src/retention.ts";
import { at, collection, skyF1, subject, timeZone } from "./test-support.ts";

interface Item extends RetentionItem {
  readonly name: string;
}

const item = (
  name: string,
  day: number,
  fields: { state?: RecordingState; protected?: boolean; event?: string } = {},
): Item => ({
  name,
  start: at(`2026-11-${String(day).padStart(2, "0")}T13:00:00Z`),
  end: at(`2026-11-${String(day).padStart(2, "0")}T15:00:00Z`),
  state: fields.state ?? "completed",
  protected: fields.protected ?? false,
  event: fields.event,
});

const now = Date.UTC(2026, 10, 21, 12);
const names = (entries: ReadonlyArray<{ readonly item: Item }>) =>
  entries.map((entry) => entry.item.name);

describe("keep the newest N", () => {
  const items = [item("a", 1), item("b", 8), item("c", 15), item("d", 20)];

  it("deletes everything beyond the newest N and says so", () => {
    const verdict = applyRetention({ _tag: "KeepNewest", count: 2 }, items, now);
    expect(verdict.remove).toEqual([
      { item: items[0], reason: { _tag: "BeyondNewest", count: 2 } },
      { item: items[1], reason: { _tag: "BeyondNewest", count: 2 } },
    ]);
    expect(names(verdict.keep)).toEqual(["c", "d"]);
    expect(verdict.keep.every((entry) => entry.reason === "withinPolicy")).toBe(true);
  });

  it("keeps protected recordings without giving them a slot", () => {
    const withProtected = [item("old-protected", 2, { protected: true }), ...items];
    const verdict = applyRetention({ _tag: "KeepNewest", count: 2 }, withProtected, now);
    expect(names(verdict.remove)).toEqual(["a", "b"]);
    expect(verdict.keep).toContainEqual({ item: withProtected[0], reason: "protected" });
  });

  it("counts a running recording as the newest but never deletes it, and ignores scheduled ones", () => {
    const running = item("running", 21, { state: "recording" });
    const scheduled = item("next", 28, { state: "scheduled" });
    const verdict = applyRetention(
      { _tag: "KeepNewest", count: 2 },
      [...items, running, scheduled],
      now,
    );
    expect(names(verdict.remove)).toEqual(["a", "b", "c"]);
    expect(verdict.keep).toEqual([
      { item: items[3], reason: "withinPolicy" },
      { item: running, reason: "active" },
      { item: scheduled, reason: "active" },
    ]);
  });
});

describe("keep the newest N events", () => {
  const items = [
    item("katar-quali", 1, { event: "GP Katar" }),
    item("katar-race", 2, { event: "GP Katar" }),
    item("vegas-quali", 8, { event: "GP Las Vegas" }),
    item("vegas-race", 9, { event: "gp  las vegas" }),
    item("abu-dhabi-race", 16, { event: "GP Abu Dhabi" }),
    item("review", 3),
  ];

  it("keeps whole events, the newest first, and leaves titles without an event alone", () => {
    const verdict = applyRetention({ _tag: "KeepNewestEvents", count: 2 }, items, now);
    expect(verdict.remove).toEqual([
      { item: items[0], reason: { _tag: "BeyondNewestEvents", count: 2, event: "GP Katar" } },
      { item: items[1], reason: { _tag: "BeyondNewestEvents", count: 2, event: "GP Katar" } },
    ]);
    expect(verdict.keep).toContainEqual({ item: items[5], reason: "noEvent" });
    expect(names(verdict.keep)).toContain("vegas-race");
  });
});

describe("keep days", () => {
  it("deletes recordings that ended more than X days ago", () => {
    const items = [item("old", 1), item("edge", 14), item("new", 20)];
    const verdict = applyRetention({ _tag: "KeepDays", days: 7 }, items, now);
    // Seven days before now is 14 Nov 12:00; "edge" ended at 15:00 that day, so it stays.
    expect(verdict.remove).toEqual([{ item: items[0], reason: { _tag: "OlderThan", days: 7 } }]);
    expect(names(verdict.keep)).toEqual(["edge", "new"]);
  });

  it("lets a recording go once its end falls out of the window", () => {
    const later = Date.UTC(2026, 10, 21, 16);
    const verdict = applyRetention({ _tag: "KeepDays", days: 7 }, [item("edge", 14)], later);
    expect(names(verdict.remove)).toEqual(["edge"]);
  });
});

describe("keep all and precedence", () => {
  it("keeps everything", () => {
    const verdict = applyRetention({ _tag: "KeepAll" }, [item("a", 1)], now);
    expect(verdict).toEqual({ remove: [], keep: [{ item: item("a", 1), reason: "keepAll" }] });
  });

  it("prefers the collection's policy over the rule's", () => {
    const f1 = CollectionId.make("f1");
    const rule = { id: RuleId.make("f1"), retention: { _tag: "KeepNewest" as const, count: 1 } };
    expect(governingRetention({ id: f1, retention: { _tag: "KeepDays", days: 3 } }, rule)).toEqual({
      retention: { _tag: "KeepDays", days: 3 },
      from: { _tag: "Collection", collectionId: f1 },
    });
    expect(governingRetention({ id: f1 }, rule)?.from).toEqual({ _tag: "Rule", ruleId: rule.id });
    expect(governingRetention({ id: f1 }, undefined)).toBeUndefined();
  });
});

describe("the collection's Event part", () => {
  const f1 = collection("f1", "Formel 1", {
    matcher: { title: [{ _tag: "StartsWith", values: ["F1:", "Live F1:"] }] },
    layout: {
      parts: [
        { _tag: "Split", name: "event", after: { separator: " - ", occurrence: "last" } },
        { _tag: "Split", name: "programme", before: { separator: " - ", occurrence: "last" } },
      ],
      path: ["{year}", "{event}", "{programme}"],
    },
  });
  const race = subject({
    channelId: skyF1,
    title: "Live F1: Rennen - GP Las Vegas",
    start: at("2026-11-22T04:00:00Z"),
    end: at("2026-11-22T06:00:00Z"),
  });

  it("reads the event from the title", () => {
    expect(eventOf(f1, race, timeZone)).toBe("GP Las Vegas");
  });

  it("has no event when the title cannot be split or the layout has no Event part", () => {
    expect(
      eventOf(f1, { ...race, title: "Live F1: Saisonrückblick 2026" }, timeZone),
    ).toBeUndefined();
    const flat = { ...f1, layout: { parts: [], path: [] } };
    expect(eventOf(flat, race, timeZone)).toBeUndefined();
  });
});

const chain = (name: string, day: number, fields: Partial<Item> = {}): Item => ({
  ...item(name, day),
  id: name,
  ...fields,
});

describe("repeat chains (§5.4)", () => {
  it("counts a damaged original and its repeat as one episode", () => {
    const items = [
      chain("a", 1),
      chain("b", 8, { state: "failed" }),
      chain("b-repeat", 10, { replacesId: "b" }),
      chain("c", 15),
    ];
    const verdict = applyRetention({ _tag: "KeepNewest", count: 2 }, items, now);
    expect(names(verdict.remove)).toEqual(["a"]);
  });

  it("removes every member of a chain beyond the newest", () => {
    const items = [
      chain("a", 1, { state: "failed" }),
      chain("a-repeat", 2, { replacesId: "a" }),
      chain("b", 8),
    ];
    const verdict = applyRetention({ _tag: "KeepNewest", count: 1 }, items, now);
    expect(names(verdict.remove)).toEqual(["a", "a-repeat"]);
  });

  it("never deletes a chain that is still looking or has a repeat scheduled", () => {
    const items = [
      chain("a", 1, { state: "incomplete", rerun: "looking" }),
      chain("b", 2, { state: "failed", rerun: "scheduled" }),
      chain("c", 15),
    ];
    const verdict = applyRetention({ _tag: "KeepDays", days: 7 }, items, now);
    expect(verdict.remove).toEqual([]);
    expect(verdict.keep).toContainEqual({ item: items[0], reason: "rerun" });
    expect(verdict.keep).toContainEqual({ item: items[1], reason: "rerun" });
  });

  it("neither counts nor removes hidden recordings", () => {
    const items = [
      chain("old", 1, { hiddenAt: at("2026-11-02T00:00:00Z") }),
      chain("b", 8),
      chain("c", 15),
    ];
    const verdict = applyRetention({ _tag: "KeepNewest", count: 2 }, items, now);
    expect(verdict.remove).toEqual([]);
    expect(verdict.keep).toContainEqual({ item: items[0], reason: "hidden" });
  });
});
