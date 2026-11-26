import { expect, test, type Page } from "@playwright/test";
import {
  afterPaint,
  expectNoHorizontalOverflow,
  expectNoShiftOn,
  expectNoShiftOnLoad,
  expectOverlaysFit,
  recordLayoutShifts,
  smallTargets,
  takeLayoutShifts,
} from "./support/layout.ts";
import { api, completedRecording, requireServer, seed, settle } from "./support/session.ts";

/*
 * Recordings (SPEC §8.4, §8.5) against a running server: nothing moves on load or hover, no
 * horizontal scroll, 44 px touch targets, and the key flows. Flows that need recordings run
 * when the server has them (the dev mock always does).
 */

requireServer({ source: true });

/** Waits until the screen has rendered and finished loading (not just the HTML shell). */
const settled = async (page: Page) => {
  await expect(page.locator("main h1").first()).toBeVisible();
  await expect(page.locator("[data-loading]")).toHaveCount(0);
  await afterPaint(page);
};

const routes = [
  "/recordings",
  "/recordings?group=date",
  "/recordings/scheduled",
  "/recordings/problems",
  "/recordings/collections/new",
];

const viewports = [
  { width: 1440, height: 900, touch: false },
  { width: 1024, height: 768, touch: false },
  { width: 768, height: 1024, touch: true },
  { width: 390, height: 844, touch: true },
  { width: 844, height: 390, touch: true },
  { width: 667, height: 375, touch: true },
];

for (const viewport of viewports) {
  test.describe(`${viewport.width} × ${viewport.height}`, () => {
    test.use({
      viewport: { width: viewport.width, height: viewport.height },
      hasTouch: viewport.touch,
      isMobile: viewport.touch && viewport.width < 1000,
    });

    test("no horizontal scroll on any Recordings screen, in both themes", async ({ page }) => {
      await seed(page);
      for (const scheme of ["dark", "light"] as const) {
        await page.emulateMedia({ colorScheme: scheme });
        for (const route of routes) {
          await page.goto(route);
          await settled(page);
          await expectNoHorizontalOverflow(page);
        }
      }
    });
  });
}

for (const viewport of [viewports[0], viewports[3]]) {
  if (viewport === undefined) continue;
  test.describe(`skeleton ${viewport.width}`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    test("nothing moves between the skeleton and the loaded screen", async ({ page }) => {
      await seed(page);
      // The screen's reads wait until the skeleton was measured, so it is on screen then
      // whichever answer comes first; sign-in is not held, or the route would never mount.
      // Only the API: in a dev server, module paths such as /src/api/ must stay fast.
      let held: Promise<void> = Promise.resolve();
      await page.route(/^https?:\/\/[^/]+\/api\/(?!auth\/|events)/u, async (route) => {
        await held;
        await route.continue();
      });
      for (const route of routes) {
        // The first visit keeps the answers the skeleton is drawn from on the next load.
        await page.goto(route);
        await settled(page);
        const { promise, resolve } = Promise.withResolvers<void>();
        held = promise;
        await test.step(route, () => expectNoShiftOnLoad(page, route, { measured: resolve }));
      }
    });
  });
}

/**
 * Opens Home, then Scheduled from its link, and returns the shifts of the second screen alone.
 * Home leaves its answers in the cache; on Scheduled every read answers late (refetches and the
 * reads Home never made), so whatever the list draws first must be where it stays. The screen's
 * own unit test holds the conflicts back entirely (screens.test.tsx).
 */
const shiftsFromHome = async (page: Page) => {
  await recordLayoutShifts(page);
  await page.goto("/");
  await settle(page);
  const link = page.locator('main a[href="/recordings/scheduled"]').first();
  await expect(link).toHaveCount(1);
  await afterPaint(page);
  await takeLayoutShifts(page);
  await page.route(/^https?:\/\/[^/]+\/api\/(?!events)/u, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 600));
    await route.continue();
  });
  // A script click, not a user gesture: the browser would excuse shifts right after input.
  await link.evaluate((element: HTMLElement) => element.click());
  await expect(page).toHaveURL(/\/recordings\/scheduled$/u);
  await settled(page);
  await expect(page.locator("main section[aria-label]").first()).toBeVisible();
  await afterPaint(page);
  const shifts = await takeLayoutShifts(page);
  await page.unrouteAll({ behavior: "ignoreErrors" });
  return shifts;
};

