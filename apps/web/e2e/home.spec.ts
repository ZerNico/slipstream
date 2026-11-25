import { expect, test, type Page } from "@playwright/test";
import {
  expectNoHorizontalOverflow,
  expectNoShiftOn,
  expectNoShiftOnLoad,
  smallTargets,
} from "./support/layout.ts";
import { requireServer, signIn } from "./support/session.ts";

/*
 * Home against a real server (`pnpm e2e`): nothing shifts on load or hover, no horizontal
 * scroll at any width, the hero's actions are on screen and tappable in phone landscape (open
 * issue: the tab bar covered them), and touch targets reach 44 px.
 */

requireServer();

/** Whether the element under the centre of the hero's first action is that action. */
const primaryIsHitTarget = (page: Page) =>
  page.evaluate(() => {
    const action = document.querySelector("[data-hero-action] a, [data-hero-action] button");
    if (!action) return false;
    const box = action.getBoundingClientRect();
    if (box.bottom > window.innerHeight) return false;
    const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
    return hit !== null && action.contains(hit);
  });

const viewports = [
  { width: 1440, height: 900 },
  { width: 1024, height: 768 },
  { width: 768, height: 1024 },
];

for (const viewport of viewports) {
  test.describe(`${viewport.width} × ${viewport.height}`, () => {
    test.use({ viewport });

    test("Home loads without shifting or overflowing, the hero keeps one height", async ({
      page,
    }) => {
      await signIn(page);
      await expectNoShiftOnLoad(page, "/");
      await expectNoHorizontalOverflow(page);
      const hero = page.locator("[data-hero-stage]");
      const height = await hero.evaluate((element) => element.getBoundingClientRect().height);
      const expected = await page.evaluate(() =>
        Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--hero-h")),
      );
      if (!Number.isNaN(expected)) expect(Math.round(height)).toBe(Math.round(expected));
      expect(await primaryIsHitTarget(page)).toBe(true);
    });

    test("a slow reload shows the remembered layout and lands in the same boxes", async ({
      page,
    }) => {
      await signIn(page);
      await page.goto("/");
      await page.waitForSelector("[data-home-page]:not([data-loading])");
      await page.route("**/api/recordings**", async (route) => {
        await new Promise((resolve) => setTimeout(resolve, 1500));
        await route.continue();
      });
      await expectNoShiftOnLoad(page, "/");
    });

    test("hovering cards and hero actions moves nothing", async ({ page }) => {
      await signIn(page);
      await page.goto("/");
      await page.waitForSelector("[data-home-page]:not([data-loading])");
      // The hero first: leaving a hovered card lowers its art again, which is the hover itself.
      await expectNoShiftOn(page, () => page.locator("[data-hero-action]").first().hover(), {
        ignore: ["[role='tooltip']"],
      });
      const card = page.locator(".card").first();
      if ((await card.count()) > 0) {
        await expectNoShiftOn(page, () => card.hover(), {
          ignore: [".card-play", ".row-arrow", ".art"],
        });
      }
    });
  });
}

const phones = [
  { width: 390, height: 844 },
  { width: 360, height: 780 },
  { width: 844, height: 390 },
  { width: 667, height: 375 },
  { width: 740, height: 360 },
];

for (const viewport of phones) {
  test.describe(`touch ${viewport.width} × ${viewport.height}`, () => {
    test.use({ viewport, hasTouch: true, isMobile: viewport.width < 600 });

    test("no horizontal scroll, the primary action is on screen and tappable", async ({ page }) => {
      await signIn(page);
      await expectNoShiftOnLoad(page, "/");
      await expectNoHorizontalOverflow(page);
      expect(await primaryIsHitTarget(page)).toBe(true);
      expect(await smallTargets(page, 44, "main")).toEqual([]);
    });
  });
}
