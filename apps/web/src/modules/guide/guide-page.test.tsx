// @vitest-environment happy-dom
import { Effect } from "effect";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLocale, setRegion } from "@slipstream/i18n";
import { MINUTE } from "@slipstream/domain";
import { mockTimeZone } from "~/api/mock/fixtures.ts";
import { media } from "~/ui/use-media-query.ts";
import { GuidePage, type GuideSearch } from "./guide-page.tsx";
import { dayKey } from "./model.ts";
import { type GuideHarness, mountGuide, setMedia } from "./test-harness.tsx";

/** The page with its search params held in state, as the route holds them in the URL. */
function Harness({ initial }: { initial?: GuideSearch }) {
  const [search, setSearch] = useState<GuideSearch>(initial ?? {});
  return (
    <GuidePage
      search={search}
      onSearch={(patch) =>
        setSearch((previous) => {
          const next: Record<string, string> = {};
          for (const [key, value] of Object.entries({ ...previous, ...patch })) {
            if (value !== undefined) next[key] = value;
          }
          return next;
        })
      }
    />
  );
}

let harness: GuideHarness | undefined;
beforeEach(() => {
  setLocale("en");
  setRegion("GB");
  // The mock guide is laid out around now; an evening on the sample day keeps every programme
  // the tests name on "today", whatever the time the tests run (near midnight, Darts was
  // tomorrow's).
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-22T17:30:00Z"));
});
afterEach(async () => {
  vi.useRealTimers();
  await harness?.unmount();
  harness = undefined;
  setMedia([]);
  setRegion(undefined);
});

const cells = () => [
  ...document.querySelectorAll<HTMLButtonElement>("#guide-grid button[data-index]"),
];
const label = (start: string) =>
  cells()
    .find((cell) => cell.getAttribute("aria-label")?.startsWith(start))
    ?.getAttribute("aria-label");

describe("guide on a phone", () => {
  it("opens on the Channels view: what is on now on every visible channel, what comes next", async () => {
    setMedia([media.menuAsSheet]);
    harness = await mountGuide(<Harness />);
    const { waitFor } = harness;
    await waitFor(() =>
      expect(document.body.textContent).toContain("Live F1: Rennen - GP Las Vegas"),
    );
    const list = document.querySelector('[role="list"]');
    expect(list?.getAttribute("aria-label")).toBe("On now");
    expect(list?.textContent).toContain("min left");
    // The hidden shopping channel never shows; the seven visible ones do.
    expect(document.querySelectorAll('[role="listitem"]')).toHaveLength(7);
    expect(document.body.textContent).not.toContain("Teleshop");
    // Channels view is pressed in the one view switch, Timeline first.
    const segments = [...document.querySelectorAll('[aria-label="View"] button')];
    expect(segments.map((segment) => segment.textContent)).toEqual(["Timeline", "Channels"]);
  });

  it("answers what's on at prime time from the slot chips", async () => {
    harness = await mountGuide(<Harness />);
    const { waitFor, click } = harness;
    await waitFor(() =>
      expect(document.querySelector('[role="list"]')?.textContent).toContain("Tatort"),
    );
    const prime = [...document.querySelectorAll('[aria-label="What\'s on at"] button')].find(
      (chip) => chip.textContent?.includes("Prime time"),
    );
    await click(prime);
    await waitFor(() =>
      expect(document.querySelector('[role="list"]')?.getAttribute("aria-label")).toBe(
        "On at 20:15",
      ),
    );
  });

  it("shows the same timeline grid as on larger screens, every channel scrolling together", async () => {
    harness = await mountGuide(<Harness initial={{ view: "timeline" }} />);
    await harness.waitFor(() => expect(cells().length).toBeGreaterThan(20));
    expect(document.querySelectorAll("#guide-grid [data-row]")).toHaveLength(7);
    expect(document.querySelector("[data-strip]")).toBeNull();
  });
});

