import { describe, expect, it } from "vitest";
import { DateTime } from "effect";
import type { RecordingEntry } from "@slipstream/api";
import { MINUTE, type PlaybackState, RecordingId, UserId } from "@slipstream/domain";
import { makeMockData } from "~/api/mock/fixtures.ts";
import {
  continueRow,
  type HomeData,
  heroRecordingIds,
  initialTab,
  newRow,
  onNowRow,
  scheduledRow,
  selectHero,
} from "./model.ts";

const NOW = Date.UTC(2026, 10, 22, 17, 42);
const at = (ms: number) => DateTime.makeUnsafe(ms);
const alex = UserId.make("alex");
const kim = UserId.make("kim");

/** The fixture household as Alex sees it, with `edit` applied to the library. */
const home = (
  edit: (list: RecordingEntry[]) => RecordingEntry[] = (list) => list,
  extra: Partial<HomeData> = {},
): HomeData => {
  const data = makeMockData(NOW);
  const nowNext = data.channels.map((channel) => ({
    channelId: channel.id,
    now: data.programmes.find(
      (p) =>
        p.channelId === channel.id &&
        DateTime.toEpochMillis(p.start) <= NOW &&
        DateTime.toEpochMillis(p.end) > NOW,
    ),
  }));
  return {
    now: NOW,
    me: alex,
    recordings: edit(data.recordings),
    rules: data.rules,
    sourceCount: data.sources.length,
    channels: data.channels,
    nowNext: nowNext.map(({ channelId, now }) => (now ? { channelId, now } : { channelId })),
    progress: [],
    ...extra,
  };
};

const patch = (id: string, fields: Partial<RecordingEntry>) => (list: RecordingEntry[]) =>
  list.map((entry) => (entry.id === id ? { ...entry, ...fields } : entry));

const stopRunning = patch("rennen-las-vegas", { state: "completed" });
/** Moves every scheduled recording a day later, so nothing starts within the hour. */
const nothingSoon = (list: RecordingEntry[]) =>
  list.map((entry) =>
    entry.state === "scheduled"
      ? {
          ...entry,
          start: at(DateTime.toEpochMillis(entry.start) + 26 * 60 * MINUTE),
          end: at(DateTime.toEpochMillis(entry.end) + 26 * 60 * MINUTE),
        }
      : entry,
  );

describe("selectHero (SPEC §8.1, first match wins)", () => {
  it("is onboarding without a source", () => {
    expect(selectHero(home(undefined, { sourceCount: 0 }))).toEqual({
      kind: "onboarding",
      hasSource: false,
    });
  });

  it("is onboarding with a source but no enabled rule and nothing recorded", () => {
    const data = home(() => [], {});
    const hero = selectHero({ ...data, rules: data.rules.map((r) => ({ ...r, enabled: false })) });
    expect(hero).toEqual({ kind: "onboarding", hasSource: true });
  });

  it("shows what records now, before anything else", () => {
    const hero = selectHero(home());
    expect(hero.kind).toBe("recording");
    expect(hero.kind === "recording" && hero.items.map((e) => e.id)).toEqual(["rennen-las-vegas"]);
  });

  it("lists several running recordings by start, with equal standing", () => {
    const hero = selectHero(
      home(
        patch("tatort-schattenmann", {
          state: "recording",
          start: at(NOW - 100 * MINUTE),
          end: at(NOW + 10 * MINUTE),
        }),
      ),
    );
    expect(hero.kind === "recording" && hero.items.map((e) => e.id)).toEqual([
      "tatort-schattenmann",
      "rennen-las-vegas",
    ]);
  });

  it("says Starts soon when a recording's window opens within the hour", () => {
    // The Tatort starts 15 min from the fixture's now, with 2 min early.
    const hero = selectHero(home(stopRunning));
    expect(hero.kind).toBe("soon");
    expect(hero.kind === "soon" && hero.entry.id).toBe("tatort-schattenmann");
  });

  it("falls back to continue watching, then new, then live on a favourite", () => {
    const resumed = home((list) =>
      nothingSoon(stopRunning(patch("weekend-3", { positionMillis: 41 * MINUTE })(list))),
    );
    const hero = selectHero(resumed);
    expect(hero.kind === "continue" && hero.entry.id).toBe("weekend-3");

    const fresh = selectHero(home((list) => nothingSoon(stopRunning(list))));
    expect(fresh.kind).toBe("new");

    const watchedAll = home((list) =>
      nothingSoon(stopRunning(list)).map((entry) => ({ ...entry, watched: true })),
    );
    const live = selectHero(watchedAll);
    expect(live.kind).toBe("live");
    expect(live.kind === "live" && live.programme.channelId).toBe("sky-sport-f1");
  });

  it("skips continue watching older than a week", () => {
    const old: PlaybackState = {
      userId: alex,
      target: { _tag: "Recording", recordingId: RecordingId.make("weekend-3") },
      positionMillis: 41 * MINUTE,
      watched: false,
      updatedAt: at(NOW - 8 * 24 * 60 * MINUTE),
    };
    const data = home(
      (list) => nothingSoon(stopRunning(patch("weekend-3", { positionMillis: 41 * MINUTE })(list))),
      { progress: [old] },
    );
    expect(selectHero(data).kind).toBe("new");
  });

  it("is idle when nothing at all is on", () => {
    const data = home((list) =>
      nothingSoon(stopRunning(list)).map((entry) => ({ ...entry, watched: true })),
    );
    expect(selectHero({ ...data, nowNext: [] })).toEqual({ kind: "idle" });
  });
});

