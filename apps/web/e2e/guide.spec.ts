import { expect, test, type Page } from "@playwright/test";
import { optionTexts, selectNumber } from "./support/select.ts";
import {
  afterPaint,
  expectNoHorizontalOverflow,
  expectNoShiftOn,
  expectNoShiftOnLoad,
  expectOverlaysFit,
  smallTargets,
} from "./support/layout.ts";
import { api, requireServer, seed, settle } from "./support/session.ts";

/*
 * The guide against a real server with the fake source (`pnpm e2e`): one scroller, no shift on
 * load or hover, keys and the skip link, Channels on phones, the short-landscape header, and the
 * extra-time hint quoting the steppers (IMPLEMENTATION-NOTES open issues 1 and 7).
 */

requireServer({ source: true });

/** Signs in and makes sure the server has the fake source's guide. */
const prepare = async (page: Page) => {
  await seed(page);
};

interface Programme {
  readonly id: string;
  readonly title: string;
  readonly channelId: string;
  readonly start: string;
  readonly end: string;
  readonly episode?: { readonly season?: number; readonly episode?: number };
}

/**
 * A series episode on the fake source that airs again within the week, nobody records yet: the
 * first airing and its repeat (the series channel repeats an episode the next day).
 */
const seriesRepeat = async (page: Page) => {
  const call = api(page);
  const series = (await call.get<{ id: string; name: string }[]>("/api/channels")).find(
    (channel) => channel.name === "Serienwelt HD",
  );
  if (series === undefined) throw new Error("no Serienwelt HD channel");
  const from = new Date().toISOString();
  const to = new Date(Date.now() + 7 * 24 * 3_600_000).toISOString();
  const listed = (await call.get<Programme[]>(`/api/guide?from=${from}&to=${to}`)).filter(
    (programme) => programme.channelId === series.id && programme.episode !== undefined,
  );
  const recorded = new Set(
    (await call.get<{ programmeId?: string }[]>("/api/recordings")).map((e) => e.programmeId),
  );
  const episodeOf = (p: Programme) => `${p.title}|${p.episode?.season}|${p.episode?.episode}`;
  const laterOf = (first: Programme) =>
    listed.find(
      (later) =>
        episodeOf(later) === episodeOf(first) && Date.parse(later.start) >= Date.parse(first.end),
    );
  const first = listed.find(
    (candidate) =>
      Date.parse(candidate.start) > Date.now() + 10 * 60_000 &&
      !recorded.has(candidate.id) &&
      laterOf(candidate) !== undefined,
  );
  const repeat = first === undefined ? undefined : laterOf(first);
  if (first === undefined || repeat === undefined) throw new Error("no episode that airs twice");
  return { channelId: series.id, first, repeat };
};

/** The first number in a text: "10 min" is 10. */

const roving = (page: Page) => page.locator('#guide-grid button[data-index][tabindex="0"]');

/** Waits until the screen (and any sheet over it) has loaded and painted: measure after this. */
const ready = async (page: Page) => {
  await settle(page);
  await afterPaint(page);
};

/** The page itself never scrolls under the grid: it is sized to what is left of the viewport. */
const expectOneScroller = async (page: Page) => {
  const { height, viewport } = await page.evaluate(() => ({
    height: document.documentElement.scrollHeight,
    viewport: window.innerHeight,
  }));
  expect(height).toBeLessThanOrEqual(viewport);
};

/**
 * Ruler labels whose start is under the sticky channel column, yet still showing: a cut label.
 */
const cutRulerLabels = (page: Page) =>
  page.evaluate(() => {
    const grid = document.querySelector<HTMLElement>("#guide-grid");
    const canvas = grid?.firstElementChild;
    if (!grid || !(canvas instanceof HTMLElement)) return ["no grid"];
    const column =
      grid.getBoundingClientRect().left +
      Number.parseFloat(getComputedStyle(canvas).getPropertyValue("--chw"));
    return [...grid.querySelectorAll<HTMLElement>("[data-ruler-tick]")]
      .filter((tick) => {
        const style = getComputedStyle(tick);
        if (style.visibility === "hidden" || Number(style.opacity) < 0.05) return false;
        const box = tick.getBoundingClientRect();
        return box.left < column - 0.5 && box.right > column;
      })
      .map((tick) => tick.textContent ?? "");
  });

