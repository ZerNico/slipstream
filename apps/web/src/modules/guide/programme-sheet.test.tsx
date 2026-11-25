// @vitest-environment happy-dom
import { DateTime, Effect } from "effect";
import { optionLabels, pickOption, selectedText, selectTrigger } from "~/test/select.ts";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ChannelId,
  epochMs,
  type ExtraTimeDefaults,
  ProgrammeId,
  recordingsOfAiring,
  type RecordOptions,
  type RepeatAiring,
} from "@slipstream/domain";
import type { Api } from "~/api/client.ts";
import { setLocale, setRegion } from "@slipstream/i18n";
import { mockBufferMillis } from "~/api/mock/playback.ts";
import type { MockOptions, MockServer } from "~/api/mock/server.ts";
import { toastManager } from "~/ui/toast-manager.ts";
import ProgrammeSheet from "./programme-sheet/index.tsx";
import { type GuideHarness, mountGuide, setMedia } from "./test-harness.tsx";

let harness: GuideHarness | undefined;
beforeEach(() => {
  setLocale("en");
  setRegion("GB");
  setMedia(["(min-width: 768px)"]);
});
afterEach(async () => {
  await harness?.unmount();
  harness = undefined;
  setMedia([]);
  setRegion(undefined);
});

/** How a sheet is opened: the mock's options and data, which airing, a wrapped client. */
interface OpenOptions {
  readonly mock?: MockOptions;
  readonly when?: "future" | "live" | "past" | "any";
  readonly wrap?: (api: Api) => Api;
  readonly prepare?: (server: MockServer) => void;
  /** Only airings on this channel. */
  readonly channel?: string;
}

/** Opens the sheet for the first programme with this title, against a fresh mock. */
const openSheet = async (title: string, options: OpenOptions = {}) => {
  const { mock = {}, when = "any", wrap, prepare, channel } = options;
  let id = "";
  const sheet = () => (
    <ProgrammeSheet
      open
      overlay={{ kind: "sheet", name: "prog", arg: id }}
      onOpenChange={() => {}}
    />
  );
  // The mock's programme ids depend on its clock, so look the id up first.
  const probe = await mountGuide(<span />);
  const at = Date.now();
  const found = probe.server.data.programmes.find(
    (programme) =>
      (title === "" || programme.title === title) &&
      (channel === undefined || programme.channelId === channel) &&
      (when === "any" ||
        (when === "future"
          ? epochMs(programme.start) > at
          : when === "past"
            ? epochMs(programme.end) <= at &&
              // Still inside the mock's pause & rewind buffer, so a range session plays.
              epochMs(programme.start) >= at - mockBufferMillis &&
              recordingsOfAiring(programme, probe.server.data.recordings).length === 0
            : epochMs(programme.start) <= at && epochMs(programme.end) > at)),
  );
  await probe.unmount();
  if (!found) throw new Error(`no programme ${title}`);
  id = found.id;
  harness = await mountGuide(sheet(), {
    mock,
    ...(wrap ? { wrap } : {}),
    ...(prepare ? { prepare } : {}),
  });
  return harness;
};

/** Text with no-break spaces as plain spaces. */
const norm = (value: string | null | undefined) => (value ?? "").replace(/\s/gu, " ");
const text = () => norm(document.body.textContent);
const button = (name: string) =>
  [...document.querySelectorAll("button")].find(
    (candidate) => candidate.textContent?.trim() === name,
  );
const selectNamed = (label: string) => selectTrigger(document, label);
/** The minutes a select shows ("2 min" reads "2"). */
const minutes = (label: string) => /\d+/u.exec(selectedText(selectNamed(label)) ?? "")?.[0];
const summary = () => norm(document.querySelector("[data-extra-summary]")?.textContent);
const openOptions = async (h: { click: (target: Element | null | undefined) => Promise<void> }) =>
  h.click(
    [...document.querySelectorAll("button")].find((b) => b.textContent?.startsWith("Options")),
  );
const choose = async (h: { settle: () => Promise<void> }, label: string, option: string) => {
  await pickOption(selectNamed(label), option);
  await h.settle();
};
/** A decoded record-options answer, as opposed to the client's raw response modes. */
const isRecordOptions = (answer: unknown): answer is RecordOptions =>
  typeof answer === "object" && answer !== null && !Array.isArray(answer) && "extraTime" in answer;
