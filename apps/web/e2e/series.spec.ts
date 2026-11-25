import { expect, test, type Page } from "@playwright/test";
import {
  expectNoHorizontalOverflow,
  expectNoShiftOn,
  expectNoShiftOnLoad,
  smallTargets,
} from "./support/layout.ts";
import { api, requireServer, seed, settle, signIn } from "./support/session.ts";
import { pick, selectNumber } from "./support/select.ts";

/*
 * Series recordings against a real server (`pnpm e2e`): list and editor load without shift or
 * sideways scroll, with 44 px targets on touch; extra time starts from the channel's default;
 * New collection keeps its place; Episodes saves the choice.
 */

requireServer({ source: true });

/** What the two extra-time selects show in minutes, start early first. */
const extraValues = (page: Page) =>
  Promise.all(
    ["Start early", "End late"].map((name) => selectNumber(page.getByRole("combobox", { name }))),
  );

/** Unfolds the editor's Options (extra time, episodes, Goes to) unless they are open. */
const openOptions = async (page: Page) => {
  const toggle = page.locator("main").getByRole("button", { name: /^Options/u });
  if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
};

for (const [width, height, touch] of [
  [1440, 900, false],
  [1024, 768, false],
  [768, 1024, false],
  [390, 844, true],
  [844, 390, true],
  [667, 375, true],
] as const) {
  test.describe(`series recordings at ${width} × ${height}`, () => {
    test.use({ viewport: { width, height }, hasTouch: touch, isMobile: touch });

    test("list and editor load without shift or sideways scroll", async ({ page }) => {
      const { rule } = await seed(page);
      for (const route of ["/series", "/series/new", `/series/${rule.id}`]) {
        await expectNoShiftOnLoad(page, route, { ignore: ["[data-save-bar]", "#rule-preview"] });
        await expectNoHorizontalOverflow(page);
        if (touch) expect(await smallTargets(page, 44, "main")).toEqual([]);
      }
    });
  });
}

test.describe("series recording editor at 1440 × 900", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("hovering the list and the editor moves nothing", async ({ page }) => {
    await signIn(page);
    // Targets are scrolled into view first: only the hover itself may (and must not) move things.
    await page.goto("/series");
    await settle(page);
    const card = page.locator("main a[href^='/series/']").first();
    await card.scrollIntoViewIfNeeded();
    await expectNoShiftOn(page, () => card.hover(), { ignore: [".tip"] });
    await page.goto("/series/new");
    await settle(page);
    await openOptions(page);
    const early = page.getByRole("combobox", { name: "Start early" });
    // In the middle of the screen, clear of the sticky save bar, so the hover scrolls nothing.
    await early.evaluate((element) => element.scrollIntoView({ block: "center" }));
    await settle(page);
    await expectNoShiftOn(page, () => early.hover(), { ignore: [".tip"] });
  });

  test("extra time starts from the channel's default", async ({ page }) => {
    const { f1: channel } = await seed(page);
    // A channel override, the case of open issue 1: Sky Sport F1 HD 5/60 beats the global 2/10.
    await page.route("**/api/settings/recording", (route) =>
      route.fulfill({
        json: {
          extraTime: {
            padding: { beforeMinutes: 2, afterMinutes: 10 },
            overrides: [
              {
                _tag: "Channel",
                channelId: channel.id,
                padding: { beforeMinutes: 5, afterMinutes: 60 },
              },
            ],
          },
          artworkOrder: ["guide", "frame"],
        },
      }),
    );
    await page.goto(`/series/new?title=Live%20F1%3A&channel=${encodeURIComponent(channel.id)}`);
    await settle(page);
    await openOptions(page);
    await expect.poll(() => extraValues(page)).toEqual([5, 60]);
  });

  test("New collection: name selected, Enter creates, Esc cancels only the step", async ({
    page,
  }) => {
    const { f1: channel } = await seed(page);
    await page.goto(`/series/new?title=E2E%20Show%3A&channel=${encodeURIComponent(channel.id)}`);
    // The editor mounts afresh once it loaded: pick only then, or the pick is lost with it.
    await settle(page);
    await openOptions(page);
    const select = page.locator("#rule-collection");
    await pick(page, select, "New collection…");
    const name = page.locator("#rule-new-collection");
    await expect(name).toBeFocused();
    expect(
      await name.evaluate((input: HTMLInputElement) => [
        input.selectionStart,
        input.selectionEnd === input.value.length,
      ]),
    ).toEqual([0, true]);
    await page.keyboard.press("Escape");
    await expect(name).toHaveCount(0);
    await expect(select).toBeFocused();

    const unique = `E2E ${Date.now()}`;
    await pick(page, select, "New collection…");
    await page.keyboard.type(unique);
    await page.keyboard.press("Enter");
    await expect(select).toBeFocused();
    await expect(select).toHaveText(unique);
  });
});

