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
