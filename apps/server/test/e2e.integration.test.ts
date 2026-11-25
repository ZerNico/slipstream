/**
 * End to end with real ffmpeg: the fake source on an ephemeral port, the whole server with a
 * temp data directory, the recorder capturing for real. A manual recording is captured,
 * played back through its signed playlist and segment URLs, probed with ffprobe, stopped and
 * settled; a live session acquires a capture and releases it. No ffmpeg is left afterwards.
 */
import { execFile, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { startFakeSource } from "@slipstream/fake-source";
import { describe, expect, it } from "vitest";
import { Browser, startTestServer } from "./harness.ts";

const run = promisify(execFile);
/** ffmpeg and ffprobe are system tools (AGENTS.md), not package dependencies. */
const available = (binary: string) => spawnSync(binary, ["-version"]).status === 0;
const ffprobe = "ffprobe";
const hasFfmpeg = available("ffmpeg") && available(ffprobe);

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

interface Entry {
  readonly id: string;
  readonly state: string;
  readonly sizeBytes: number;
  readonly problems: ReadonlyArray<unknown>;
}

describe.skipIf(!hasFfmpeg)("recording and live with real ffmpeg", () => {
  it(
    "records a manual range, plays it through signed URLs, settles it, and serves live",
    { timeout: 120_000 },
    async () => {
      const fake = await startFakeSource();
      const server = await startTestServer({ recorder: { keepRunningMs: 1000 } });
      const scratch = mkdtempSync(join(tmpdir(), "slipstream-e2e-"));
      try {
        const admin = new Browser(server.url);
        const setup = await admin.request("POST", "/api/auth/setup", {
          username: "admin",
          displayName: "Admin",
          password: "correct horse battery staple",
        });
        expect(setup.status).toBe(200);

        const source = await admin.request("POST", "/api/sources", {
          name: "Fake",
          config: {
            _tag: "M3u",
            playlistUrl: `${fake.url}/playlist.m3u`,
            guideUrl: `${fake.url}/epg.xml`,
          },
          refreshIntervalMinutes: 60,
          headers: {},
          guideCleanup: { removeDuplicates: true, rewrites: [] },
          enabled: true,
        });
        expect(source.status).toBe(200);
        const sourceId = (source.json as { id: string }).id;
        expect((await admin.request("POST", `/api/sources/${sourceId}/refresh`)).status).toBe(200);
        const channels = (await admin.request("GET", "/api/channels")).json as Array<{
          id: string;
          name: string;
        }>;
        const [recorded, watched] = channels;
        expect(recorded).toBeDefined();
        expect(watched).toBeDefined();

        // A one-off recording from now for 20 seconds.
        const now = Date.now();
        const created = await admin.request("POST", "/api/recordings", {
          _tag: "Manual",
          channelId: recorded!.id,
          range: {
            start: new Date(now).toISOString(),
            end: new Date(now + 20_000).toISOString(),
          },
          title: "Twenty seconds",
        });
        expect(created.status).toBe(200);
        const recording = created.json as Entry;
        expect(recording.state).toBe("recording");

        await expect
          .poll(
            async () =>
              ((await admin.request("GET", `/api/recordings/${recording.id}`)).json as Entry)
                .sizeBytes,
            { timeout: 30_000, interval: 500 },
          )
          .toBeGreaterThan(0);

        const session = await admin.request("POST", "/api/playback/sessions", {
          source: { _tag: "Recording", recordingId: recording.id },
          capabilities,
          quality: { _tag: "Auto" },
        });
        expect(session.status).toBe(200);
        const { playlistUrl } = session.json as { playlistUrl: string };
        const playlistLocation = new URL(playlistUrl, server.url);
        const playlist = await (await fetch(playlistLocation)).text();
        expect(playlist).toContain("#EXT-X-PLAYLIST-TYPE:EVENT");
        const segmentUri = playlist.split("\n").find((line) => line.startsWith("../seg/"));
        expect(segmentUri).toBeDefined();
        const segment = await fetch(new URL(segmentUri!, playlistLocation));
        expect(segment.status).toBe(200);
        expect(segment.headers.get("content-type")).toBe("video/mp2t");
        const file = join(scratch, "segment.ts");
        writeFileSync(file, Buffer.from(await segment.arrayBuffer()));
        const probed = JSON.parse(
          (await run(ffprobe, ["-v", "error", "-show_streams", "-of", "json", file])).stdout,
        ) as { streams: Array<{ codec_type: string; codec_name: string }> };
        expect(probed.streams.map((stream) => stream.codec_type)).toContain("video");

        // The segment index knows the capture, and its state is the API's "running".
        const capturesResponse = await admin.request("GET", "/api/captures?active=true");
        expect(capturesResponse.status).toBe(200);
        const captures = capturesResponse.json as Array<{
          channelId: string;
          state: string;
          stats: { segments: number };
        }>;
        expect(captures).toContainEqual(
          expect.objectContaining({ channelId: recorded!.id, state: "running" }),
        );

        const stop = await admin.request("POST", `/api/recordings/${recording.id}/stop`);
        expect(stop.status).toBe(200);
        await expect
          .poll(
            async () =>
              ((await admin.request("GET", `/api/recordings/${recording.id}`)).json as Entry).state,
            { timeout: 30_000, interval: 500 },
          )
          .toBe("completed");
        const settled = await (await fetch(playlistLocation)).text();
        expect(settled).toContain("#EXT-X-PLAYLIST-TYPE:VOD");
        expect(settled).toContain("#EXT-X-ENDLIST");

        // Live: acquiring starts a capture, the sliding playlist fills, releasing lets go.
        const live = await admin.request("POST", "/api/playback/sessions", {
          source: { _tag: "Live", channelId: watched!.id },
          capabilities,
          quality: { _tag: "Auto" },
        });
        expect(live.status).toBe(200);
        const liveSession = live.json as { id: string; playlistUrl: string };
        const liveLocation = new URL(liveSession.playlistUrl, server.url);
        await expect
          .poll(async () => (await fetch(liveLocation)).status, { timeout: 30_000, interval: 500 })
          .toBe(200);
        const livePlaylist = await (await fetch(liveLocation)).text();
        expect(livePlaylist).not.toContain("#EXT-X-ENDLIST");
        expect(livePlaylist).toContain("../seg/");
        const updated = await admin.request("PATCH", `/api/playback/sessions/${liveSession.id}`, {
          playbackRate: 1.5,
        });
        expect(updated.json).toMatchObject({ id: liveSession.id });
        expect((updated.json as { plan?: { decision: string } }).plan?.decision ?? "direct").toBe(
          "direct",
        );
        expect(
          (await admin.request("DELETE", `/api/playback/sessions/${liveSession.id}`)).status,
        ).toBe(204);
        await expect
          .poll(
            async () =>
              ((await admin.request("GET", "/api/captures?active=true")).json as Array<unknown>)
                .length,
            { timeout: 20_000, interval: 500 },
          )
          .toBe(0);
      } finally {
        await server.close();
        await fake.close();
        rmSync(scratch, { recursive: true, force: true });
      }
      expect(await ffmpegChildren()).toEqual([]);
    },
  );
});
