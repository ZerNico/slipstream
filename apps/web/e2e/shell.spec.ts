import { expect, test } from "@playwright/test";
import {
  expectNoHorizontalOverflow,
  expectNoShiftOn,
  expectNoShiftOnLoad,
  expectOverlaysFit,
  smallTargets,
} from "./support/layout.ts";
import { api, requireServer, seed, settle, signIn } from "./support/session.ts";

/*
 * The app shell against a fresh real server (`pnpm e2e`): navigation per breakpoint, no
 * horizontal scroll, no layout shift on load, 44 px targets on touch, Back closes overlays.
 * Setup and sign-in go through the API, so this runs before the auth screens are rebuilt.
 */

requireServer({ source: true });

const routes = ["/", "/guide", "/recordings", "/series", "/settings/sources"];

test.describe("desktop 1440 × 900", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("top bar with four tabs, no rail or tab bar, nothing shifts or overflows", async ({
    page,
  }) => {
    await signIn(page);
    for (const route of routes) {
      await expectNoShiftOnLoad(page, route);
      await expectNoHorizontalOverflow(page);
      await expect(page.locator(".shell-navtabs")).toBeVisible();
      await expect(page.locator(".shell-rail")).toBeHidden();
      await expect(page.locator(".shell-tabbar")).toBeHidden();
    }
    await expect(page.locator('.shell-navtabs a[href="/series"]')).toHaveText("Series");
  });

  test("hovering the navigation moves nothing", async ({ page }) => {
    await signIn(page);
    await page.goto("/series");
    await expectNoShiftOn(page, () => page.getByRole("link", { name: "Guide" }).first().hover(), {
      scope: "body",
    });
  });

  test("the palette opens with Ctrl K, lives in the URL and Back closes it", async ({ page }) => {
    await signIn(page);
    await page.goto("/guide");
    await settle(page);
    await page.keyboard.press("Control+k");
    await expect(page).toHaveURL(/dlg=cmdk/u);
    await page.goBack();
    await expect(page).toHaveURL(/\/guide$/u);
    await expect(page.getByRole("combobox")).toHaveCount(0);
  });

  test("the palette finds programmes in the guide and collections, and opens them", async ({
    page,
  }) => {
    const { collection } = await seed(page);
    // A programme that has not started yet, so picking it opens its sheet.
    const from = new Date(Date.now() + 60 * 60_000).toISOString();
    const to = new Date(Date.now() + 6 * 60 * 60_000).toISOString();
    const upcoming = await api(page).get<{ id: string; title: string; start: string }[]>(
      `/api/guide?from=${from}&to=${to}`,
    );
    const programme = upcoming.find((candidate) => Date.parse(candidate.start) > Date.now());
    if (programme === undefined) throw new Error("the fake guide has nothing in six hours");
    const search = (overlay: string) => new URL(page.url()).searchParams.get(overlay);

    await page.goto("/series");
    await settle(page);
    await page.keyboard.press("Control+k");
    const input = page.getByRole("combobox");
    const guide = page.getByRole("group", { name: "In the guide" });
    // One letter does not ask the server's guide search.
    await input.fill(programme.title.slice(0, 1));
    await expect(guide).toHaveCount(0);
    await input.fill(programme.title);
    // This airing's own option: a title such as "Nachrichten" airs every hour, and the airing
    // on air (being recorded) opens the watch choice instead of the sheet.
    const option = guide.locator(`[role="option"][id$="-programme-${programme.id}"]`);
    await expect(option).toBeVisible();
    await option.click();
    await expect.poll(() => search("sheet")).toBe(`prog:${programme.id}`);
    await expect(page.locator(".sheet").getByText(programme.title).first()).toBeVisible();
    await page.goBack();
    await expect.poll(() => search("sheet")).toBeNull();

    await page.keyboard.press("Control+k");
    await input.fill(collection.name);
    const found = page
      .getByRole("group", { name: "Collections" })
      .getByRole("option", { name: collection.name });
    await expect(found).toBeVisible();
    await found.click();
    await expect(page).toHaveURL(
      new RegExp(`/recordings/c/${encodeURIComponent(collection.id)}`, "u"),
    );
  });
});