for (const viewport of [
  { width: 390, height: 844, touch: true },
  { width: 1024, height: 768, touch: false },
  { width: 1440, height: 900, touch: false },
]) {
  test.describe(`Home to Scheduled ${viewport.width}`, () => {
    test.use({
      viewport: { width: viewport.width, height: viewport.height },
      hasTouch: viewport.touch,
      isMobile: viewport.touch,
    });

    test("opening Scheduled from Home shifts nothing (CLS < 0.01)", async ({ page }) => {
      const { channels } = await seed(page);
      // A stream limit of one and two overlapping recordings soon: a conflict above the rest, so
      // the list has flags, a resolution box and a streams line to wait for. Undone at the end.
      const call = api(page);
      const [source] = await call.get<{ id: string }[]>("/api/sources");
      if (source === undefined) throw new Error("no source after seeding");
      await call.patch(`/api/sources/${source.id}`, { maxStreams: 1 });
      const start = Date.now() + 90 * 60_000;
      const range = {
        start: new Date(start).toISOString(),
        end: new Date(start + 30 * 60_000).toISOString(),
      };
      const made: { id: string }[] = [];
      try {
        for (const channel of channels.slice(0, 2)) {
          made.push(
            await call.post<{ id: string }>("/api/recordings", {
              _tag: "Manual",
              channelId: channel.id,
              title: `E2E overlap on ${channel.name}`,
              range,
            }),
          );
        }
        const shifts = await shiftsFromHome(page);
        await expect(page.locator("main [data-resolve]").first()).toBeVisible();
        const cls = shifts.reduce((sum, shift) => sum + shift.value, 0);
        test.info().annotations.push({ type: "cls", description: cls.toFixed(4) });
        expect(cls, JSON.stringify(shifts)).toBeLessThan(0.01);
      } finally {
        for (const entry of made) await call.delete(`/api/recordings/${entry.id}`);
        // The field cannot be cleared; a limit no journey reaches stands in for none.
        await call.patch(`/api/sources/${source.id}`, { maxStreams: 64 });
      }
    });
  });
}