const withRepeat = (answer: RecordOptions, repeatAiring: RepeatAiring): RecordOptions => ({
  ...answer,
  repeatAiring,
});
const badgeRow = () => document.querySelector("[data-sheet-badges]");
const repeatInstead = () =>
  [...document.querySelectorAll("button")].find((candidate) =>
    /^Record the repeat instead \(.+, \d\d:\d\d\)$/u.test(candidate.textContent ?? ""),
  );
const recordingsOf = (server: MockServer, title: string) =>
  server.data.recordings.filter((entry) => entry.title === title);

describe("programme sheet: record a programme", () => {
  it("starts the extra time from the default, folded under Options", async () => {
    const h = await openSheet("Tagesthemen");
    await h.waitFor(() => expect(summary()).toBe("2 min early · 10 min late"));
    expect(selectNamed("Start early")).toBeNull();
    await openOptions(h);
    expect(minutes("Start early")).toBe("2");
    expect(minutes("End late")).toBe("10");
    expect(text()).not.toContain("default");
  });

  it("records once with the extra time the reader stepped to", async () => {
    const h = await openSheet("Tagesthemen");
    const { waitFor, click, server } = h;
    await waitFor(() => expect(button("Record")).toBeDefined());
    await openOptions(h);
    await choose(h, "End late", "15 min");
    expect(summary()).toBe("2 min early · 15 min late");
    expect(button("Reset")).toBeDefined();
    await click(button("Record"));
    await waitFor(() => expect(recordingsOf(server, "Tagesthemen")).toHaveLength(1));
    expect(recordingsOf(server, "Tagesthemen")[0]?.padding).toEqual({
      beforeMinutes: 2,
      afterMinutes: 15,
    });
    await waitFor(() => expect(text()).toContain("Will be recorded"));
    expect(button("Skip this one")).toBeDefined();
  });

  it("keeps the badge row laid out before Record, so the Scheduled badge moves nothing", async () => {
    const { waitFor, click } = await openSheet("Tagesthemen", { when: "future" });
    await waitFor(() => expect(button("Record")).toBeDefined());
    expect(badgeRow()).not.toBeNull();
    expect(badgeRow()?.children).toHaveLength(0);
    expect(badgeRow()?.className).toContain("min-h-[22px]");
    await click(button("Record"));
    await waitFor(() => expect(norm(badgeRow()?.textContent)).toBe("Scheduled"));
  });

  it("says when in the header as the facts line does", async () => {
    const { waitFor } = await openSheet("Tagesthemen", { when: "future" });
    await waitFor(() => expect(button("Record")).toBeDefined());
    const header = norm(document.querySelector(".sheet-context")?.textContent);
    const facts = norm(document.querySelector("[data-sheet-facts]")?.lastElementChild?.textContent);
    // "Das Erste · Today 23 · 22:15" is where "Das Erste · Today 23 · 22:15–22:45 · …" starts.
    expect(header).toMatch(/^.+ · .+ · \d\d:\d\d$/u);
    expect(facts.startsWith(header)).toBe(true);
  });

  it("names the channel default when the channel and the category both have one", async () => {
    const defaults: ExtraTimeDefaults = {
      padding: { beforeMinutes: 2, afterMinutes: 10 },
      overrides: [
        { _tag: "Category", category: "Sport", padding: { beforeMinutes: 3, afterMinutes: 30 } },
        {
          _tag: "Channel",
          channelId: ChannelId.make("sky-sport-f1"),
          padding: { beforeMinutes: 5, afterMinutes: 60 },
        },
      ],
    };
    // The server's record options and Settings › Recording come from the same defaults.
    const { waitFor } = await openSheet("Live F1: Analyse - GP Las Vegas", {
      mock: { extraTime: defaults },
    });
    await waitFor(() => expect(summary()).toBe("5 min early · 60 min late"));
  });
});

/** The record choice's segments ("This episode", "All episodes"). */
const segments = () =>
  [...document.querySelectorAll('[aria-label="Record options"] button')].map((b) =>
    b.textContent?.trim(),
  );
const segment = (name: string) =>
  [...document.querySelectorAll('[aria-label="Record options"] button')].find(
    (b) => b.textContent?.trim() === name,
  );
const footerButtons = () =>
  [...document.querySelectorAll(".sheet-footer button")].map((candidate) =>
    candidate.textContent?.trim(),
  );

/** The toasts shown since the spy was set, by title. */
const shown = (spy: ReturnType<typeof spyToasts>, title: string) =>
  spy.mock.calls.map(([options]) => options).find((options) => options.title === title);