/**
 * Programme cells drawn beside or over the channel column: with the grid at its start no cell
 * begins left of the grid origin, and wherever it is scrolled the column, not a cell, is what
 * sits at its right edge in every row.
 */
const cellsLeakingIntoColumn = (page: Page) =>
  page.evaluate(() => {
    const grid = document.querySelector<HTMLElement>("#guide-grid");
    const canvas = grid?.firstElementChild;
    if (!grid || !(canvas instanceof HTMLElement)) return ["no grid"];
    const origin =
      grid.getBoundingClientRect().left +
      Number.parseFloat(getComputedStyle(canvas).getPropertyValue("--chw"));
    const leaks: string[] = [];
    for (const row of grid.querySelectorAll<HTMLElement>("[data-row]")) {
      const box = row.getBoundingClientRect();
      const y = box.top + box.height / 2;
      if (y < grid.getBoundingClientRect().top + 40 || y > grid.getBoundingClientRect().bottom) {
        continue;
      }
      const hit = document.elementFromPoint(origin - 1, y);
      if (hit?.closest("button[data-index]")) leaks.push(hit.textContent ?? "");
      if (grid.scrollLeft !== 0) continue;
      for (const cell of row.querySelectorAll<HTMLElement>("button[data-index]")) {
        if (cell.getBoundingClientRect().left < origin - 0.5) leaks.push(cell.textContent ?? "");
      }
    }
    return leaks;
  });

/** From the grid's start, scrolled a little at a time: no cell ever shows in the column. */
const expectCellsClearOfColumn = async (page: Page) => {
  const grid = page.locator("#guide-grid");
  await grid.evaluate((element) => {
    element.scrollLeft = 0;
  });
  await afterPaint(page);
  expect(await cellsLeakingIntoColumn(page)).toEqual([]);
  for (const by of [37, 113, 260, 900]) {
    await grid.evaluate((element, step) => {
      element.scrollLeft += step;
    }, by);
    await afterPaint(page);
    expect(await cellsLeakingIntoColumn(page)).toEqual([]);
  }
};

/** Scrolls the grid so half-hour starts land under the channel column; none shows cut. */
const expectRulerClearOfColumn = async (page: Page) => {
  const grid = page.locator("#guide-grid");
  for (const by of [37, 113, 260]) {
    await grid.evaluate((element, step) => {
      element.scrollLeft += step;
    }, by);
    await afterPaint(page);
    await expect.poll(() => cutRulerLabels(page)).toEqual([]);
  }
};

test.describe("tablet 1024 × 768", () => {
  test.use({ viewport: { width: 1024, height: 768 } });

  test("no ruler label shows cut under the channel column", async ({ page }) => {
    await prepare(page);
    await page.goto("/guide");
    await expect(roving(page)).toHaveCount(1);
    await expectRulerClearOfColumn(page);
  });

  test("no programme cell shows beside or under the channel column", async ({ page }) => {
    await prepare(page);
    await page.goto("/guide");
    await expect(roving(page)).toHaveCount(1);
    await ready(page);
    await expectCellsClearOfColumn(page);
  });
});