test.describe("desktop interactions", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("hovering cards, tiles and rows moves nothing", async ({ page }) => {
    await seed(page);
    await page.goto("/recordings");
    await settled(page);
    const card = page.locator("main .card").first();
    if ((await card.count()) > 0) {
      await expectNoShiftOn(page, () => card.hover(), {
        ignore: [".card-play", ".art", ".card-media"],
      });
    }
    await page.goto("/recordings/scheduled");
    await settled(page);
    const row = page.locator("main section .grid > div").first();
    if ((await row.count()) > 0) await expectNoShiftOn(page, () => row.hover());
  });

  test("the toolbar keeps its filters in the URL and Back restores them", async ({ page }) => {
    await seed(page);
    await page.goto("/recordings");
    await page.getByRole("button", { name: "By date" }).click();
    await expect(page).toHaveURL(/group=date/u);
    await page.getByRole("button", { name: "Unwatched" }).click();
    await expect(page).toHaveURL(/filter=unwatched/u);
    await page.getByRole("searchbox", { name: "Search recordings" }).fill("zzzz-nothing");
    await expect(page.getByText("Nothing matches “zzzz-nothing”")).toBeVisible();
    await page.getByRole("button", { name: "Clear filters" }).click();
    await expect(page).not.toHaveURL(/filter=/u);
  });

  test("a running recording's detail shows REC, its length so far and opens the choice", async ({
    page,
  }) => {
    const { running } = await seed(page);
    await page.goto(`/recordings/r/${running.id}`);
    await expect(page.locator("main .badge-live", { hasText: "Rec" })).toBeVisible();
    await expect(page.getByText(/so far/u)).toBeVisible();
    await page
      .locator("main")
      .getByRole("button", { name: /^(Watch|Resume at)/u })
      .first()
      .click();
    await expect(page).toHaveURL(/choice=/u);
    await page.goBack();
    await expect(page).not.toHaveURL(/choice=/u);
  });

  test("a scheduled recording's detail says when it starts and offers Skip and Series options", async ({
    page,
  }) => {
    await seed(page);
    const scheduled = (
      await api(page).get<{ id: string; state: string; ruleId?: string }[]>("/api/recordings")
    ).find((entry) => entry.state === "scheduled" && entry.ruleId !== undefined);
    test.skip(scheduled === undefined, "the series recording scheduled nothing on this guide");
    if (scheduled === undefined) return;
    await page.goto(`/recordings/r/${scheduled.id}`);
    await settled(page);
    const main = page.locator("main");
    await expect(main.locator(".badge-sched, .badge-warn").first()).toBeVisible();
    await expect(main.getByText(/^Starts \S+ \d{1,2} · /u)).toBeVisible();
    // One decision for the artwork's play overlay and the primary button: neither is there.
    await expect(main.locator("a[href*='/watch/']")).toHaveCount(0);
    await expect(main.getByRole("button", { name: /^(Play|Watch|Resume)/u })).toHaveCount(0);
    await expect(main.locator("dt", { hasText: "Size" })).toHaveCount(0);
    await expect(main.locator("dt", { hasText: "Will record by" })).toBeVisible();
    await expect(main.getByRole("button", { name: "Don't record" })).toBeVisible();
    await main.getByRole("link", { name: "Series options" }).click();
    await expect(page).toHaveURL(new RegExp(`/series/${scheduled.ruleId ?? ""}$`, "u"));
  });

  test("a collection that follows a series recording says so instead of its conditions", async ({
    page,
  }) => {
    const { f1 } = await seed(page);
    const call = api(page);
    // A series recording of its own, so grouping it never touches the seeded F1 collection.
    const name = `E2E linked ${Date.now()}`;
    const rule = await call.post<{ id: string }>("/api/rules", {
      name,
      enabled: true,
      matcher: {
        channels: [f1.id],
        title: [{ _tag: "StartsWith", values: [`${name}:`] }],
        categories: [],
        weekdays: [],
      },
      padding: { beforeMinutes: 0, afterMinutes: 0 },
      retention: { _tag: "KeepAll" },
    });
    const collection = await call.post<{ id: string }>(`/api/rules/${rule.id}/collection`, {
      name,
      layout: { parts: [], path: ["{date}"] },
    });
    try {
      await page.goto(`/recordings/collections/${collection.id}`);
      await settled(page);
      const main = page.locator("main");
      const follows = main.locator("[data-follows]");
      await expect(follows).toContainText(`Follows the series recording “${name}”: `);
      await expect(follows).toContainText(`titles starting with “${name}:”`);
      // Its conditions are the series recording's: they sit behind Advanced, which is closed.
      const advanced = main.getByRole("button", { name: "Advanced: what belongs here" });
      await expect(advanced).toHaveAttribute("aria-expanded", "false");
      await expect(main.getByLabel("Title starts with")).toHaveCount(0);
      await advanced.click();
      await expect(
        main.getByRole("button", { name: "Use its own conditions instead" }),
      ).toBeVisible();
      await follows.getByRole("link", { name: "Series options" }).click();
      await expect(page).toHaveURL(new RegExp(`/series/${rule.id}$`, "u"));
    } finally {
      await call.delete(`/api/rules/${rule.id}?collection=remove`);
    }
  });

  test("Keep the original brings a replaced recording back beside its repeat", async ({ page }) => {
    await seed(page);
    interface Listed {
      readonly id: string;
      readonly replaces?: { readonly recordingId: string; readonly keepUntil?: string };
    }
    const list = () => api(page).get<Listed[]>("/api/recordings");
    // A repeat the server still lets bring its original back names the deadline (`keepUntil`).
    // A fresh server only has one once a repeat replaced a damaged recording; the rerun
    // server's HTTP test covers the endpoint itself.
    const repeat = (await list()).find((entry) => entry.replaces?.keepUntil !== undefined);
    test.skip(repeat === undefined, "no repeat that replaced its original on this server");
    if (repeat?.replaces === undefined) return;
    const originalId = repeat.replaces.recordingId;
    expect((await list()).some((entry) => entry.id === originalId)).toBe(false);
    await page.goto(`/recordings/r/${repeat.id}`);
    await settled(page);
    const main = page.locator("main");
    await expect(main.locator("[data-replaces]")).toContainText("Replaces the recording from");
    await main.getByRole("button", { name: "Keep the original" }).click();
    await expect(page.getByText("Both recordings stay")).toBeVisible();
    await expect(main.getByRole("button", { name: "Keep the original" })).toHaveCount(0);
    // The original is listed again, and its own page opens.
    await expect
      .poll(async () => (await list()).some((entry) => entry.id === originalId))
      .toBe(true);
    await page.goto(`/recordings/r/${originalId}`);
    await settled(page);
    await expect(main.locator("h1")).toBeVisible();
  });

  test("a collection that no longer exists says so and leads back", async ({ page }) => {
    await seed(page);
    await page.goto("/recordings/collections/no-such-collection");
    const main = page.locator("main");
    await expect(main.locator("h1")).toHaveText("This collection no longer exists");
    await expect(main.getByText("Edit collection")).toHaveCount(0);
    await main.getByRole("link", { name: "Back to Recordings" }).click();
    await expect(page).toHaveURL(/\/recordings$/u);
  });

  test("the collection editor previews as you type and selects a prefilled name", async ({
    page,
  }) => {
    await seed(page);
    await page.goto("/recordings/collections/new");
    const name = page.getByLabel("Name", { exact: true });
    await name.fill("E2E Collection");
    const starts = page.getByLabel("Title starts with");
    await starts.fill("Tagesschau");
    await starts.press("Enter");
    await expect(page.getByRole("button", { name: "Remove Tagesschau" })).toBeVisible();
    await starts.press("Backspace");
    await expect(page.getByRole("button", { name: "Remove Tagesschau" })).toHaveCount(0);
    await expect(page.getByText(/^\d+ placed$/u)).toBeVisible();

    // "Make it a collection" from an automatic group: the name is prefilled and selected.
    await page.goto("/recordings");
    // A tile of Shows & films: something grouped automatically, not a collection.
    const show = page
      .locator("section", { has: page.getByRole("heading", { name: "Shows & films" }) })
      .locator("a.card");
    if ((await show.count()) > 0) {
      await show.first().click();
      await page.getByText("Make it a collection").click();
      const prefilled = page.getByLabel("Name", { exact: true });
      await expect(prefilled).toBeFocused();
      const selection = await prefilled.evaluate((input: HTMLInputElement) => [
        input.selectionStart,
        input.selectionEnd,
        input.value.length,
      ]);
      expect(selection[0]).toBe(0);
      expect(selection[1]).toBe(selection[2]);
      await page.keyboard.type("Typed");
      await expect(prefilled).toHaveValue("Typed");
    }
  });
});

test.describe("phone 390, touch", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test("targets reach 44 px and the move menu opens as a sheet that fits", async ({ page }) => {
    await seed(page);
    for (const route of ["/recordings", "/recordings/scheduled", "/recordings/collections/new"]) {
      await page.goto(route);
      await settled(page);
      expect(await smallTargets(page, 44, "main")).toEqual([]);
    }
    const finished = await completedRecording(page);
    await page.goto(`/recordings/r/${finished.id}`);
    await settled(page);
    // The trail collapses to one back crumb to the parent, a full 44 px target.
    const crumbs = page.locator("main nav").first();
    const back = crumbs.locator("a:visible");
    await expect(back).toHaveCount(1);
    const box = await back.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    expect(await smallTargets(page, 44, "main")).toEqual([]);
    await page.getByRole("button", { name: /Move…|Add to collection…/u }).click();
    await expect(page).toHaveURL(/dlg=move/u);
    await expectOverlaysFit(page);
    await page.goBack();
    await expect(page).not.toHaveURL(/dlg=move/u);
  });
});