test.describe("the Episodes section at 1440 × 900", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("starts on only episodes you don't have yet and saves All airings", async ({ page }) => {
    const { rule } = await seed(page);
    const call = api(page);
    await call.patch(`/api/rules/${rule.id}`, { skipRepeats: true });
    try {
      await page.goto(`/series/${rule.id}`);
      await settle(page);
      await openOptions(page);
      const episodes = page.getByRole("radiogroup", { name: "Episodes" });
      await expect(episodes.getByRole("radio", { name: "New episodes only" })).toBeChecked();
      const every = episodes.getByRole("radio", { name: "All airings" });
      // The row is the target; the native radio under the drawn circle is for the keyboard.
      await episodes.getByText("All airings", { exact: true }).click();
      await expect(every).toBeChecked();
      // What the editor sends is the contract; the server keeping it is the server's own test.
      const patch = page.waitForRequest(
        (request) =>
          request.method() === "PATCH" && request.url().endsWith(`/api/rules/${rule.id}`),
      );
      await page.locator("[data-save-bar]").getByRole("button", { name: "Save" }).click();
      expect((await patch).postDataJSON()).toMatchObject({ skipRepeats: false });
      await expect(page).toHaveURL(/\/series$/u);
    } finally {
      await call.patch(`/api/rules/${rule.id}`, { skipRepeats: true });
    }
  });
});

test.describe("series recording editor at 667 × 375", () => {
  test.use({ viewport: { width: 667, height: 375 }, hasTouch: true, isMobile: true });

  test("the first fields are on the first screen", async ({ page }) => {
    const { f1 } = await seed(page);
    await page.goto(`/series/new?title=Live%20F1%3A&channel=${encodeURIComponent(f1.id)}`);
    await settle(page);
    const name = page.locator("#rule-name");
    const box = await name.boundingBox();
    const bar = await page.locator("[data-save-bar]").boundingBox();
    expect(box).not.toBeNull();
    // Above the save bar and the bottom edge, without scrolling.
    expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual(bar?.y ?? 375);
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    // The title is for assistive tech only and the save bar is one 48 px row, so Name and
    // Channels with its first row of chips show on the first screen.
    expect((await page.locator("main h1").boundingBox())?.height ?? 0).toBeLessThanOrEqual(1);
    expect((await page.locator("[data-save-bar] > div").boundingBox())?.height).toBe(48);
    const showing = await page.evaluate((barTop) => {
      const fields = [...document.querySelectorAll(".panel .field")];
      return fields.filter((field) => {
        const rect = field.getBoundingClientRect();
        // Its label and a 44 px control row above the bar.
        return rect.height > 0 && rect.top >= 0 && rect.top + Math.min(rect.height, 64) <= barTop;
      }).length;
    }, bar?.y ?? 375);
    expect(showing).toBeGreaterThanOrEqual(2);
  });
});

test.describe("series recording editor at 390 × 844 in German", () => {
  test.use({
    viewport: { width: 390, height: 844 },
    locale: "de-DE",
    hasTouch: true,
    isMobile: true,
  });

  test("no save bar control overflows: the primary keeps its label, Cancel is an icon", async ({
    page,
  }) => {
    const { f1 } = await seed(page);
    const prefilled = `/series/new?title=Live%20F1%3A&channel=${encodeURIComponent(f1.id)}`;
    for (const route of ["/series/new", prefilled]) {
      await page.goto(route);
      await settle(page);
      const bar = page.locator("[data-save-bar]");
      await expect(bar.getByRole("button", { name: "Anlegen" })).toBeVisible();
      await expect(bar.getByRole("link", { name: "Abbrechen" })).toBeVisible();
      const overflowing = await bar.evaluate((root) => {
        const edge = root.getBoundingClientRect();
        return [...root.querySelectorAll<HTMLElement>("button, a")]
          .filter((control) => control.getClientRects().length > 0)
          .filter((control) => {
            const box = control.getBoundingClientRect();
            const label = control.querySelector<HTMLElement>(".btn-label") ?? control;
            return (
              box.left < edge.left - 0.5 ||
              box.right > edge.right + 0.5 ||
              label.scrollWidth > label.clientWidth + 0.5
            );
          })
          .map((control) => control.textContent?.trim() ?? control.outerHTML.slice(0, 60));
      });
      expect(overflowing).toEqual([]);
    }
  });
});