describe("guide from 768 px", () => {
  beforeEach(() => setMedia([media.tablet, media.desktop, media.finePointer]));

  it("draws the timeline grid with channel-first cell labels and the now line", async () => {
    harness = await mountGuide(<Harness />);
    await harness.waitFor(() => expect(cells().length).toBeGreaterThan(20));
    const region = document.querySelector("#guide-grid");
    expect(region?.getAttribute("role")).toBe("region");
    const race = cells().find((cell) =>
      cell.getAttribute("aria-label")?.includes("Live F1: Rennen"),
    );
    expect(race?.getAttribute("aria-label")).toMatch(
      /^Sky Sport F1, Live F1: Rennen - GP Las Vegas, today, \d\d:\d\d to \d\d:\d\d, live now, recording$/u,
    );
    // One cell takes Tab: the first programme on air.
    const tabbable = cells().filter((cell) => cell.tabIndex === 0);
    expect(tabbable).toEqual([race]);
  });

  it("moves between programmes with the arrow keys, keeping the time across rows", async () => {
    harness = await mountGuide(<Harness />);
    const { waitFor, key } = harness;
    await waitFor(() => expect(cells().some((cell) => cell.tabIndex === 0)).toBe(true));
    const start = cells().find((cell) => cell.tabIndex === 0);
    start?.focus();
    await key("ArrowDown");
    // Row 2 is Sky Sport 1; what airs there now is NBA.
    expect(document.activeElement?.getAttribute("aria-label")).toMatch(
      /^Sky Sport 1, NBA: Lakers - Celtics, today, .*live now/u,
    );
    expect((document.activeElement as HTMLElement).tabIndex).toBe(0);
    await key("ArrowRight");
    expect(document.activeElement?.getAttribute("aria-label")).toMatch(/^Sky Sport 1, Darts/u);
    await key("ArrowUp");
    expect(document.activeElement?.getAttribute("aria-label")).toMatch(/^Sky Sport F1, /u);
  });

  it("opens the programme sheet in the URL from a cell", async () => {
    harness = await mountGuide(<Harness />);
    const { waitFor, click, url } = harness;
    await waitFor(() => expect(cells().length).toBeGreaterThan(20));
    const tatort = cells().find((cell) =>
      cell.getAttribute("aria-label")?.startsWith("Das Erste, Tatort"),
    );
    await click(tatort);
    expect(url()).toMatch(/[?&]sheet=prog%3Adas-erste%3A\d+/u);
  });

  it("dims what the category doesn't match without hiding it", async () => {
    harness = await mountGuide(<Harness initial={{ cat: "sport" }} />);
    await harness.waitFor(() => expect(cells().length).toBeGreaterThan(20));
    const tatort = cells().find((cell) =>
      cell.getAttribute("aria-label")?.startsWith("Das Erste, Tatort"),
    );
    const race = cells().find((cell) =>
      cell.getAttribute("aria-label")?.includes("Live F1: Rennen"),
    );
    expect(tatort?.className).toContain("opacity-[.28]");
    expect(race?.className).not.toContain("opacity-[.28]");
    expect(
      document.querySelector('[aria-label="Category"] [aria-pressed="true"]')?.textContent,
    ).toBe("Sport");
  });

  it("marks recording, scheduled and conflicting programmes", async () => {
    harness = await mountGuide(<Harness />);
    await harness.waitFor(() => expect(cells().length).toBeGreaterThan(20));
    expect(label("Das Erste, Tatort")).toMatch(/scheduled$/u);
    expect(label("Sky Sport 1, Darts: Grand Slam - Finale")).toMatch(/scheduled, conflict$/u);
  });

  it("marks an episode the viewer already has with a quiet check", async () => {
    // The replay airs 350 minutes from now (fixtures): show the household day it falls on.
    const replayDay = dayKey(Date.now() + 350 * MINUTE, mockTimeZone);
    const today = dayKey(Date.now(), mockTimeZone);
    harness = await mountGuide(
      <Harness {...(replayDay === today ? {} : { initial: { day: replayDay } })} />,
      {
        prepare: (server) => {
          // The semi-final went well after all, so its replay is a repeat for the Darts series.
          server.data.recordings = server.data.recordings.map((entry) =>
            entry.id === "darts-halbfinale-failed"
              ? { ...entry, state: "completed", problems: [] }
              : entry,
          );
        },
      },
    );
    const replay = "Sky Sport 1, Darts: Grand Slam - Halbfinale (Wh.)";
    await harness.waitFor(() => expect(label(replay)).toMatch(/, already recorded$/u));
    const cell = cells().find((candidate) =>
      candidate.getAttribute("aria-label")?.startsWith(replay),
    );
    expect(cell?.getAttribute("data-mark")).toBe("repeat");
    expect(cell?.querySelector("[data-mark-check]")).not.toBeNull();
  });

  it("runs one timeline across the days, each midnight naming its day", async () => {
    harness = await mountGuide(<Harness />);
    await harness.waitFor(() => expect(cells().length).toBeGreaterThan(20));
    const midnights = [...document.querySelectorAll("#guide-grid [data-ruler-tick][data-day]")];
    expect(midnights.length).toBeGreaterThan(1);
    expect(midnights[1]?.textContent).toMatch(/^[A-Z][a-z]{2}\s?\d+$/u);
  });

  it("switches days with the day switcher: the day in view, arrows, no pills", async () => {
    harness = await mountGuide(<Harness />);
    await harness.waitFor(() => expect(cells().length).toBeGreaterThan(20));
    const group = document.querySelector('[aria-label="Day"][role="group"]');
    expect(group?.querySelector("[data-day-switcher]")?.textContent).toMatch(/^Today$/u);
    expect(
      group?.querySelector('button[aria-label="Previous day"]')?.hasAttribute("disabled"),
    ).toBe(true);
    expect(group?.querySelector('button[aria-label="Next day"]')?.hasAttribute("disabled")).toBe(
      false,
    );
    expect(document.querySelectorAll('[aria-label="Day"] [aria-pressed]')).toHaveLength(0);
  });
});

describe("guide failures", () => {
  it("says a failed read of the repeat marks and loads the day on Try again", async () => {
    setMedia([media.menuAsSheet]);
    let down = true;
    harness = await mountGuide(<Harness />, {
      wrap: (api) => ({
        ...api,
        call: (f) =>
          api.call((client) => {
            const repeats = ((request) =>
              down
                ? Effect.die(new Error("down"))
                : client.guide.repeats(request)) as typeof client.guide.repeats;
            return f({ ...client, guide: { ...client.guide, repeats } });
          }),
      }),
    });
    const { waitFor, click } = harness;
    await waitFor(() => expect(document.body.textContent).toContain("Couldn't load the guide"));
    down = false;
    const retry = [...document.querySelectorAll("button")].find(
      (button) => button.textContent === "Try again",
    );
    await click(retry);
    await waitFor(() =>
      expect(document.body.textContent).toContain("Live F1: Rennen - GP Las Vegas"),
    );
    expect(document.body.textContent).not.toContain("Couldn't load the guide");
  });
});

describe("guide in short landscape", () => {
  it("keeps one header row: the day switcher and Filter instead of chips", async () => {
    setMedia([media.shortLandscape]);
    harness = await mountGuide(<Harness />);
    await harness.waitFor(() => expect(cells().length).toBeGreaterThan(20));
    expect(document.querySelectorAll('[aria-label="Day"][role="group"]')).toHaveLength(1);
    expect(document.querySelector('[aria-label^="Day: Today"]')).not.toBeNull();
    expect(document.body.textContent).toContain("Filter");
  });
});