const spyToasts = () => vi.spyOn(toastManager, "add");
/** Presses a toast's Undo. */
const undo = async (h: GuideHarness, options: ReturnType<typeof shown>) => {
  const press = (options?.actionProps as { onClick?: () => void } | undefined)?.onClick;
  if (press === undefined) throw new Error("the toast has no Undo");
  await act(async () => {
    press();
  });
  await h.settle();
};

/** The household's last series recording of a darts semi-final went well: its replay is a repeat. */
const semiRecorded = (server: MockServer) => {
  server.data.recordings = server.data.recordings.map((entry) =>
    entry.id === "darts-halbfinale-failed" ? { ...entry, state: "completed", problems: [] } : entry,
  );
};

describe("programme sheet: the second record row", () => {
  it("offers All episodes for Tatort, a Fernsehfilm with a sub-title", async () => {
    const h = await openSheet("Tatort", {
      channel: "das-erste",
      when: "future",
      prepare: (server) => {
        server.data.recordings = server.data.recordings.filter(
          (entry) => entry.id !== "tatort-schattenmann",
        );
        server.data.programmes = server.data.programmes.map((programme) =>
          programme.subtitle === "Schattenmann"
            ? { ...programme, categories: ["Fernsehfilm"] }
            : programme,
        );
      },
    });
    await h.waitFor(() => expect(segments()).toEqual(["This episode", "All episodes"]));
  });

  it("offers Every “Live F1” for a live broadcast", async () => {
    const h = await openSheet("Live F1: Analyse - GP Las Vegas");
    await h.waitFor(() => expect(segments()).toEqual(["Just this one", "Every “Live F1”"]));
  });

  it("has no second row for a film: it airs again, it does not continue", async () => {
    const h = await openSheet("Der Pate II", { when: "future" });
    await h.waitFor(() => expect(button("Record")).toBeDefined());
    expect(segments()).toEqual([]);
  });
});

describe("programme sheet: Goes to", () => {
  it("lists the collections the profile can see, and never New collection…", async () => {
    const h = await openSheet("Tagesthemen");
    await h.waitFor(() => expect(button("Record")).toBeDefined());
    await openOptions(h);
    const options = await optionLabels(selectNamed("Goes to"));
    expect(options).toContain("Formel 1");
    expect(text()).not.toContain("New collection");
  });

  it("offers only Automatic when the profile can see no collection", async () => {
    const h = await openSheet("Tagesthemen", {
      prepare: (server) => {
        server.data.collections = [];
      },
    });
    await h.waitFor(() => expect(button("Record")).toBeDefined());
    await openOptions(h);
    expect(await optionLabels(selectNamed("Goes to"))).toEqual(["Automatic (Tagesthemen)"]);
  });
});

describe("programme sheet: Record series", () => {
  afterEach(() => vi.restoreAllMocks());

  it("saves a series recording, swaps to its scheduled state and Undo takes it back", async () => {
    const toasts = spyToasts();
    const h = await openSheet("Live F1: Analyse - GP Las Vegas");
    await h.waitFor(() => expect(segment("Every “Live F1”")).toBeDefined());
    await h.click(segment("Every “Live F1”"));
    const rules = h.server.data.rules.length;
    await h.click(button("Record"));
    await h.waitFor(() => expect(h.server.data.rules).toHaveLength(rules + 1));
    const created = h.server.data.rules.at(-1);
    expect(created?.matcher.title).toEqual([{ _tag: "StartsWith", values: ["Live F1:"] }]);
    expect(created?.skipRepeats).toBe(true);
    await h.waitFor(() =>
      expect(text()).toContain(`Scheduled · by your series recording ${created?.name ?? ""}`),
    );
    // One count: the series preview's, which the series recording editor shows too.
    await h.waitFor(() => expect(norm(line()?.textContent)).toMatch(/^\d+ will record/u));
    const willRecord = /^(\d+) will record/u.exec(norm(line()?.textContent))?.[0];
    expect(footerButtons()).toEqual(["Skip this one", "Series options"]);
    const added = shown(toasts, `Series recording added: every “Live F1” · ${willRecord ?? ""}`);
    expect(added).toBeDefined();
    await undo(h, added);
    await h.waitFor(() => expect(h.server.data.rules).toHaveLength(rules));
    expect(h.server.data.recordings.some((entry) => entry.ruleId === created?.id)).toBe(false);
  });
});

const line = () => document.querySelector("[data-series-line]");

