import { expect, test, type Page } from "@playwright/test";
import { afterPaint, recordLayoutShifts, takeLayoutShifts } from "./support/layout.ts";
import {
  api,
  completedRecording,
  requireServer,
  seed,
  type Seeded,
  settle,
} from "./support/session.ts";

/*
 * Zero layout shift on every route (SPEC §6), by the browser's CLS: each route loads cold, warm
 * and with one slow endpoint at a time at 1440 and 390 (at 667 × 375 those with a short-landscape
 * layout), and is hovered. The CLS per route is reported as `cls` annotations.
 */

requireServer({ source: true });

/**
 * Routes with a short-landscape layout of their own (`short:`, `media.shortLandscape`): Home's
 * hero, the guide's header and grid, the library's header and toolbar, the collection and series
 * editors. The rest only get the shell's compact rail and page head, which these cover.
 */
const ownShortLayout = (route: string): boolean =>
  route === "/" ||
  route === "/guide" ||
  /^\/recordings(\?|\/scheduled$|\/problems$|\/collections\/|$)/u.test(route) ||
  /^\/series\/./u.test(route);

/** Every screen, with the ids the seed made; in short landscape those with their own layout. */
const routes = async (page: Page, seeded: Seeded, short: boolean): Promise<string[]> => {
  const rules = await api(page).get<{ id: string }[]>("/api/rules");
  const collections = await api(page).get<{ id: string }[]>("/api/collections");
  const all = [
    "/",
    "/guide",
    "/recordings",
    "/recordings?group=channel",
    "/recordings/scheduled",
    "/recordings/problems",
    `/recordings/r/${seeded.running.id}`,
    `/recordings/collections/${collections[0]?.id ?? ""}`,
    "/recordings/collections/new",
    "/series",
    "/series/new",
    `/series/${rules[0]?.id ?? ""}`,
    "/settings/device",
    "/settings/sources",
    "/settings/recording",
    "/settings/users",
    "/settings/playback",
    "/settings/storage",
    "/settings/profile",
  ];
  return short ? all.filter(ownShortLayout) : all;
};

/** Slows the API reads `matches` picks (every read by default), so their answers come last. */
const slowApi = (page: Page, matches: (path: string) => boolean = () => true) =>
  page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.startsWith("/api/events") || !matches(path)) return route.continue();
    await new Promise((resolve) => setTimeout(resolve, 600));
    return route.continue();
  });

/** Loads a route and returns every shift from the first paint until it settled. */
const shiftsOnLoad = async (page: Page, route: string) => {
  await page.goto(route);
  await settle(page);
  await afterPaint(page);
  return takeLayoutShifts(page);
};

/** The CLS of a set of shifts: their summed scores, as Core Web Vitals adds them. */
const cls = (shifts: readonly { readonly value: number }[]) =>
  shifts.reduce((sum, shift) => sum + shift.value, 0);

/**
 * Forgets the app's kept answers (the skeleton's shapes), so the next load is really cold. The
 * storage belongs to the app's origin, so it is cleared from a static file of that origin: no
 * app code runs there to write it back. The session cookie stays, so the load stays signed in.
 */
const clearStorage = async (page: Page) => {
  await page.goto("/favicon.svg");
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  expect(await page.evaluate(() => localStorage.length)).toBe(0);
};

/**
 * One slow endpoint at a time: each answer arriving last, after everything else rendered, must
 * not move anything either. The routes are those that read it.
 */
const slowAlone = (seeded: Seeded) => [
  {
    name: "/api/system",
    matches: (path: string) => path === "/api/system",
    routes: ["/", "/guide", "/recordings", "/series", "/settings/storage", "/settings/playback"],
  },
  {
    name: "/api/sources",
    matches: (path: string) => path === "/api/sources",
    routes: ["/", "/recordings/scheduled", "/settings/sources"],
  },
  {
    name: "recording detail",
    matches: (path: string) => path === `/api/recordings/${seeded.running.id}`,
    routes: [`/recordings/r/${seeded.running.id}`],
  },
];

