import { expect, test } from "@playwright/test";
import {
  expectNoHorizontalOverflow,
  expectNoShiftOnLoad,
  expectOverlaysFit,
  smallTargets,
} from "./support/layout.ts";
import { admin, requireServer, signIn } from "./support/session.ts";

/*
 * Settings and the auth screens against a real server (`pnpm e2e`): every section loads
 * without layout shift or sideways scroll, dialogs live in the URL and fit the screen, and
 * sign-in says a wrong password in place.
 */

requireServer();

const sections = ["device", "profile", "sources", "recording", "users", "playback", "storage"];

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
  { width: 667, height: 375 },
]) {
  test.describe(`settings ${viewport.width} × ${viewport.height}`, () => {
    const touch = viewport.width < 768 || viewport.height <= 520;
    test.use({ viewport, hasTouch: touch, isMobile: touch });

    test("every section loads in place and never scrolls sideways", async ({ page }) => {
      await signIn(page);
      for (const section of sections) {
        await expectNoShiftOnLoad(page, `/settings/${section}`);
        await expectNoHorizontalOverflow(page);
        // Switches, links and buttons all answer a finger in 44 px (SPEC §9).
        if (touch) expect(await smallTargets(page, 44, "main")).toEqual([]);
      }
    });

    test("adding a source is a dialog in the URL that fits and Back closes", async ({ page }) => {
      await signIn(page);
      await page.goto("/settings/sources");
      await page.getByRole("button", { name: "Add source" }).first().click();
      await expect(page).toHaveURL(/dlg=source/u);
      await expectOverlaysFit(page);
      await page.goBack();
      await expect(page).toHaveURL(/\/settings\/sources$/u);
    });
  });
}

for (const locale of ["en-GB", "de-DE"]) {
  test.describe(`settings header in ${locale} at 1440 × 900`, () => {
    test.use({ viewport: { width: 1440, height: 900 }, locale });

    test("the server line names the version and loads in place", async ({ page }) => {
      await signIn(page);
      await expectNoShiftOnLoad(page, "/settings/storage");
      await expect(page.locator("main")).toContainText(/Slipstream \S+ · Server/iu);
    });
  });
}

test.describe("settings in German at 1440 × 900", () => {
  test.use({ viewport: { width: 1440, height: 900 }, locale: "de-DE" });

  test("the section nav shows every name and the current pill whole", async ({ page }) => {
    await signIn(page);
    await page.goto("/settings/playback");
    const nav = page.getByRole("navigation", { name: "Bereiche der Einstellungen" });
    await expect(nav.getByRole("link", { name: "Standardqualität" })).toBeVisible();
    // Nothing in the nav is wider than its box or reaches past the nav's column.
    const clipped = await nav.evaluate((element) => {
      const column = element.getBoundingClientRect();
      return [...element.querySelectorAll<HTMLElement>("a, a > span")]
        .filter((child) => {
          const box = child.getBoundingClientRect();
          return (
            child.scrollWidth > child.clientWidth + 1 ||
            box.left < column.left - 1 ||
            box.right > column.right + 1
          );
        })
        .map((child) => child.textContent ?? "");
    });
    expect(clipped).toEqual([]);
    await expectNoHorizontalOverflow(page);
  });
});

test.describe("settings groups at 1440 × 900", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("This device keeps the player's quality; the server says it applies to every profile", async ({
    page,
  }) => {
    await signIn(page);
    await page.goto("/settings");
    await expect(page).toHaveURL(/\/settings\/device$/u);
    const nav = page.getByRole("navigation", { name: "Settings sections" });
    await expect(nav).toContainText("Server");
    await expect(nav).toContainText("Applies to every profile on this server");
    const quality = page.getByRole("combobox", { name: "Quality" });
    await expect(quality).toHaveText(/Default/u);
    await quality.click();
    await page.getByRole("option", { name: "Original" }).click();
    await expect(quality).toHaveText(/Original/u);
    expect(await page.evaluate(() => localStorage.getItem("ss-player.quality"))).toBe("original");
    await page.goto("/settings/playback");
    await page.getByRole("link", { name: "Quality on this device" }).click();
    await expect(page).toHaveURL(/\/settings\/device$/u);
  });
});

test.describe("live TV settings at 1440 × 900", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("Recording keeps how long a channel runs on and its rewind buffer", async ({ page }) => {
    await signIn(page);
    await page.goto("/settings/recording");
    const running = page.getByRole("combobox", {
      name: "Keep a channel running after the last viewer leaves",
    });
    const buffer = page.getByRole("combobox", { name: "Keep the rewind buffer after it stops" });
    await expect(running).toHaveText(/10\smin/u);
    await expect(buffer).toHaveText(/1\sh/u);
    const live = async () => (await page.request.get("/api/settings/live")).json();

    await running.click();
    await page.getByRole("option", { name: "Until the programme ends" }).click();
    await expect(running).toHaveText("Until the programme ends");
    await expect.poll(live).toEqual({ keepRunning: "programmeEnd", keepBufferMinutes: 60 });
    await page.reload();
    await expect(running).toHaveText("Until the programme ends");

    // Back to the default, for the specs after this one.
    await running.click();
    await page.getByRole("option", { name: /^10\smin$/u }).click();
    await expect.poll(live).toEqual({ keepRunning: 10, keepBufferMinutes: 60 });
  });
});

test("sign-in says a wrong password under the field", async ({ page }) => {
  await signIn(page);
  await page.request.post("/api/auth/logout");
  await page.goto("/login");
  await page.getByLabel("Username").fill(admin.username);
  await page.getByLabel("Password").fill("not-the-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("alert")).toContainText("Wrong username or password.");
  await expectNoHorizontalOverflow(page);
});
