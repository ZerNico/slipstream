import { expect, test } from "@playwright/test";
import { requireServer, seed } from "./support/session.ts";

/*
 * Playback conversion in a real browser (`pnpm e2e`): Filmhaus HD sends AC-3 sound, which
 * Chromium cannot decode, so its session keeps the picture and converts the sound to AAC. The
 * segments carry H.264 and AAC, Chromium decodes audio, and the stats say so.
 */

/** MPEG-TS stream types (ISO 13818-1, ATSC A/52) the checks name. */
const streamTypes: Readonly<Record<number, string>> = { 0x1b: "h264", 0x0f: "aac", 0x81: "ac3" };

/** The stream types a transport stream's first program map table lists. */
const programStreams = (bytes: Uint8Array): string[] => {
  const packets = Math.floor(bytes.length / 188);
  const payload = (offset: number) => {
    const adaptation = (bytes[offset + 3]! >> 4) & 0x3;
    const start = offset + 4 + (adaptation & 0x2 ? bytes[offset + 4]! + 1 : 0);
    // A section starts after its pointer field.
    return start + 1 + bytes[start]!;
  };
  const pid = (offset: number) => ((bytes[offset + 1]! & 0x1f) << 8) | bytes[offset + 2]!;
  let pmt: number | undefined;
  for (let index = 0; index < packets; index += 1) {
    const offset = index * 188;
    if (pid(offset) === 0 && pmt === undefined) {
      const section = payload(offset);
      pmt = ((bytes[section + 10]! & 0x1f) << 8) | bytes[section + 11]!;
    } else if (pmt !== undefined && pid(offset) === pmt) {
      const section = payload(offset);
      const length = ((bytes[section + 1]! & 0x0f) << 8) | bytes[section + 2]!;
      const end = section + 3 + length - 4;
      let entry = section + 12 + (((bytes[section + 10]! & 0x0f) << 8) | bytes[section + 11]!);
      const found: string[] = [];
      while (entry < end) {
        found.push(streamTypes[bytes[entry]!] ?? `0x${bytes[entry]!.toString(16)}`);
        entry += 5 + (((bytes[entry + 3]! & 0x0f) << 8) | bytes[entry + 4]!);
      }
      return found;
    }
  }
  return [];
};

requireServer({ source: true });

test.describe("converted sound", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("an AC-3 channel plays with AAC sound in Chromium", async ({ page }) => {
    const { channels } = await seed(page);
    const filmhaus = channels.find((channel) => channel.name === "Filmhaus HD");
    if (filmhaus === undefined) throw new Error("the fake source has no Filmhaus HD channel");
    // The playback stats overlay shows how the stream is delivered.
    await page.addInitScript(() => {
      localStorage.setItem("ss-player.stats", "true");
    });

    const created = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname === "/api/playback/sessions",
    );
    await page.goto(`/watch/live/${filmhaus.id}`);
    const session = (await (await created).json()) as {
      playlistUrl: string;
      plan?: { decision: string; reasons: string[]; audio: { _tag: string; codec?: string } };
    };
    expect(session.plan).toMatchObject({
      decision: "audio",
      reasons: ["audioCodecUnsupported"],
      audio: { _tag: "Encode", codec: "aac" },
    });
    expect(session.playlistUrl).toContain(`/hls/live/${filmhaus.id}/copy_aac-0-2-192.m3u8`);

    await expect(
      page.locator("[data-player] [data-readout]:not([data-loading])").first(),
    ).toBeVisible({ timeout: 30_000 });
    const stats = page.locator("[data-stats]");
    await expect(stats).toContainText("Sound converted");
    // The session's segments carry the picture as H.264 and the sound as AAC.
    const playlistUrl = new URL(session.playlistUrl, page.url());
    const playlist = await (await page.request.get(playlistUrl.href)).text();
    const links = playlist.split("\n").filter((line) => line.includes("seg/"));
    expect(links.length).toBeGreaterThan(0);
    for (const link of links.slice(-2)) {
      const segment = await page.request.get(new URL(link, playlistUrl).href);
      expect(segment.status()).toBe(200);
      expect(programStreams(new Uint8Array(await segment.body()))).toEqual(["h264", "aac"]);
    }
    // Chromium decodes the sound: its decoded audio byte count grows while it plays.
    await expect
      .poll(
        () =>
          page.evaluate(
            () =>
              document.querySelector<HTMLVideoElement & { webkitAudioDecodedByteCount?: number }>(
                "[data-player] video",
              )?.webkitAudioDecodedByteCount ?? 0,
          ),
        { timeout: 20_000 },
      )
      .toBeGreaterThan(0);
  });
});
