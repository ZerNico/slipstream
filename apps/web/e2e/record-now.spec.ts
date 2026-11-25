import { expect, test, type Page } from "@playwright/test";
import { api, requireServer, seed } from "./support/session.ts";

/*
 * Record in the player against a real server and the fake source (`pnpm e2e`): watching a
 * channel live, R records the programme on air, and the recording keeps what the channel's
 * capture held from before the press, not only from the press on.
 */

requireServer({ source: true });

interface NowNext {
  readonly channelId: string;
  readonly now?: { readonly id: string; readonly title: string; readonly end: string };
}

interface Entry {
  readonly id: string;
  readonly title: string;
  readonly channelId: string;
  readonly programmeId?: string;
  readonly state: string;
  readonly start: string;
}

/** A visible channel nothing records whose programme on air lasts a few minutes more. */
const channelToRecord = async (page: Page) => {
  const { channels } = await seed(page);
  const recordings = await api(page).get<Entry[]>("/api/recordings");
  const busy = new Set(
    recordings
      .filter((entry) => entry.state === "recording" || entry.state === "scheduled")
      .map((entry) => entry.channelId),
  );
  const onAir = await api(page).get<NowNext[]>("/api/guide/now-next");
  for (const channel of channels) {
    if (("hidden" in channel && channel.hidden) || busy.has(channel.id)) continue;
    const now = onAir.find((entry) => entry.channelId === channel.id)?.now;
    if (now !== undefined && Date.parse(now.end) > Date.now() + 4 * 60_000) {
      return { channelId: channel.id, programme: now };
    }
  }
  throw new Error("the fake source has no free channel with a programme on air for 4 more minutes");
};

/** The first moment the recording's playlist holds, from its PROGRAM-DATE-TIME. */
const playlistStart = async (page: Page, recordingId: string): Promise<number> => {
  const session = await api(page).post<{ readonly playlistUrl: string }>("/api/playback/sessions", {
    source: { _tag: "Recording", recordingId },
    capabilities: {
      video: [],
      audio: ["aac"],
      audioPassthrough: [],
      hdr: false,
      canDeinterlace: true,
    },
    quality: { _tag: "Auto" },
  });
  const body = await (await page.request.get(session.playlistUrl)).text();
  const stamp = /#EXT-X-PROGRAM-DATE-TIME:(\S+)/u.exec(body)?.[1];
  expect(stamp, "the recording's playlist has a clock").toBeDefined();
  return Date.parse(stamp ?? "");
};

test.describe("Record while watching live", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("R records the programme on air, from before the press", async ({ page }) => {
    const { channelId, programme } = await channelToRecord(page);
    await page.goto(`/watch/live/${channelId}`);
    await expect(
      page.locator("[data-player] [data-readout]:not([data-loading])").first(),
    ).toBeVisible({ timeout: 30_000 });
    // Watching is what captures the channel: give the pause buffer some seconds of it.
    await page.waitForTimeout(20_000);
    const record = page.getByRole("button", { name: "Record", exact: true });
    await expect(record).toBeVisible();

    const pressedAt = Date.now();
    await page.keyboard.press("r");
    // The toast names the programme and where the recording starts.
    await expect(page.getByText(`Recording ${programme.title}`)).toBeVisible();
    // The channel is being recorded now: the player plays the recording.
    await expect(page).toHaveURL(/\/watch\/rec\//u, { timeout: 15_000 });
    await expect(page.getByRole("button", { name: "Recording", exact: true })).toBeVisible();

    const entry = (await api(page).get<Entry[]>("/api/recordings")).find(
      (candidate) => candidate.programmeId === programme.id && candidate.state === "recording",
    );
    expect(entry, "a running recording of the programme").toBeDefined();
    if (entry === undefined) return;
    expect(Date.parse(entry.start)).toBeLessThan(pressedAt);
    // What the capture held before the press is part of the recording.
    expect(await playlistStart(page, entry.id)).toBeLessThan(pressedAt - 10_000);

    await page.goto("/recordings");
    await expect(page.locator("main").getByText(programme.title).first()).toBeVisible();

    // Leave the channel free for the other journeys.
    await api(page).delete(`/api/recordings/${entry.id}`);
  });
});
