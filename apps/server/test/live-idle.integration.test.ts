/**
 * Live viewers and capture rows with real ffmpeg against the fake source:
 *
 * - a live session whose player stops fetching (closed tab, app in the background) is released
 *   after the idle timeout and its ffmpeg stops once the channel stopped lingering, while a session that keeps fetching and a
 *   recording on another channel keep theirs; a viewer that comes back holds a capture again;
 * - a capture the source refuses at once still gets its `captures` row (failed) and keeps
 *   ffmpeg's own log lines in `capture_logs`.
 */
import { execFile, spawnSync } from "node:child_process";
import { promisify } from "node:util";
import { startFakeSource } from "@slipstream/fake-source";
import { describe, expect, it } from "vitest";
import { Browser, startTestServer, type TestServer } from "./harness.ts";

const run = promisify(execFile);
const available = (binary: string) => spawnSync(binary, ["-version"]).status === 0;
const hasFfmpeg = available("ffmpeg") && available("ffprobe");

/** ffmpeg processes this test process started (the recorder's and the fake source's). */
const ffmpegChildren = async () => {
  const { stdout } = await run("ps", ["-A", "-o", "pid=,ppid=,comm="]);
  return stdout
    .split("\n")
    .map((line) => line.trim().split(/\s+/))
    .filter(([, ppid, command]) => Number(ppid) === process.pid && command?.endsWith("ffmpeg"))
    .map(([pid]) => Number(pid));
};

const capabilities = {
  video: [{ codec: "h264", profiles: [], maxWidth: 1920, maxHeight: 1080 }],
  audio: ["aac", "mp2"],
  audioPassthrough: [],
  hdr: false,
  canDeinterlace: true,
};

interface CaptureRow {
  readonly id: string;
  readonly channelId: string;
  readonly state: string;
  readonly error?: { readonly _tag: string };
}

/** Sets up an admin and a source at `playlistUrl`; returns the admin and the channel ids. */
const withSource = async (server: TestServer, fakeUrl: string) => {
  const admin = new Browser(server.url);
  await admin.request("POST", "/api/auth/setup", {
    username: "admin",
    displayName: "Admin",
    password: "correct horse battery staple",
  });
  const source = await admin.request("POST", "/api/sources", {
    name: "Fake",
    config: { _tag: "M3u", playlistUrl: `${fakeUrl}/playlist.m3u`, guideUrl: `${fakeUrl}/epg.xml` },
    refreshIntervalMinutes: 60,
    headers: {},
    guideCleanup: { removeDuplicates: true, rewrites: [] },
    enabled: true,
  });
  expect(source.status).toBe(200);
  const sourceId = (source.json as { id: string }).id;
  expect((await admin.request("POST", `/api/sources/${sourceId}/refresh`)).status).toBe(200);
  const channels = (await admin.request("GET", "/api/channels")).json as Array<{ id: string }>;
  return { admin, channelIds: channels.map((channel) => channel.id) };
};

const liveSession = async (admin: Browser, channelId: string) => {
  const created = await admin.request("POST", "/api/playback/sessions", {
    source: { _tag: "Live", channelId },
    capabilities,
    quality: { _tag: "Auto" },
  });
  expect(created.status).toBe(200);
  return created.json as { id: string; playlistUrl: string };
};

const captures = async (admin: Browser, active = false) =>
  (await admin.request("GET", `/api/captures${active ? "?active=true" : ""}`))
    .json as Array<CaptureRow>;

const activeOn = async (admin: Browser, channelId: string) =>
  (await captures(admin, true)).filter((row) => row.channelId === channelId).length;