for (const viewport of [
  { width: 1440, height: 900, touch: false, short: false },
  { width: 390, height: 844, touch: true, short: false },
  { width: 667, height: 375, touch: true, short: true },
]) {
  test.describe(`${viewport.width} × ${viewport.height}`, () => {
    test.use({
      viewport: { width: viewport.width, height: viewport.height },
      hasTouch: viewport.touch,
      isMobile: viewport.touch,
    });

    test("every route loads without a layout shift, cold and warm", async ({ page }) => {
      test.setTimeout(300_000);
      const seeded = await seed(page);
      const list = await routes(page, seeded, viewport.short);
      await recordLayoutShifts(page);
      const found: Record<string, unknown> = {};
      await slowApi(page);
      const measured: string[] = [];
      for (const route of list) {
        await clearStorage(page);
        const shifts = await shiftsOnLoad(page, route);
        measured.push(`cold ${route} ${cls(shifts).toFixed(4)}`);
        if (shifts.length > 0) found[`cold ${route}`] = shifts;
      }
      await page.unrouteAll({ behavior: "ignoreErrors" });
      for (const route of list) {
        const shifts = await shiftsOnLoad(page, route);
        measured.push(`warm ${route} ${cls(shifts).toFixed(4)}`);
        if (shifts.length > 0) found[`warm ${route}`] = shifts;
      }
      test.info().annotations.push({ type: "cls", description: measured.join("\n") });
      expect(found).toEqual({});
    });

    test("/recordings with a finished recording loads with CLS 0, cold and warm", async ({
      page,
    }) => {
      test.setTimeout(120_000);
      await seed(page);
      await completedRecording(page);
      await recordLayoutShifts(page);
      await slowApi(page);
      await clearStorage(page);
      const cold = await shiftsOnLoad(page, "/recordings");
      await page.unrouteAll({ behavior: "ignoreErrors" });
      const warm = await shiftsOnLoad(page, "/recordings");
      test.info().annotations.push({
        type: "cls",
        description: `cold /recordings ${cls(cold).toFixed(4)}\nwarm /recordings ${cls(warm).toFixed(4)}`,
      });
      // The shifts themselves, so a failure names what moved; CLS 0 means there are none.
      expect({ cold, warm }).toEqual({ cold: [], warm: [] });
    });

    test("/ → /guide → /recordings with no kept collections moves nothing", async ({ page }) => {
      test.setTimeout(120_000);
      await seed(page);
      await completedRecording(page);
      await recordLayoutShifts(page);
      await clearStorage(page);
      // Home and the guide keep the recordings, never the collections or series recordings: the
      // library must wait for those too instead of drawing collection recordings as shows first.
      await shiftsOnLoad(page, "/");
      await shiftsOnLoad(page, "/guide");
      const kept = await page.evaluate(() => ({
        recordings: localStorage.getItem("ss-shape.recordings") !== null,
        collections: localStorage.getItem("ss-shape.collections") !== null,
      }));
      expect(kept.collections).toBe(false);
      await slowApi(page, (path) => path === "/api/collections" || path === "/api/rules");
      await page.locator("a[href='/recordings']:visible").first().click();
      await expect(page).toHaveURL(/\/recordings$/u);
      await settle(page);
      await afterPaint(page);
      const shifts = await takeLayoutShifts(page);
      await page.unrouteAll({ behavior: "ignoreErrors" });
      test.info().annotations.push({
        type: "cls",
        description: `/ → /guide → /recordings (recordings kept: ${String(kept.recordings)}) ${cls(shifts).toFixed(4)}`,
      });
      expect(shifts).toEqual([]);
    });

    test("one slow endpoint at a time moves nothing", async ({ page }) => {
      test.setTimeout(300_000);
      const seeded = await seed(page);
      await recordLayoutShifts(page);
      const found: Record<string, unknown> = {};
      const measured: string[] = [];
      for (const endpoint of slowAlone(seeded)) {
        await slowApi(page, endpoint.matches);
        const list = endpoint.routes.filter((route) => !viewport.short || ownShortLayout(route));
        for (const route of list) {
          // Warm (the shape caches filled by a first visit) and cold: the late answer must land
          // in its box both ways.
          await shiftsOnLoad(page, route);
          for (const temperature of ["warm", "cold"] as const) {
            if (temperature === "cold") await clearStorage(page);
            const shifts = await shiftsOnLoad(page, route);
            const key = `${endpoint.name} slow, ${temperature} ${route}`;
            measured.push(`${key} ${cls(shifts).toFixed(4)}`);
            if (shifts.length > 0) found[key] = shifts;
          }
        }
        await page.unrouteAll({ behavior: "ignoreErrors" });
      }
      test.info().annotations.push({ type: "cls", description: measured.join("\n") });
      expect(found).toEqual({});
    });
  });
}

