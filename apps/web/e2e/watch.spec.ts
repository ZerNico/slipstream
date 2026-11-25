import { expect, test, type Page } from "@playwright/test";
import {
  expectNoHorizontalOverflow,
  expectNoShiftOn,
  expectOverlaysFit,
  smallTargets,
} from "./support/layout.ts";
import { api, completedRecording, requireServer, seed, settle } from "./support/session.ts";

/*
 * The player against a real server and the fake source (`pnpm e2e`): it fills the viewport,
 * the panel and timeline hover move nothing, Esc closes the panel first, phone portrait has
 * 44 px controls, short landscape keeps every control on screen, Esc on the choice refocuses
 * its opener.
 */

requireServer({ source: true });

/**
 * Signs in, seeds the server and picks a visible channel nothing records: live on a recorded
 * channel plays that recording at its live edge (`/watch/rec/…?at=live`), not the live player.
 */
const channelToWatch = async (page: Page): Promise<string> => {
  const { channels } = await seed(page);
  const recordings = await api(page).get<{ channelId: string; state: string }[]>("/api/recordings");
  const busy = new Set(
    recordings.filter((entry) => entry.state === "recording").map((entry) => entry.channelId),
  );
  const channel = channels.find(
    (candidate) => !("hidden" in candidate && candidate.hidden) && !busy.has(candidate.id),
  );
  if (!channel) throw new Error("the fake source has no visible channel free of recordings");
  return channel.id;
};

/** Waits until the stream plays: the read-out has left its skeleton for a position. */
const playing = (page: Page) =>
  expect(page.locator("[data-player] [data-readout]:not([data-loading])").first()).toBeVisible({
    timeout: 30_000,
  });

/** Everything that may move on its own: the video, the clock text, the hover marker. */
const moving = ["video", "[data-readout]", ".tl", "[aria-live]", ".art"];

test.describe("desktop 1440 × 900", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("fills the viewport; the panel and hover move nothing; Esc closes the panel first", async ({
    page,
  }) => {
    const channel = await channelToWatch(page);
    await page.goto("/guide");
    await page.goto(`/watch/live/${channel}`);
    const player = page.locator("[data-player]");
    await expect(player).toBeVisible();
    await playing(page);
    // The viewport's content box, so a classic scrollbar (or none) never decides the result.
    const viewport = await page.evaluate(() => ({
      width: document.documentElement.clientWidth,
      height: document.documentElement.clientHeight,
    }));
    const box = await player.boundingBox();
    expect(box).toEqual({ x: 0, y: 0, ...viewport });
    await expectNoHorizontalOverflow(page);

    await expectNoShiftOn(page, () => page.keyboard.press("i"), {
      scope: "[data-player]",
      ignore: [...moving, "aside", "[aria-pressed]"],
    });
    await expect(page.locator("aside[aria-label='Player panel']")).not.toHaveAttribute("inert");
    await expectNoShiftOn(page, () => page.locator(".tl").hover(), {
      scope: "[data-player]",
      ignore: moving,
    });
    await page.keyboard.press("Escape");
    await expect(page.locator("aside[aria-label='Player panel']")).toHaveAttribute("inert", "");
    await expect(page).toHaveURL(/\/watch\/live\//u);
    await page.keyboard.press("Escape");
    await expect(page).toHaveURL(/\/guide/u);
  });

  test("the Options menu opens upwards and fits; a speed other than 1× shows in the row", async ({
    page,
  }) => {
    await seed(page);
    // A finished recording: at live, faster than 1× has nowhere to go and falls back to 1×.
    const finished = await completedRecording(page);
    await page.goto(`/watch/rec/${finished.id}?at=start`);
    await playing(page);
    await page.getByRole("button", { name: "Options" }).click();
    await expectOverlaysFit(page);
    await page.getByRole("menuitemradio", { name: "1.5×" }).click();
    await expect(page.locator("[data-speed]")).toHaveText("1.5×");
  });
});

test.describe("phone 390 × 844", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test("picture on top, 44 px controls below, no horizontal scroll", async ({ page }) => {
    const channel = await channelToWatch(page);
    await page.goto(`/watch/live/${channel}`);
    await expect(page.locator("[data-player][data-layout='portrait']")).toBeVisible();
    await playing(page);
    await expectNoHorizontalOverflow(page);
    expect(await smallTargets(page, 44, "[data-player]")).toEqual([]);
    await page.getByRole("button", { name: "Info" }).click();
    await expect(page).toHaveURL(/sheet=info/u);
    await page.goBack();
    await expect(page).not.toHaveURL(/sheet=info/u);
  });
});

for (const viewport of [
  { width: 667, height: 375 },
  { width: 844, height: 390 },
]) {
  test.describe(`short landscape ${viewport.width} × ${viewport.height}`, () => {
    test.use({ viewport, hasTouch: true, isMobile: true });

    test("the overlay, compact, every control on screen", async ({ page }) => {
      const channel = await channelToWatch(page);
      await page.goto(`/watch/live/${channel}`);
      await expect(page.locator("[data-player][data-layout='short']")).toBeVisible();
      await playing(page);
      const bottom = await page
        .getByRole("button", { name: /full screen/iu })
        .last()
        .evaluate((element) => element.getBoundingClientRect().bottom);
      expect(bottom).toBeLessThanOrEqual(viewport.height);
      await expectNoHorizontalOverflow(page);
    });
  });
}

test.describe("watch choice", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("Esc closes the choice and hands focus back to the button that opened it", async ({
    page,
  }) => {
    const { running } = await seed(page);
    await page.goto(`/recordings/r/${running.id}`);
    await settle(page);
    const opener = page
      .locator("main")
      .getByRole("button", { name: /^(Watch|Resume at)/u })
      .first();
    await opener.focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/choice=/u);
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("group", { name: "How to watch" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page).not.toHaveURL(/choice=/u);
    await expect(dialog).toHaveCount(0);
    await expect(opener).toBeFocused();
  });
});

test.describe("watching a past stretch from its start", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("plays what pause & rewind holds, from its start, as a finished programme", async ({
    page,
  }) => {
    const channel = await channelToWatch(page);
    // Watching live is what puts the channel into pause & rewind.
    await page.goto(`/watch/live/${channel}`);
    await playing(page);
    const start = Date.now();
    await page.waitForTimeout(15_000);
    const end = Date.now();
    await page.goto(`/watch/range/${channel}?start=${start}&end=${end}`);
    await playing(page);
    await expect(page.locator("[data-player-error]")).toHaveCount(0);
    // A finished thing: there is no live edge to go to.
    await expect(page.getByRole("button", { name: "Go live" })).toHaveCount(0);
  });

  test("says so when pause & rewind no longer holds the stretch", async ({ page }) => {
    const channel = await channelToWatch(page);
    const start = Date.now() - 2 * 24 * 3_600_000;
    await page.goto(`/watch/range/${channel}?start=${start}&end=${start + 3_600_000}`);
    const error = page.locator("[data-player-error]");
    await expect(error).toContainText("This programme is no longer in pause & rewind.", {
      timeout: 30_000,
    });
    await expect(error.getByRole("link", { name: "Back to the guide" })).toBeVisible();
  });
});