test.describe("phone 390 × 844", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test("tab bar, 44 px targets, no horizontal scroll", async ({ page }) => {
    await signIn(page);
    for (const route of routes) {
      await page.goto(route);
      await expect(page.locator(".shell-tabbar")).toBeVisible();
      await expectNoHorizontalOverflow(page);
      expect(await smallTargets(page, 44, ".shell-tabbar")).toEqual([]);
      expect(await smallTargets(page, 44, ".shell-topbar")).toEqual([]);
    }
    await expect(page.locator('.shell-tabbar a[href="/series"]')).toHaveText("Series");
  });

  test("the account menu is a sheet in the URL and Back closes it before leaving", async ({
    page,
  }) => {
    await signIn(page);
    await page.goto("/series");
    await page.getByRole("button", { name: "Profile and account" }).click();
    await expect(page).toHaveURL(/dlg=account/u);
    await page.goBack();
    await expect(page).toHaveURL(/\/series$/u);
  });
});

test.describe("short landscape 667 × 375", () => {
  test.use({ viewport: { width: 667, height: 375 }, hasTouch: true, isMobile: true });

  test("the compact rail replaces the tab bar at any width (owner notes 37, 38)", async ({
    page,
  }) => {
    await signIn(page);
    await page.goto("/guide");
    await expect(page.locator(".shell-rail")).toBeVisible();
    await expect(page.locator(".shell-tabbar")).toBeHidden();
    await expectNoHorizontalOverflow(page);
    await expect(page.locator('.shell-rail a[href="/series"]')).toHaveText("Series");
  });

  test("the account sheet fits the short screen", async ({ page }) => {
    await signIn(page);
    await page.goto("/series");
    await page.getByRole("button", { name: "Profile and account" }).click();
    await expect(page).toHaveURL(/dlg=account/u);
    // Sheets open a frame after they mount (so they slide in): wait until this one is there.
    await expect(page.locator(".sheet")).toBeVisible();
    await expectOverlaysFit(page);
  });
});

test.describe("the renamed navigation (recording model §1)", () => {
  for (const [locale, word] of [
    ["en-GB", "Series"],
    ["de-DE", "Serien"],
  ] as const) {
    test.describe(locale, () => {
      test.use({ locale });

      test(`says ${word} on the top bar, the phone tab bar and the compact rail`, async ({
        page,
      }) => {
        await signIn(page);
        for (const [viewport, nav] of [
          [{ width: 1440, height: 900 }, ".shell-navtabs"],
          [{ width: 390, height: 844 }, ".shell-tabbar"],
          [{ width: 667, height: 375 }, ".shell-rail"],
        ] as const) {
          await page.setViewportSize(viewport);
          await page.goto("/guide");
          await expect(page.locator(`${nav} a[href="/series"]`)).toHaveText(word);
        }
      });
    });
  }

  test.describe("desktop", () => {
    test.use({ viewport: { width: 1440, height: 900 } });

    test("old /rules addresses land on /series, the id and the search kept", async ({ page }) => {
      const { rule, f1 } = await seed(page);
      await page.goto("/rules");
      await expect(page).toHaveURL(/\/series$/u);
      await page.goto(`/rules/${rule.id}`);
      await expect(page).toHaveURL(new RegExp(`/series/${rule.id}$`, "u"));
      await page.goto(`/rules/new?title=Live%20F1%3A&channel=${encodeURIComponent(f1.id)}`);
      await expect(page).toHaveURL(/\/series\/new\?/u);
      expect(new URL(page.url()).searchParams.get("title")).toBe("Live F1:");
    });

    test("G then E opens Series recordings, G then S Settings", async ({ page }) => {
      await signIn(page);
      await page.goto("/guide");
      await settle(page);
      await page.keyboard.press("g");
      await page.keyboard.press("e");
      await expect(page).toHaveURL(/\/series$/u);
      await expect(page.locator("main h1")).toHaveText("Series recordings");
      await page.keyboard.press("g");
      await page.keyboard.press("s");
      await expect(page).toHaveURL(/\/settings/u);
    });

    test("the palette lists them under Series recordings and opens the editor", async ({
      page,
    }) => {
      const { rule } = await seed(page);
      await page.goto("/guide");
      await settle(page);
      await page.keyboard.press("Control+k");
      await page.getByRole("combobox").fill(rule.name);
      const found = page
        .getByRole("group", { name: "Series recordings" })
        .getByRole("option", { name: rule.name });
      await expect(found).toBeVisible();
      await found.click();
      await expect(page).toHaveURL(new RegExp(`/series/${rule.id}`, "u"));
    });
  });
});