describe.skipIf(!hasFfmpeg)("live viewers and capture rows with real ffmpeg", () => {
  it(
    "releases a live viewer that stops fetching, keeps one that fetches and the recordings",
    { timeout: 120_000 },
    async () => {
      const fake = await startFakeSource();
      const server = await startTestServer({
        recorder: { segmentSeconds: 2, endGraceMs: 3000, liveIdleMs: 4000, keepRunningMs: 3000 },
      });
      try {
        const { admin, channelIds } = await withSource(server, fake.url);
        const [gone, watching, recorded] = channelIds;
        expect(recorded).toBeDefined();

        // A recording for the whole test on a third channel.
        const now = Date.now();
        const recording = await admin.request("POST", "/api/recordings", {
          _tag: "Manual",
          channelId: recorded,
          range: {
            start: new Date(now).toISOString(),
            end: new Date(now + 300_000).toISOString(),
          },
          title: "Long race",
        });
        expect(recording.status).toBe(200);

        const goneSession = await liveSession(admin, gone!);
        const watchingSession = await liveSession(admin, watching!);
        const goneUrl = new URL(goneSession.playlistUrl, server.url);
        const watchingUrl = new URL(watchingSession.playlistUrl, server.url);
        expect(goneUrl.searchParams.get("session")).toBe(goneSession.id);

        // Both players start; their playlists and segment links carry the session.
        const first = await fetch(goneUrl);
        expect(first.status).toBe(200);
        const body = await first.text();
        const segment = body.split("\n").find((line) => line.startsWith("../seg/"));
        expect(segment).toContain(`session=${goneSession.id}`);
        expect((await fetch(new URL(segment!, goneUrl))).status).toBe(200);
        expect(await activeOn(admin, gone!)).toBe(1);

        // One player keeps refreshing its playlist like hls.js does; the other is gone.
        const closed = new AbortController();
        const keepWatching = (async () => {
          while (!closed.signal.aborted) {
            await fetch(watchingUrl).then((response) => response.text());
            await new Promise((resolve) => setTimeout(resolve, 1000));
          }
        })();
        try {
          await expect
            .poll(() => activeOn(admin, watching!), { timeout: 20_000, interval: 500 })
            .toBe(1);
          await expect
            .poll(() => activeOn(admin, gone!), { timeout: 20_000, interval: 500 })
            .toBe(0);
          expect(await activeOn(admin, watching!)).toBe(1);
          expect(await activeOn(admin, recorded!)).toBe(1);
          const stopped = (await captures(admin)).filter((row) => row.channelId === gone);
          expect(stopped.length).toBeGreaterThan(0);
          expect(stopped.every((row) => row.state === "stopped")).toBe(true);

          // The viewer comes back (app in the foreground again): it holds a capture again.
          expect((await fetch(goneUrl)).status).toBe(200);
          await expect
            .poll(() => activeOn(admin, gone!), { timeout: 20_000, interval: 500 })
            .toBe(1);
        } finally {
          closed.abort();
          await keepWatching;
        }

        // Saying goodbye still releases at once.
        expect(
          (await admin.request("DELETE", `/api/playback/sessions/${goneSession.id}`)).status,
        ).toBe(204);
        await expect.poll(() => activeOn(admin, gone!), { timeout: 20_000, interval: 500 }).toBe(0);
        // Without its refreshes, the watching session goes idle too; the recording stays.
        await expect
          .poll(() => activeOn(admin, watching!), { timeout: 20_000, interval: 500 })
          .toBe(0);
        expect(await activeOn(admin, recorded!)).toBe(1);
        const entry = (
          await admin.request("GET", `/api/recordings/${(recording.json as { id: string }).id}`)
        ).json as { state: string };
        expect(entry.state).toBe("recording");
      } finally {
        await server.close();
        await fake.close();
      }
      expect(await ffmpegChildren()).toEqual([]);
    },
  );

  it(
    "keeps a row and ffmpeg's log lines for a capture the source refuses at once",
    { timeout: 60_000 },
    async () => {
      const fake = await startFakeSource({ faults: { refuse: 403 } });
      const server = await startTestServer();
      try {
        const { admin, channelIds } = await withSource(server, fake.url);
        const [channelId] = channelIds;
        await liveSession(admin, channelId!);
        await expect
          .poll(
            async () =>
              (await captures(admin)).find(
                (row) => row.channelId === channelId && row.state === "failed",
              ),
            { timeout: 30_000, interval: 500 },
          )
          .toBeDefined();
        const refused = (await captures(admin)).find(
          (row) => row.channelId === channelId && row.state === "failed",
        );
        expect(refused?.error?._tag).toBe("SourceLimitReached");
        const log = (await admin.request("GET", `/api/captures/${refused!.id}/log`)).json as Array<{
          level: string;
          message: string;
        }>;
        // ffmpeg's own words about the refusal, next to the recorder's summary.
        expect(log.some((line) => line.message.includes("403"))).toBe(true);
        expect(log.some((line) => line.message.startsWith("source refused stream"))).toBe(true);
        expect(log.some((line) => line.message.startsWith("capture starting"))).toBe(true);
      } finally {
        await server.close();
        await fake.close();
      }
      expect(await ffmpegChildren()).toEqual([]);
    },
  );
});
