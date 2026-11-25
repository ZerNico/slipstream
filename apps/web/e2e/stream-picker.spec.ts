import { expect, type Page, test } from "@playwright/test";
import { SourceInput } from "@slipstream/domain";
import { Schema } from "effect";
import { expectNoHorizontalOverflow, expectOverlaysFit } from "./support/layout.ts";
import { api, requireServer, signIn, sourceUrl } from "./support/session.ts";

/*
 * The stream picker with the fake source's big line-up (`?lineup=big`): a big playlist waits in
 * the picker; search, Select all and Add make channels. Everything added is removed again, so
 * other journeys see the line-up they expect.
 */

requireServer({ source: true });

interface Named {
  readonly id: string;
  readonly name: string;
}

const bigPlaylist = () => `${sourceUrl}/playlist.m3u?lineup=big`;
const bigGuide = () => `${sourceUrl}/epg.xml?lineup=big`;

/** Removes the source and the channels the journey made, whatever happened. */
const cleanUp = async (page: Page, before: ReadonlySet<string>, name: string) => {
  const call = api(page);
  for (const channel of await call.get<Named[]>("/api/channels")) {
    if (!before.has(channel.id)) await call.delete(`/api/channels/${channel.id}`);
  }
  for (const source of await call.get<Named[]>("/api/sources")) {
    if (source.name === name) await call.delete(`/api/sources/${source.id}`);
  }
};

const channelIds = async (page: Page) =>
  new Set((await api(page).get<Named[]>("/api/channels")).map((channel) => channel.id));

test.describe("stream picker at 1440 × 900", () => {
  test.use({ viewport: { width: 1440, height: 900 }, locale: "en-GB" });

  test("a big playlist opens the picker, and search, Select all and Add make channels", async ({
    page,
  }) => {
    await signIn(page);
    const before = await channelIds(page);
    try {
      await page.goto("/settings/sources");
      await page.getByRole("button", { name: "Add source" }).first().click();
      const form = page.getByRole("dialog");
      await form.getByLabel("Name").fill("Big panel");
      await form.getByLabel("Playlist address (M3U)").fill(bigPlaylist());
      await form.getByLabel("Guide address (XMLTV)").fill(bigGuide());
      await form.getByRole("button", { name: "Add source" }).click();

      // Read at once; too big to become channels by itself, so the picker opens.
      await expect(page).toHaveURL(/dlg=streams/u, { timeout: 60_000 });
      const picker = page.getByRole("dialog", { name: "Choose channels" });
      await expect(picker.getByText(/^Big panel · 4,\d{3} streams in 28 groups$/u)).toBeVisible();
      await expectOverlaysFit(page);

      // An English reader: the UK groups start ticked, the German ones do not.
      const box = (name: string) => picker.getByRole("checkbox", { name, exact: true });
      await expect(box("UK | Entertainment")).toBeChecked();
      await expect(box("DE | Vollprogramm")).not.toBeChecked();
      await expect(box("DE | Sport")).not.toBeChecked();
      await expect(picker.getByText(/^[\d,]+ of 4,\d{3} selected$/u)).toBeVisible();

      // A group of hundreds opens, and only the rows near the view are drawn.
      await picker.getByRole("button", { name: "Show the streams of UK | Entertainment" }).click();
      await expect(picker.getByText("BBC One HD", { exact: true })).toBeVisible();
      expect(await picker.locator("[data-index]").count()).toBeLessThan(120);

      await picker.getByRole("button", { name: "Select none" }).click();
      await expect(picker.getByText(/^0 of 4,\d{3} selected$/u)).toBeVisible();

      // A search shows only groups with matches, already open.
      await picker.getByRole("searchbox").fill("eurosport");
      await expect(picker.getByText("Eurosport 1 HD", { exact: true })).toBeVisible();
      await expect(picker.getByText("BBC One HD", { exact: true })).toHaveCount(0);
      await expect(box("UK | Entertainment")).toHaveCount(0);
      await picker.getByRole("button", { name: "Select all" }).click();

      // Eurosport 1 and 2 in HD, SD (and FHD) are two channels.
      const add = picker.getByRole("button", { name: "Add 2 channels" });
      await expect(add).toBeEnabled();
      await add.click();
      await expect(page).not.toHaveURL(/dlg=/u);
      await expect(page.getByText("2 channels added")).toBeVisible();

      const added = (await api(page).get<Named[]>("/api/channels")).filter(
        (channel) => !before.has(channel.id),
      );
      expect(added.map((channel) => channel.name).toSorted()).toEqual([
        expect.stringMatching(/^Eurosport 1 F?HD$/u),
        expect.stringMatching(/^Eurosport 2 F?HD$/u),
      ]);
    } finally {
      await cleanUp(page, before, "Big panel");
    }
  });
});

test.describe("stream picker on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test("opens from the source's card, fits the screen and never scrolls sideways", async ({
    page,
  }) => {
    await signIn(page);
    const before = await channelIds(page);
    try {
      const created = await api(page).post<Named>(
        "/api/sources",
        Schema.encodeSync(SourceInput)({
          name: "Big panel (phone)",
          config: { _tag: "M3u", playlistUrl: bigPlaylist(), guideUrl: bigGuide() },
          refreshIntervalMinutes: 360,
          headers: {},
          guideCleanup: { removeDuplicates: true, rewrites: [] },
          enabled: true,
        }),
      );
      await api(page).post(`/api/sources/${created.id}/refresh`);
      await page.goto("/settings/sources");
      const card = page.getByRole("article", { name: "Big panel (phone)" });
      await card.getByRole("button", { name: "Choose channels" }).click();
      await expect(page).toHaveURL(/dlg=streams/u);
      const picker = page.getByRole("dialog", { name: "Choose channels" });
      await expect(picker.getByText(/^[\d,]+ of 4,\d{3} selected$/u)).toBeVisible();
      await expectOverlaysFit(page);
      await expectNoHorizontalOverflow(page);
      await page.goBack();
      await expect(page).not.toHaveURL(/dlg=/u);
    } finally {
      await cleanUp(page, before, "Big panel (phone)");
    }
  });
});
