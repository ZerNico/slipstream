import { expect, test, type Page } from "@playwright/test";
import { expectOverlaysFit } from "./support/layout.ts";
import {
  api,
  completedRecording,
  requireServer,
  runningRecordings,
  seed,
  settle,
} from "./support/session.ts";

/*
 * The main journeys against a real server (`pnpm e2e`): the Home hero, the watch choice,
 * recording from the programme sheet, the player's speed, volume and full screen, a new
 * collection, the series recording preview and a profile switch with a PIN.
 */

requireServer({ source: true });

test.use({ viewport: { width: 1440, height: 900 } });

interface Entry {
  readonly id: string;
  readonly title: string;
  readonly state: string;
  readonly channelId: string;
  readonly programmeId?: string;
}
interface Programme {
  readonly id: string;
  readonly title: string;
  readonly channelId: string;
  readonly start: string;
  readonly end: string;
}

/** A programme that starts between one and six hours from now and nobody records yet. */
const futureProgramme = async (page: Page): Promise<Programme> => {
  const call = api(page);
  const from = new Date(Date.now() + 60 * 60_000).toISOString();
  const to = new Date(Date.now() + 6 * 60 * 60_000).toISOString();
  const window = await call.get<Programme[]>(`/api/guide?from=${from}&to=${to}`);
  const recorded = new Set(
    (await call.get<Entry[]>("/api/recordings")).map((entry) => entry.programmeId),
  );
  const programme = window.find(
    (candidate) =>
      Date.parse(candidate.start) > Date.now() + 30 * 60_000 && !recorded.has(candidate.id),
  );
  if (programme === undefined) throw new Error("no future programme in the guide");
  return programme;
};

test.describe("Home hero", () => {
  test("shows the running recording, then equal tabs once a second one runs", async ({ page }) => {
    const seeded = await seed(page);
    await page.goto("/");
    await settle(page);
    const hero = page.locator("[data-home-hero]");
    await expect(hero).toHaveAttribute("data-state", /recording|several/u);

    // A second recording on another channel: the hero gets a tablist, nothing rotates.
    await runningRecordings(page, 2, [seeded.f1.id]);
    await page.reload();
    await settle(page);
    const tabs = page.locator("[data-hero-tabs] [role='tab']");
    await expect.poll(() => tabs.count()).toBeGreaterThanOrEqual(2);
    const first = tabs.first();
    await first.focus();
    await page.keyboard.press("ArrowRight");
    await expect(tabs.nth(1)).toHaveAttribute("aria-selected", "true");
    await expect(tabs.nth(1)).toBeFocused();
    await page.keyboard.press("Home");
    await expect(first).toHaveAttribute("aria-selected", "true");
  });
});

test.describe("watch choice", () => {
  test("a running recording opens the choice; From start plays it from its start", async ({
    page,
  }) => {
    const { running } = await seed(page);
    await page.goto(`/recordings/r/${running.id}`);
    await settle(page);
    await page
      .locator("main")
      .getByRole("button", { name: /^(Watch|Resume at)/u })
      .first()
      .click();
    await expect(page).toHaveURL(/choice=/u);
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("group", { name: "How to watch" })).toBeVisible();
    await expectOverlaysFit(page);
    await expect(dialog.locator(".choice-option[data-kind='live']")).toBeVisible();
    await dialog.locator(".choice-option[data-kind='start']").click();
    await expect(page).toHaveURL(new RegExp(`/watch/rec/${running.id}`, "u"));
    await expect(page.locator("[data-player]")).toBeVisible();
  });
});

test.describe("guide programme sheet", () => {
  test("Record once schedules the programme and the sheet says so", async ({ page }) => {
    await seed(page);
    const programme = await futureProgramme(page);
    await page.goto(`/guide?sheet=prog:${programme.id}`);
    const sheet = page.locator(".sheet");
    await expect(sheet.getByRole("button", { name: /^Options/u })).toBeVisible();
    await sheet.getByRole("button", { name: "Record", exact: true }).click();
    await expect
      .poll(async () =>
        (await api(page).get<Entry[]>("/api/recordings")).some(
          (entry) => entry.programmeId === programme.id && entry.state === "scheduled",
        ),
      )
      .toBe(true);
    // Recorded now: the footer offers to skip it instead of recording it again.
    await expect(sheet.getByRole("button", { name: "Don't record" })).toBeVisible();
  });
});