describe("initialTab", () => {
  const data = home(
    patch("tatort-schattenmann", {
      state: "recording",
      start: at(NOW - 100 * MINUTE),
      end: at(NOW + 10 * MINUTE),
    }),
  );
  const hero = selectHero(data);
  const items = hero.kind === "recording" ? hero.items : [];

  it("picks the recording this profile has a resume position in", () => {
    const resumed = items.map((e) =>
      e.id === "rennen-las-vegas" ? { ...e, positionMillis: 20 * MINUTE } : e,
    );
    expect(initialTab(resumed, kim, data.rules)).toBe(1);
  });

  it("then the one it owns or its rule records", () => {
    expect(initialTab(items, kim, data.rules)).toBe(0);
    expect(initialTab(items, alex, data.rules)).toBe(1);
  });

  it("then the earliest start", () => {
    expect(initialTab(items, UserId.make("guest"), data.rules)).toBe(0);
  });
});

describe("rows", () => {
  it("never repeats the hero's items and never shows a resumed item as new", () => {
    const data = home(patch("weekend-3", { positionMillis: 41 * MINUTE }));
    const hero = selectHero(data);
    const ids = heroRecordingIds(hero);
    expect(ids).toEqual(["rennen-las-vegas"]);
    const cont = continueRow(data, ids).map((e) => e.id);
    const fresh = newRow(data, ids).map((e) => e.id);
    expect(cont).toContain("weekend-3");
    expect(fresh).not.toContain("weekend-3");
    expect(cont.some((id) => fresh.includes(id))).toBe(false);
  });

  it("puts the running recording on its channel in On now", () => {
    const row = onNowRow(home());
    const f1 = row.find((item) => item.channel.id === "sky-sport-f1");
    expect(f1?.recording?.id).toBe("rennen-las-vegas");
    expect(row.some((item) => item.channel.hidden)).toBe(false);
  });

  it("flags every item of an overlap as a conflict", () => {
    const data = makeMockData(NOW);
    const row = scheduledRow(home(), data.conflicts);
    const darts = row.find((item) => item.entry.id === "darts-finale");
    const tatort = row.find((item) => item.entry.id === "tatort-schattenmann");
    expect(darts?.conflict).toBe(true);
    expect(tatort?.conflict).toBe(false);
    expect(row.length).toBeLessThanOrEqual(8);
  });
});