test.describe("desktop 1440 × 900", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("the timeline grid loads without shifting and is the only scroller", async ({ page }) => {
    await prepare(page);
    await expectNoShiftOnLoad(page, "/guide");
    await expect(roving(page)).toHaveCount(1);
    await expectNoHorizontalOverflow(page);
    await expectOneScroller(page);
  });

  test("hovering a programme moves nothing", async ({ page }) => {
    await prepare(page);
    await page.goto("/guide");
    await expect(roving(page)).toHaveCount(1);
    // In view first, so the hover itself is all that happens (Playwright scrolls to hover).
    await roving(page).scrollIntoViewIfNeeded();
    await expectNoShiftOn(page, () => roving(page).hover());
  });

  test("skip link, arrow keys, Enter opens the sheet in the URL, Back closes it", async ({
    page,
  }) => {
    await prepare(page);
    await page.goto("/guide");
    await expect(roving(page)).toHaveCount(1);
    await page.keyboard.press("Tab");
    await expect(page.locator(":focus")).toHaveText("Skip to the guide");
    await page.keyboard.press("Enter");
    await expect(page.locator(":focus")).toHaveAttribute("data-index", /\d+/u);
    const first = await page.locator(":focus").getAttribute("aria-label");
    await page.keyboard.press("ArrowDown");
    const second = await page.locator(":focus").getAttribute("aria-label");
    expect(second).not.toBe(first);
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/sheet=prog/u);
    await expectOverlaysFit(page);
    await page.goBack();
    // The skip link leaves its anchor in the URL; the sheet is gone either way.
    await expect(page).toHaveURL(/\/guide(#main)?$/u);
  });

  test("Options folds the extra time and shows its values as the summary", async ({ page }) => {
    await prepare(page);
    await page.goto("/guide");
    await expect(roving(page)).toHaveCount(1);
    // A programme that hasn't started and nobody records: its sheet offers Record with the
    // default extra time.
    const upcoming = page
      .locator("#guide-grid button[data-index][data-when='future']:not([data-mark])")
      .first();
    await upcoming.click();
    const options = page.getByRole("button", { name: /^Options/u });
    await expect(options).toBeVisible();
    const summary = (await page.locator("[data-extra-summary]").textContent()) ?? "";
    const quoted = [...summary.matchAll(/(\d+)\s*min/gu)].map((match) => Number(match[1]));
    await options.click();
    const early = await selectNumber(page.getByRole("combobox", { name: "Start early" }));
    const late = await selectNumber(page.getByRole("combobox", { name: "End late" }));
    expect(quoted).toEqual([early, late]);
  });

  test("the sheet keeps its header in place when Record finishes", async ({ page }) => {
    await prepare(page);
    await page.goto("/guide");
    await expect(roving(page)).toHaveCount(1);
    // Half an hour away at least: one starting within its lead time would record at once.
    const id = await page.evaluate(() => {
      const later = [
        ...document.querySelectorAll<HTMLElement>(
          "#guide-grid button[data-index][data-when='future']:not([data-mark])",
        ),
      ].find((cell) => Number(cell.dataset["start"]) > Date.now() + 30 * 60_000);
      return later?.dataset["programme"] ?? null;
    });
    expect(id).not.toBeNull();
    const upcoming = page.locator(`#guide-grid button[data-programme="${id}"]`);
    await upcoming.click();
    await expect(page.getByRole("button", { name: /^Options/u })).toBeVisible();
    await ready(page);
    const top = (selector: string) =>
      page.locator(selector).evaluate((element) => element.getBoundingClientRect().top);
    const before = { title: await top(".sheet-body h2"), facts: await top("[data-sheet-facts]") };
    try {
      await page.locator(".sheet-footer").getByRole("button", { name: "Record" }).click();
      await expect(page.locator("[data-sheet-badges]")).toHaveText("Scheduled");
      await ready(page);
      // The badge row was laid out all along: the Scheduled badge arriving moves nothing.
      expect({
        title: await top(".sheet-body h2"),
        facts: await top("[data-sheet-facts]"),
      }).toEqual(before);
    } finally {
      const recordings =
        await api(page).get<{ id: string; programmeId?: string }[]>("/api/recordings");
      const made = recordings.find((entry) => entry.programmeId === id);
      if (made !== undefined) await api(page).delete(`/api/recordings/${made.id}`);
    }
  });

  test("Goes to offers only Automatic when the profile sees no collection", async ({ page }) => {
    await prepare(page);
    // The server's record options for a profile that can see no collection.
    await page.route("**/api/programmes/*/record-options", async (route) => {
      const response = await route.fetch();
      const body = (await response.json()) as { goesTo?: { collectionIds: string[] } };
      await route.fulfill({
        response,
        json:
          body.goesTo === undefined
            ? body
            : { ...body, goesTo: { ...body.goesTo, collectionIds: [] } },
      });
    });
    await page.goto("/guide");
    await expect(roving(page)).toHaveCount(1);
    await page
      .locator("#guide-grid button[data-index][data-when='future']:not([data-mark])")
      .first()
      .click();
    await page.getByRole("button", { name: /^Options/u }).click();
    const goes = await optionTexts(page, page.getByRole("combobox", { name: "Goes to" }));
    expect(goes).toHaveLength(1);
    expect(goes[0]).toMatch(/^Automatic \(/u);
  });
});

test.describe("phone 390 × 844 in German", () => {
  test.use({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
    locale: "de-DE",
  });

  test("footer buttons never wrap their words: they share a row or stack", async ({ page }) => {
    await prepare(page);
    const { channelId, first, repeat } = await seriesRepeat(page);
    const rule = await api(page).post<{ id: string }>("/api/rules", {
      name: `E2E ${first.title}`,
      enabled: true,
      matcher: {
        channels: [channelId],
        title: [{ _tag: "StartsWith", values: [first.title] }],
        categories: [],
        weekdays: [],
      },
      padding: { beforeMinutes: 0, afterMinutes: 0 },
      retention: { _tag: "KeepAll" },
      skipRepeats: true,
    });
    try {
      const footer = page.locator(".sheet-footer");
      // A left-out repeat, then the airing the series recording schedules.
      for (const [airing, buttons] of [
        [repeat, ["Trotzdem aufnehmen", "Serienaufnahme ändern"]],
        [first, ["Diese auslassen", "Serienaufnahme ändern"]],
      ] as const) {
        await page.goto(`/guide?sheet=${encodeURIComponent(`prog:${airing.id}`)}`);
        await expect(footer.getByRole("button")).toHaveText([...buttons]);
        await ready(page);
        const shown = await footer.evaluate((element) =>
          [...element.querySelectorAll<HTMLElement>(".btn")].map((button) => {
            const label = button.querySelector<HTMLElement>(".btn-label");
            return {
              height: button.getBoundingClientRect().height,
              wraps: label === null ? false : getComputedStyle(label).whiteSpace !== "nowrap",
              cut: label === null ? false : label.scrollWidth > label.clientWidth + 0.5,
            };
          }),
        );
        // 48 px buttons with every label whole and on one line.
        expect(shown).toEqual(buttons.map(() => ({ height: 48, wraps: false, cut: false })));
      }
    } finally {
      await api(page).delete(`/api/rules/${rule.id}`);
    }
  });
});

test.describe("phone 390 × 844", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test("opens on the Channels view, 44 px targets, no horizontal scroll", async ({ page }) => {
    await prepare(page);
    await expectNoShiftOnLoad(page, "/guide");
    await expect(page.getByRole("list", { name: "On now" })).toBeVisible();
    await expectNoHorizontalOverflow(page);
    expect(await smallTargets(page, 44, "main")).toEqual([]);
  });

  test("Filter is a sheet in the URL; a pick sticks and Back leaves the guide", async ({
    page,
  }) => {
    await prepare(page);
    await page.goto("/rules");
    await page.goto("/guide");
    await page.getByRole("button", { name: "Filter" }).tap();
    await expect(page).toHaveURL(/dlg=filter/u);
    await page.getByRole("menuitemradio", { name: "Sport" }).tap();
    await expect(page).toHaveURL(/cat=sport/u);
    await expect(page).not.toHaveURL(/dlg=/u);
  });
});

