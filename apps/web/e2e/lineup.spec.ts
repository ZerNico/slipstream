import { expect, type Page, test } from "@playwright/test";
import { csrfCookie, csrfHeader } from "@slipstream/api";
import { F1_CHANNEL } from "../../../scripts/dev-seed.ts";
import { expectNoHorizontalOverflow } from "./support/layout.ts";
import { api, requireServer, seed, settle } from "./support/session.ts";

/*
 * The channel lineup against a real server (`pnpm e2e`): typing a number, bulk hide, guide
 * mapping and stream order. Each test puts the lineup back for the journeys after it.
 */

requireServer({ source: true });

interface LineupChannel {
  readonly id: string;
  readonly name: string;
  readonly number?: number;
  readonly guideChannelId?: string;
  readonly hidden: boolean;
}

const lineup = (page: Page) => api(page).get<LineupChannel[]>("/api/channels?includeHidden=true");

/** Channels the other journeys do not record from, numbered. */
const spare = async (page: Page) =>
  (await lineup(page)).filter(
    (channel) => channel.name !== F1_CHANNEL && channel.number !== undefined,
  );

const put = async (page: Page, path: string, data: unknown) => {
  const cookies = await page.context().cookies();
  const csrf = cookies.find((cookie) => cookie.name === csrfCookie)?.value ?? "";
  const response = await page.request.put(path, { headers: { [csrfHeader]: csrf }, data });
  expect(response.ok(), `${path} answered ${response.status()}`).toBe(true);
  return (await response.json()) as unknown;
};

const openLineup = async (page: Page) => {
  await page.goto("/settings/sources");
  await settle(page);
  await page.getByRole("button", { name: /^Channels/u }).click();
  await expect(page.getByRole("list", { name: "Channels" })).toBeVisible();
};

test.describe("the channel lineup at 1440 × 900", () => {
  test.use({ viewport: { width: 1440, height: 900 } });
  test.beforeEach(async ({ page }) => {
    await seed(page);
  });

  test("typing a number says who makes room and saves it", async ({ page }) => {
    const [first, second] = await spare(page);
    if (first?.number === undefined || second?.number === undefined) throw new Error("numbers");
    await openLineup(page);
    await expectNoHorizontalOverflow(page);
    const field = page.getByLabel(`Number of ${second.name}`, { exact: true });
    await field.click();
    await field.fill(String(first.number));
    await expect(page.getByRole("status").filter({ hasText: "Move to" })).toContainText(
      `Move to ${first.number} · ${first.name} moves to`,
    );
    await field.press("Escape");

    // A free number: nothing else moves.
    const free = 900;
    await field.click();
    await field.fill(String(free));
    await expect(page.getByRole("status").filter({ hasText: "Move to" })).toContainText(
      `Move to ${free} · Nothing else changes`,
    );
    await field.press("Enter");
    await expect
      .poll(async () => (await lineup(page)).find((c) => c.id === second.id)?.number)
      .toBe(free);
    expect((await lineup(page)).find((c) => c.id === first.id)?.number).toBe(first.number);
    await put(page, `/api/channels/${second.id}/number`, { number: second.number });
  });

  test("the bulk bar hides several channels at once", async ({ page }) => {
    const [first, second] = (await spare(page)).filter((channel) => !channel.hidden);
    if (first === undefined || second === undefined) throw new Error("two visible channels");
    await openLineup(page);
    await page.getByLabel(`Select ${first.name}`, { exact: true }).click();
    await page.getByLabel(`Select ${second.name}`, { exact: true }).click();
    const bar = page.getByRole("toolbar", { name: "2 selected" });
    await expect(bar).toBeVisible();
    await bar.getByRole("button", { name: "Hide", exact: true }).click();
    await expect
      .poll(async () =>
        (await lineup(page))
          .filter((c) => c.id === first.id || c.id === second.id)
          .map((c) => c.hidden),
      )
      .toEqual([true, true]);
    for (const channel of [first, second]) {
      await api(page).patch(`/api/channels/${channel.id}`, { hidden: false });
    }
  });

  test("a channel's guide is changed in the picker", async ({ page }) => {
    const channels = await spare(page);
    const target = channels.find((channel) => channel.guideChannelId !== undefined);
    const other = channels.find(
      (channel) =>
        channel.guideChannelId !== undefined && channel.guideChannelId !== target?.guideChannelId,
    );
    if (target?.guideChannelId === undefined || other?.guideChannelId === undefined) {
      throw new Error("two channels with a guide");
    }
    await openLineup(page);
    await page.locator(`[data-channel="${target.id}"]`).click();
    await page.getByRole("button", { name: "Change", exact: true }).click();
    const picker = page.getByRole("dialog", { name: "Choose the guide" });
    await picker.getByRole("searchbox").fill(other.guideChannelId);
    await picker
      .getByRole("button", { name: new RegExp(other.guideChannelId, "u") })
      .first()
      .click();
    await expect(picker).toBeHidden();
    await expect
      .poll(async () => (await lineup(page)).find((c) => c.id === target.id)?.guideChannelId)
      .toBe(other.guideChannelId);
    await api(page).patch(`/api/channels/${target.id}`, { guideChannelId: target.guideChannelId });
  });

  test("a channel's streams are reordered by dragging", async ({ page }) => {
    const [target, donor] = await spare(page);
    if (target === undefined || donor === undefined) throw new Error("two channels");
    const own = await api(page).get<{ sourceStreamId: string }[]>(
      `/api/channels/${target.id}/streams`,
    );
    const extra = await api(page).get<{ sourceStreamId: string }[]>(
      `/api/channels/${donor.id}/streams`,
    );
    const [mine] = own;
    const [theirs] = extra;
    if (mine === undefined || theirs === undefined) throw new Error("streams");
    // A second stream as a fallback, so there is an order to change.
    await put(page, `/api/channels/${target.id}/streams`, [
      { sourceStreamId: mine.sourceStreamId, priority: 0 },
      { sourceStreamId: theirs.sourceStreamId, priority: 1 },
    ]);
    await openLineup(page);
    await page.locator(`[data-channel="${target.id}"]`).click();
    const streams = page.getByRole("list", { name: "Streams" });
    await expect(streams.getByRole("listitem")).toHaveCount(2);
    const handles = streams.getByRole("button", { name: /^Move /u });
    const from = await handles.nth(1).boundingBox();
    const to = await handles.nth(0).boundingBox();
    if (from === null || to === null) throw new Error("handles");
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2 - 4, { steps: 12 });
    await page.mouse.move(to.x + to.width / 2, to.y + 2, { steps: 4 });
    await page.mouse.up();
    await expect
      .poll(async () =>
        (
          await api(page).get<{ sourceStreamId: string }[]>(`/api/channels/${target.id}/streams`)
        ).map((link) => link.sourceStreamId),
      )
      .toEqual([theirs.sourceStreamId, mine.sourceStreamId]);
    await put(page, `/api/channels/${target.id}/streams`, [
      { sourceStreamId: mine.sourceStreamId, priority: 0 },
    ]);
  });
});
