import { describe, expect, it } from "vitest";
import { DateTime } from "effect";
import type { RecordingEntry } from "@slipstream/api";
import { makeMockData } from "~/api/mock/fixtures.ts";
import { formatClock } from "~/i18n/formats.ts";
import { dayPill } from "@slipstream/i18n";
import { heroView, itemTitle, titleSteps, type HeroContext } from "./hero-view.ts";
import { MINUTE } from "@slipstream/domain";

const NOW = Date.UTC(2026, 10, 22, 17, 42);
const data = makeMockData(NOW);
const context: HeroContext = {
  now: NOW,
  channels: data.channels,
  timeZone: "Europe/Berlin",
};
const entry = (id: string, fields: Partial<RecordingEntry> = {}): RecordingEntry => {
  const found = data.recordings.find((candidate) => candidate.id === id);
  if (found === undefined) throw new Error(`fixture ${id} missing`);
  return { ...found, ...fields };
};
const race = entry("rennen-las-vegas");
const raceStart = DateTime.toEpochMillis(race.start) - race.padding.beforeMinutes * MINUTE;

describe("hero copy (SPEC §8.1, §7.9)", () => {
  it("names a running recording's moment on the wall clock, in the button and the read line", () => {
    const resumed = entry("rennen-las-vegas", { positionMillis: 41 * MINUTE });
    const view = heroView({ kind: "recording", items: [resumed] }, 0, context);
    const clock = formatClock(raceStart + 41 * MINUTE);
    expect(view.title).toBe("Rennen");
    expect(view.eyebrow).toMatch(/^Formel 1 · GP Las Vegas · started /u);
    expect(view.actions.map((action) => action.kind)).toEqual(["primary", "glass", "fold", "info"]);
    expect(view.actions[0]?.label).toBe(`Resume at ${clock}`);
    expect(view.actions[0]?.short).toBe(`Resume ${clock}`);
    expect(view.read).toMatchObject({ kind: "behind", stoppedAt: raceStart + 41 * MINUTE });
    // The programme's own description, never words about the recording.
    expect(view.description).toBe(resumed.description ?? "");
    expect(view.badges.map((badge) => badge.text)).toEqual(["Recording"]);
    expect(view.timeline?.playhead).toBe(raceStart + 41 * MINUTE);
    expect(view.timeline?.live).toBe(NOW);
  });

  it("offers Watch from start and Watch live without a position, and no amber knob", () => {
    const view = heroView({ kind: "recording", items: [race] }, 0, context);
    expect(view.actions.map((action) => action.label).slice(0, 2)).toEqual([
      "Watch from start",
      "Watch live",
    ]);
    expect(view.timeline?.playhead).toBeUndefined();
    expect(view.read).toMatchObject({ kind: "text" });
    // The read line says when it started, so the eyebrow doesn't say it twice.
    expect(view.read?.kind === "text" ? view.read.text : "").toMatch(/started/iu);
    expect(view.eyebrow).toBe("Formel 1 · GP Las Vegas");
  });

  it("names a finished recording's position with its length", () => {
    const weekend = entry("weekend-3", { positionMillis: 41 * MINUTE });
    const view = heroView({ kind: "continue", entry: weekend }, 0, context);
    expect(view.actions[0]?.label).toBe("Resume from 41:00");
    expect(view.read).toMatchObject({ kind: "position", position: "41:00", length: "2:15:00" });
    expect(view.relative).toBe(true);
    expect(view.badges).toEqual([]);
  });

  it("anchors Starts soon to a now marker and offers the recording options", () => {
    const tatort = entry("tatort-schattenmann");
    const view = heroView({ kind: "soon", entry: tatort, onAir: undefined }, 0, context);
    expect(view.badges).toEqual([]);
    expect(view.timeline?.now).toBe(NOW);
    expect(view.timeline?.playhead).toBeUndefined();
    expect(view.actions[0]).toMatchObject({ kind: "primary", label: "Recording options" });
    expect(view.actions[1]?.label).toBe("Watch Das Erste now");
  });

  it("names days in the eyebrow as the guide's pills do (decision 11)", () => {
    const weekend = entry("weekend-3");
    const day = dayPill(DateTime.toEpochMillis(weekend.start), NOW, "Europe/Berlin");
    expect(day).toMatch(/^(Today \d+|[A-Z][a-z]{2} \d+)$/u);
    const continued = heroView({ kind: "continue", entry: weekend }, 0, context);
    expect(continued.eyebrow.endsWith(` · ${day}`)).toBe(true);
    const tatort = entry("tatort-schattenmann");
    const soon = heroView({ kind: "soon", entry: tatort, onAir: undefined }, 0, context);
    expect(soon.eyebrow).toContain(" · Today 22 · ");
    expect(soon.eyebrow.endsWith(` · ${formatClock(DateTime.toEpochMillis(tatort.start))}`)).toBe(
      true,
    );
  });

  it("walks a new household through onboarding with one action at a time", () => {
    const fresh = heroView({ kind: "onboarding", hasSource: false }, 0, context);
    expect(fresh.actions.map((action) => action.target)).toEqual([{ to: "sources" }]);
    expect(fresh.badges).toEqual([]);
    expect(fresh.description).toBe("");
    // A series recording starts from a programme: the guide.
    const half = heroView({ kind: "onboarding", hasSource: true }, 0, context);
    expect(half.title).toBe("Record a series");
    expect(half.actions.map((action) => action.target)).toEqual([{ to: "guide" }]);
  });

  it("calls an item grouped by its air time by its title", () => {
    expect(itemTitle(entry("darts-finale"))).toBe("Darts: Grand Slam - Finale");
  });

  it("steps long titles down before they truncate", () => {
    expect(titleSteps("Rennen")).toEqual({
      "data-s2": undefined,
      "data-s3": undefined,
      "data-p2": undefined,
    });
    expect(titleSteps("Darts: Grand Slam - Finale")).toEqual({
      "data-s2": "",
      "data-s3": "",
      "data-p2": "",
    });
  });
});