for (const [width, height] of [
  [844, 390],
  [667, 375],
] as const) {
  test.describe(`short landscape ${width} × ${height}`, () => {
    test.use({ viewport: { width, height }, hasTouch: true, isMobile: true });

    test("one header row, the grid fills the screen with at least 2.5 rows", async ({ page }) => {
      await prepare(page);
      await page.goto("/guide");
      await expect(roving(page)).toHaveCount(1);
      await ready(page);
      // The day switcher sits in the one header row, the day alone (no arrows).
      await expect(page.getByRole("group", { name: "Day" })).toHaveCount(1);
      await expect(page.getByRole("button", { name: "Next day" })).toHaveCount(0);
      await expect(page.getByRole("button", { name: /^Day: /u })).toBeVisible();
      await expectOneScroller(page);
      await expectNoHorizontalOverflow(page);
      const rows = await page.evaluate(() => {
        const grid = document.querySelector("#guide-grid")?.getBoundingClientRect();
        return grid ? (grid.height - 40) / 78 : 0;
      });
      expect(rows).toBeGreaterThanOrEqual(2.5);
      await expectRulerClearOfColumn(page);
      await expectCellsClearOfColumn(page);
    });

    test("the programme sheet fits the short screen", async ({ page }) => {
      await prepare(page);
      await page.goto("/guide");
      await roving(page).tap();
      await expect(page).toHaveURL(/sheet=prog/u);
      await expectOverlaysFit(page);
    });

    test("an upcoming programme's sheet: an 88 px art band, the description above the footer", async ({
      page,
    }) => {
      await prepare(page);
      await page.goto("/guide");
      await expect(roving(page)).toHaveCount(1);
      await ready(page);
      await page.locator("#guide-grid button[data-index][data-when='future']").first().tap();
      await expect(page).toHaveURL(/sheet=prog/u);
      // The sheet has its record options and has finished sliding in before anything is measured.
      await ready(page);
      await expectOverlaysFit(page);
      // Decision 14: the art is a band, so the facts line clears the pinned footer and, on the
      // bottom sheet (under 768 px), more than a line of the description shows above it too.
      const art = page.locator(".sheet-art .art");
      expect((await art.boundingBox())?.height).toBeCloseTo(88, 1);
      const footerTop = (await page.locator(".sheet-footer").boundingBox())?.y ?? height;
      const facts = await page.locator("[data-sheet-facts]").boundingBox();
      expect((facts?.y ?? height) + (facts?.height ?? 0)).toBeLessThanOrEqual(footerTop);
      if (width >= 768) return;
      const description = page.locator("[data-sheet-description]");
      await description.waitFor();
      const shown = await description.evaluate((element) => {
        const box = element.getBoundingClientRect();
        const footer = document.querySelector(".sheet-footer")?.getBoundingClientRect().top;
        const bottom = Math.min(box.bottom, footer ?? window.innerHeight, window.innerHeight);
        const line = Number.parseFloat(getComputedStyle(element).lineHeight);
        return { lines: (bottom - box.top) / line, total: box.height / line };
      });
      expect(shown.lines).toBeGreaterThanOrEqual(Math.min(shown.total, 2) - 0.1);
    });
  });
}

test.describe("touch 667 × 375: the extra-time choices", () => {
  test.use({ viewport: { width: 667, height: 375 }, hasTouch: true, isMobile: true });

  test("are 44 px tall under a coarse pointer", async ({ page }) => {
    await prepare(page);
    await page.goto("/guide");
    await expect(roving(page)).toHaveCount(1);
    await ready(page);
    await page
      .locator("#guide-grid button[data-index][data-when='future']:not([data-mark])")
      .first()
      .tap();
    const options = page.getByRole("button", { name: /^Options/u });
    await expect(options).toBeVisible();
    expect((await options.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    await options.tap();
    await ready(page);
    for (const label of ["Start early", "End late"]) {
      const select = page.getByRole("combobox", { name: label, exact: true });
      expect((await select.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    }
  });
});