describe("programme sheet: the collection offer", () => {
  afterEach(() => vi.restoreAllMocks());

  it("takes the upcoming line's place in the same line box", async () => {
    const h = await openSheet("Live F1 Academy: Training - GP Katar");
    await h.waitFor(() => expect(text()).toContain("In 3 places"));
    // Both lines share one grid cell: the box is as tall as the taller one whichever shows.
    const [count, offer] = [...(line()?.children ?? [])];
    expect(line()?.children).toHaveLength(2);
    expect(line()?.className).toContain("*:[grid-area:line]");
    expect(count?.className).toContain("invisible");
    expect(count?.getAttribute("aria-hidden")).toBe("true");
    expect(offer?.className).not.toContain("invisible");
    expect(norm(offer?.textContent)).toBe("In 3 places · Group them…");
  });

  it("shows the upcoming line when there is nothing to group", async () => {
    const h = await openSheet("Tatort", { channel: "das-erste", when: "future" });
    await h.waitFor(() => expect(text()).toContain("by your series recording Tatort"));
    const [count, offer] = [...(line()?.children ?? [])];
    expect(count?.className).not.toContain("invisible");
    expect(norm(count?.textContent)).toMatch(/^\d+ will record/u);
    expect(offer?.className).toContain("invisible");
  });

  it("groups them under the offered name, says so, and Undo ungroups", async () => {
    const toasts = spyToasts();
    const h = await openSheet("Live F1 Academy: Training - GP Katar");
    await h.waitFor(() => expect(button("Group them…")).toBeDefined());
    await h.click(button("Group them…"));
    const input = document.querySelector<HTMLInputElement>("[data-offer-step] input");
    expect(input?.value).toBe("Live F1 Academy");
    expect(document.activeElement).toBe(input);
    expect(input?.selectionStart).toBe(0);
    expect(input?.selectionEnd).toBe("Live F1 Academy".length);
    expect(document.querySelector("[data-offer-preview]")?.textContent).toMatch(
      /^Live F1 Academy › /u,
    );
    const before = h.server.data.collections.length;
    await act(async () => {
      input?.form?.requestSubmit();
    });
    await h.waitFor(() => expect(h.server.data.collections).toHaveLength(before + 1));
    expect(h.server.data.collections.at(-1)?.follows?.ruleId).toBe("live-f1-academy");
    await h.waitFor(() => expect(document.querySelector("[data-offer-step]")).toBeNull());
    const grouped = shown(toasts, "Grouped as “Live F1 Academy”");
    expect(grouped?.data).toEqual({ quiet: true });
    await undo(h, grouped);
    await h.waitFor(() => expect(h.server.data.collections).toHaveLength(before));
  });

  it("No thanks never offers it again for this series recording", async () => {
    const h = await openSheet("Live F1 Academy: Training - GP Katar");
    await h.waitFor(() => expect(button("Group them…")).toBeDefined());
    await h.click(button("Group them…"));
    await h.click(button("No thanks"));
    await h.waitFor(() =>
      expect(h.server.data.rules.find((rule) => rule.id === "live-f1-academy")?.offerDeclined).toBe(
        true,
      ),
    );
    await h.waitFor(() => expect(line()?.children[1]?.className).toContain("invisible"));
  });
});

describe("programme sheet: an episode the viewer already has", () => {
  afterEach(() => vi.restoreAllMocks());

  it("Owned: says where the copy is above both record rows; Record stays the primary", async () => {
    const h = await openSheet("Tatort", { channel: "zdf" });
    await h.waitFor(() => expect(document.querySelector("[data-had-status]")).not.toBeNull());
    const status = norm(document.querySelector("[data-had-status]")?.textContent);
    expect(status).toMatch(/^Already recorded .+, \d\d:\d\d on Das Erste·Play it$/u);
    expect(text()).toContain("Already recorded");
    expect(segments()).toEqual(["This episode", "All episodes"]);
    expect(footerButtons()).toEqual(["Record"]);
    expect(document.querySelector(".sheet-footer .btn-primary")).not.toBeNull();
  });

  it("Repeat: the status box replaces the rows; Record anyway with no primary", async () => {
    const toasts = spyToasts();
    const h = await openSheet("Darts: Grand Slam - Halbfinale (Wh.)", { prepare: semiRecorded });
    await h.waitFor(() => expect(button("Record anyway")).toBeDefined());
    expect(segments()).toEqual([]);
    const status = norm(document.querySelector("[data-had-status]")?.textContent);
    // Same channel as this airing: it is not named.
    expect(status).toMatch(/^Already recorded .+, \d\d:\d\dPlay it$/u);
    expect(footerButtons()).toEqual(["Record anyway", "Series options"]);
    expect(document.querySelector(".sheet-footer .btn-primary")).toBeNull();
    const title = "Darts: Grand Slam - Halbfinale (Wh.)";
    await h.click(button("Record anyway"));
    await h.waitFor(() => expect(recordingsOf(h.server, title)).toHaveLength(1));
    expect(recordingsOf(h.server, title)[0]?.ruleId).toBeUndefined();
    expect(shown(toasts, `Recording ${title} anyway`)).toBeDefined();
  });
});