test.describe("player", () => {
  test("speed, volume and full screen work from the controls and the keys", async ({ page }) => {
    await seed(page);
    // A finished recording: a running one seeded just now is at live, where 1.5× drops to 1×.
    const finished = await completedRecording(page);
    await page.goto(`/watch/rec/${finished.id}?at=start`);
    const player = page.locator("[data-player]");
    await expect(player).toBeVisible();
    const video = page.locator("video");

    await page.getByRole("button", { name: "Options" }).click();
    await page.getByRole("menuitemradio", { name: "1.5×" }).click();
    await expect(page.locator("[data-speed]")).toHaveText("1.5×");
    await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.playbackRate)).toBe(1.5);

    // The player's keys work once the menu has gone and focus is not in a control of its own.
    await expect(page.locator("[data-slot='dropdown-menu-content']")).toHaveCount(0);
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    const before = await video.evaluate((v: HTMLVideoElement) => v.volume);
    await page.keyboard.press("ArrowDown");
    await expect
      .poll(() => video.evaluate((v: HTMLVideoElement) => v.volume))
      .toBeLessThan(before === 0 ? 1 : before);
    await page.keyboard.press("m");
    await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.muted)).toBe(true);

    await page.getByRole("button", { name: "Full screen" }).first().click();
    await expect.poll(() => page.evaluate(() => document.fullscreenElement !== null)).toBe(true);
    await page.keyboard.press("f");
    await expect.poll(() => page.evaluate(() => document.fullscreenElement === null)).toBe(true);
  });
});

test.describe("collections", () => {
  test("a new collection is created from the editor and lists in the library", async ({ page }) => {
    await seed(page);
    const name = `E2E ${Date.now()}`;
    await page.goto("/recordings/collections/new");
    await settle(page);
    await page.getByLabel("Name", { exact: true }).fill(name);
    const starts = page.getByLabel("Title starts with");
    await starts.fill("Tagesschau");
    await starts.press("Enter");
    await page.getByRole("button", { name: "Create collection" }).click();
    await expect
      .poll(async () =>
        (await api(page).get<{ name: string }[]>("/api/collections")).some(
          (collection) => collection.name === name,
        ),
      )
      .toBe(true);
  });
});

test.describe("series recordings", () => {
  test("the preview lists what the series recording will record as you edit it", async ({
    page,
  }) => {
    const { f1 } = await seed(page);
    await page.goto(`/series/new?title=Live%20F1%3A&channel=${encodeURIComponent(f1.id)}`);
    await settle(page);
    await expect(page.locator("main h1")).toHaveText("New series recording");
    await expect(page.locator("main")).toContainText("Conditions");
    const preview = page.locator("#rule-preview");
    await expect(preview).toContainText(/\d+ will record/u);
    await expect(preview.locator("mark").first()).toHaveText(/Live F1:/u);
    await expect(page.locator("main")).not.toContainText(/\brules?\b/iu);
  });
});

test.describe("profiles", () => {
  test("switching to a profile with a PIN asks for it, says when it is wrong and switches", async ({
    page,
  }) => {
    await seed(page);
    const call = api(page);
    const profiles = await call.get<{ id: string; displayName: string }[]>("/api/profiles");
    const kim =
      profiles.find((profile) => profile.displayName === "Kim") ??
      (await call.post<{ id: string }>("/api/profiles", {
        displayName: "Kim",
        avatarTone: "violet",
        role: "user",
        pin: "1234",
      }));
    await page.goto("/series");
    await settle(page);
    await page.getByRole("button", { name: "Profile and account" }).click();
    await page.getByRole("menuitem", { name: "Kim" }).click();
    await expect(page).toHaveURL(/dlg=pin/u);
    const dialog = page.getByRole("dialog");
    await dialog.locator("input").first().click();
    await page.keyboard.type("0000");
    await expect(dialog).toContainText("That PIN isn't right.");
    await dialog.locator("input").first().click();
    await page.keyboard.type("1234");
    await expect.poll(async () => (await call.get<{ id: string }>("/api/auth/me")).id).toBe(kim.id);
  });
});