/**
 * The player's chrome (SPEC §6, §7.1): the read-out is mounted from the first frame at its
 * fixed height, as skeleton until the stream gives a position, so nothing under or beside it
 * moves when playback starts. Measured from a cold load until the read-out shows a position,
 * on a running recording and on a channel live.
 */
for (const viewport of [
  { width: 768, height: 1024 },
  { width: 1440, height: 900 },
]) {
  test.describe(`player ${viewport.width} × ${viewport.height}`, () => {
    test.use({ viewport });

    test("the player's chrome does not move while the stream starts", async ({ page }) => {
      test.setTimeout(120_000);
      const seeded = await seed(page);
      const recordings =
        await api(page).get<{ channelId: string; state: string }[]>("/api/recordings");
      const busy = new Set(
        recordings.filter((entry) => entry.state === "recording").map((entry) => entry.channelId),
      );
      const free = seeded.channels.find(
        (channel) => !("hidden" in channel && channel.hidden) && !busy.has(channel.id),
      );
      if (free === undefined) throw new Error("no channel free of recordings to watch live");
      await recordLayoutShifts(page);
      const measured: string[] = [];
      const found: Record<string, unknown> = {};
      for (const route of [`/watch/rec/${seeded.running.id}?at=live`, `/watch/live/${free.id}`]) {
        await clearStorage(page);
        await page.goto(route);
        await expect(
          page.locator("[data-player] [data-readout]:not([data-loading])").first(),
        ).toBeVisible({ timeout: 30_000 });
        await afterPaint(page);
        const shifts = await takeLayoutShifts(page);
        const value = cls(shifts);
        measured.push(`${route} ${value.toFixed(4)}`);
        // The shifts themselves, so a failure names what moved.
        if (value >= 0.01) found[route] = shifts;
      }
      test.info().annotations.push({ type: "cls", description: measured.join("\n") });
      expect(found).toEqual({});
    });
  });
}

// Hover only exists with a mouse, so this runs at the pointer viewport alone.
test.describe("1440 × 900 hover", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("hovering links and buttons moves nothing on any route", async ({ page }) => {
    test.setTimeout(300_000);
    const seeded = await seed(page);
    const list = await routes(page, seeded, false);
    await recordLayoutShifts(page);
    const found: Record<string, unknown> = {};
    for (const route of list) {
      await page.goto(route);
      await settle(page);
      await afterPaint(page);
      await takeLayoutShifts(page);
      const targets = page.locator("main a[href]:visible, main button:visible");
      const count = Math.min(await targets.count(), 16);
      for (let index = 0; index < count; index += 1) {
        const target = targets.nth(index);
        if (!(await target.isVisible())) continue;
        await target.hover({ timeout: 2_000 }).catch(() => undefined);
        await afterPaint(page);
      }
      await page.mouse.move(0, 0);
      await afterPaint(page);
      const shifts = await takeLayoutShifts(page);
      if (shifts.length > 0) found[`hover ${route}`] = shifts;
    }
    expect(found).toEqual({});
  });
});
