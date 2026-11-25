import { expect, type Page, test } from "@playwright/test";
import { csrfCookie, csrfHeader } from "@slipstream/api";
import { SourceInput } from "@slipstream/domain";
import { Schema } from "effect";
import { expectNoHorizontalOverflow, expectOverlaysFit } from "./support/layout.ts";
import { api, requireServer, seed, settle, sourceUrl } from "./support/session.ts";

/*
 * Needs review against a real server (`pnpm e2e`): one pair of copies is merged, another kept
 * apart, and the section goes. The copies play big line-up streams without a tvg-id, so only
 * names and guide ids match them. Everything made is removed again.
 */

const panelName = "Review panel";

requireServer({ source: true });

interface Named {
  readonly id: string;
  readonly name: string;
}

interface Review {
  readonly mergeSuggestions: ReadonlyArray<{ readonly channels: readonly Named[] }>;
  readonly sources: ReadonlyArray<{ readonly sourceId: string; readonly newStreams: number }>;
  readonly goneStreams: readonly unknown[];
  readonly withoutStreams: readonly Named[];
}

const put = async (page: Page, path: string, data: unknown) => {
  const cookies = await page.context().cookies();
  const csrf = cookies.find((cookie) => cookie.name === csrfCookie)?.value ?? "";
  const response = await page.request.put(path, { headers: { [csrfHeader]: csrf }, data });
  expect(response.ok(), `${path} answered ${response.status()}`).toBe(true);
};

/** A channel with one stream. */
const channelWith = async (
  page: Page,
  name: string,
  sourceStreamId: string,
  guideChannelId?: string,
) => {
  const created = await api(page).post<Named>("/api/channels", {
    name,
    favourite: false,
    hidden: false,
    ...(guideChannelId === undefined ? {} : { guideChannelId }),
  });
  await put(page, `/api/channels/${created.id}/streams`, [{ sourceStreamId, priority: 0 }]);
  return created;
};

/**
 * Leaves nothing else to review, so the section's going is this test's doing: suggestions the
 * seed may make are kept apart, new streams count as reviewed. Channels with no stream (which
 * the journeys never make) would keep the section; the test says so instead of hiding them.
 */
const clearReview = async (page: Page) => {
  const call = api(page);
  const review = await call.get<Review>("/api/channels/review");
  for (const suggestion of review.mergeSuggestions) {
    await call.post("/api/channels/apart", { ids: suggestion.channels.map((c) => c.id) });
  }
  for (const source of review.sources.filter((entry) => entry.newStreams > 0)) {
    await call.post(`/api/sources/${source.sourceId}/reviewed`);
  }
  expect(review.withoutStreams, "channels without a stream before the test").toEqual([]);
  expect(review.goneStreams, "gone streams before the test").toEqual([]);
};

test.describe("needs review at 1440 × 900", () => {
  test.use({ viewport: { width: 1440, height: 900 }, locale: "en-GB" });

  test("merges one pair of copies, keeps another apart, then goes", async ({ page }) => {
    await seed(page);
    const call = api(page);
    const made: Named[] = [];
    let panel: Named | undefined;
    try {
      panel = await call.post<Named>(
        "/api/sources",
        Schema.encodeSync(SourceInput)({
          name: panelName,
          config: {
            _tag: "M3u",
            playlistUrl: `${sourceUrl}/playlist.m3u?lineup=big`,
            guideUrl: `${sourceUrl}/epg.xml?lineup=big`,
          },
          refreshIntervalMinutes: 360,
          headers: {},
          guideCleanup: { removeDuplicates: true, rewrites: [] },
          enabled: true,
        }),
      );
      await call.post(`/api/sources/${panel.id}/refresh`);
      const page1 = await call.get<{ streams: Array<{ id: string; tvgId?: string }> }>(
        `/api/sources/${panel.id}/catalogue?limit=200`,
      );
      const [a, b, c, d] = page1.streams.filter((stream) => stream.tvgId === undefined);
      if (a === undefined || b === undefined || c === undefined || d === undefined) {
        throw new Error("four streams without a tvg-id");
      }
      await clearReview(page);
      made.push(
        await channelWith(page, "Review Kanal", a.id, "ReviewKanal.test"),
        await channelWith(page, "Review Kanal HD", b.id, "ReviewKanal.test"),
        await channelWith(page, "Sport Eins", c.id),
        await channelWith(page, "Sport Eins FHD", d.id),
      );

      await page.goto("/settings/sources");
      await settle(page);
      const section = page.getByRole("region", { name: "Needs review" });
      const card = section.getByRole("article", { name: /^2 channels in /u });
      await expect(card).toBeVisible();
      await expectNoHorizontalOverflow(page);

      await card.getByRole("button", { name: "Review" }).click();
      const dialog = page.getByRole("dialog", { name: "Same channel in several sources" });
      await expect(dialog.getByText("2 suggestions")).toBeVisible();
      await expectOverlaysFit(page);
      // The guide match and the name match, each in its group.
      await expect(dialog.getByRole("region", { name: "Same guide channel" })).toContainText(
        "Review Kanal",
      );
      await expect(dialog.getByRole("region", { name: "Similar name" })).toContainText(
        "Sport Eins",
      );

      await dialog.getByRole("button", { name: "Merge into Review Kanal" }).click();
      await expect(dialog.getByText("Merged", { exact: true })).toBeVisible();
      await dialog.getByRole("button", { name: "Sport Eins: not the same" }).click();
      await expect(dialog.getByText("Kept apart", { exact: true })).toBeVisible();

      const channels = await api(page).get<Named[]>("/api/channels?includeHidden=true");
      expect(channels.some((channel) => channel.name === "Review Kanal HD")).toBe(false);
      expect(channels.filter((channel) => channel.name.startsWith("Sport Eins"))).toHaveLength(2);

      await dialog.getByRole("button", { name: "Done" }).click();
      await expect(dialog).toBeHidden();
      // Its card goes. The section itself may stay: other journeys running at the same time can
      // add a source whose new streams wait for review.
      await expect(card).toHaveCount(0);
      await expect(page.getByRole("heading", { name: "Sources", exact: true })).toBeVisible();
    } finally {
      const live = new Set(
        (await api(page).get<Named[]>("/api/channels?includeHidden=true")).map(
          (channel) => channel.id,
        ),
      );
      for (const channel of made) {
        if (live.has(channel.id)) await call.delete(`/api/channels/${channel.id}`);
      }
      if (panel !== undefined) await call.delete(`/api/sources/${panel.id}`);
    }
  });
});