describe("programme sheet: states", () => {
  it("offers Watch and Stop recording for a programme recording now", async () => {
    const { waitFor } = await openSheet("Live F1: Rennen - GP Las Vegas");
    await waitFor(() => expect(text()).toContain("Recording now"));
    // One badge, the state that matters most.
    expect(text()).not.toContain("Live now");
    expect(button("Watch")).toBeDefined();
    expect(button("Stop recording")).toBeDefined();
    expect(text()).toContain("Started");
    // The race overlaps the darts final: every way out is offered.
    expect(button("Skip Darts: Grand Slam - Finale")).toBeDefined();
  });

  it("records the repeat the server picked instead, and this airing gives way", async () => {
    let repeat: RepeatAiring | undefined;
    const title = "Darts: Grand Slam - Finale";
    const h = await openSheet(title, {
      prepare: (server) => {
        const finale = server.data.programmes.find((programme) => programme.title === title);
        if (finale === undefined) return;
        const start = epochMs(finale.end) + 2 * 3_600_000;
        const later = {
          ...finale,
          id: ProgrammeId.make(`${finale.channelId}:repeat`),
          title: `${title} (Wh.)`,
          live: false,
          start: DateTime.makeUnsafe(start),
          end: DateTime.makeUnsafe(start + 150 * 60_000),
        };
        server.data.programmes = [...server.data.programmes, later];
        repeat = {
          programmeId: later.id,
          channelId: later.channelId,
          start: later.start,
          end: later.end,
        };
      },
      // The server names the airing for "Record the repeat instead" (`repeatAiring`).
      wrap: (api) => ({
        ...api,
        call: (f) =>
          api.call((client) => {
            const recordOptions = ((request) =>
              client.programmes
                .recordOptions(request)
                .pipe(
                  Effect.map((answer) =>
                    repeat === undefined || !isRecordOptions(answer)
                      ? answer
                      : withRepeat(answer, repeat),
                  ),
                )) as typeof client.programmes.recordOptions;
            return f({ ...client, programmes: { ...client.programmes, recordOptions } });
          }),
      }),
    });
    await h.waitFor(() => expect(text()).toContain("Scheduled, but in conflict"));
    await h.waitFor(() => expect(repeatInstead()).toBeDefined());
    await h.click(repeatInstead());
    await h.waitFor(() =>
      expect(
        h.server.data.recordings.some((entry) => entry.programmeId === repeat?.programmeId),
      ).toBe(true),
    );
    expect(
      recordingsOf(h.server, title).filter((entry) => entry.state === "scheduled"),
    ).toHaveLength(0);
  });

  it("offers no repeat when the server names none", async () => {
    const { waitFor } = await openSheet("Darts: Grand Slam - Finale");
    await waitFor(() => expect(text()).toContain("Scheduled, but in conflict"));
    expect(text()).not.toContain("Record the repeat instead");
  });

  it("offers Watch live and Record for a live programme nobody records", async () => {
    const { waitFor } = await openSheet("NBA: Lakers - Celtics", { when: "live" });
    await waitFor(() => expect(button("Record")).toBeDefined());
    expect(button("Watch live")).toBeDefined();
  });

  it("skips a scheduled programme", async () => {
    const { waitFor, click, server } = await openSheet("Tatort");
    await waitFor(() => expect(button("Skip this one")).toBeDefined());
    expect(text()).toContain("Scheduled · by your series recording Tatort");
    await click(button("Skip this one"));
    // Last week's finished episode stays; only the scheduled one goes.
    await waitFor(() =>
      expect(
        recordingsOf(server, "Tatort").filter((entry) => entry.state === "scheduled"),
      ).toHaveLength(0),
    );
  });
});

describe("programme sheet: catch-up", () => {
  it("starts an ended programme nobody recorded over from pause & rewind", async () => {
    const h = await openSheet("", { when: "past" });
    await h.waitFor(() => expect(button("Watch from start")).toBeDefined());
    expect(text()).toContain("This programme has ended and wasn't recorded.");
    await h.click(button("Watch from start"));
    await h.waitFor(() => expect(h.url()).toMatch(/^\/watch\/range\/[^?]+\?start=\d+&end=\d+$/u));
  });
});
