/**
 * Playback conversion with real ffmpeg: the fake source's AC-3 channel (Filmhaus HD), which a
 * browser cannot play. A browser's live session gets a playlist of its variant whose segments
 * carry AAC and the original H.264, copied packet for packet; the audio timestamps run on
 * without a gap or an overlap across segments; a device that decodes AC-3 gets the original;
 * a range session converts too. No ffmpeg is left afterwards.
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
const available = (binary: string) => spawnSync(binary, ["-version"]).status === 0;
const hasFfmpeg = available("ffmpeg") && available("ffprobe");

const ffmpegChildren = async () => {
  const { stdout } = await run("ps", ["-A", "-o", "pid=,ppid=,comm="]);
  return stdout
    .split("\n")
    .map((line) => line.trim().split(/\s+/))
    .filter(([, ppid, command]) => Number(ppid) === process.pid && command?.endsWith("ffmpeg"))
    .map(([pid]) => Number(pid));
};

/** What Chrome reports: H.264 and AAC, no AC-3. */
const chrome = {
  video: [
    { codec: "h264", profiles: ["high", "main", "baseline"], maxWidth: 1920, maxHeight: 1080 },
  ],
  audio: ["aac", "mp3", "opus"],
  audioPassthrough: [],
  hdr: false,
  canDeinterlace: false,
};

/** A TV that decodes AC-3 itself. */
const tv = { ...chrome, audio: ["aac", "ac3", "eac3"], canDeinterlace: true };

interface Probed {
  readonly streams: ReadonlyArray<{
    readonly codec_type: string;
    readonly codec_name: string;
    readonly sample_rate?: string;
    readonly channels?: number;
    readonly height?: number;
  }>;
  readonly packets: ReadonlyArray<{
    readonly codec_type: string;
    readonly pts: number;
    readonly duration?: number;
  }>;
}

const probe = async (file: string): Promise<Probed> =>
  JSON.parse(
    (
      await run(
        "ffprobe",
        [
          "-v",
          "error",
          "-show_entries",
          "stream=codec_type,codec_name,sample_rate,channels,height:packet=codec_type,pts,duration",
          "-of",
          "json",
          file,
        ],
        { maxBuffer: 64 * 1024 * 1024 },
      )
    ).stdout,
  ) as Probed;

const segmentLines = (playlist: string) =>
  playlist.split("\n").filter((line) => line.includes("seg/"));

/** The playlist once it lists `count` segments. */
const playlistWith = async (url: URL, count: number) => {
  let text = "";
  await expect
    .poll(
      async () => {
        text = await (await fetch(url)).text();
        return segmentLines(text).length;
      },
      { timeout: 60_000, interval: 1000 },
    )
    .toBeGreaterThanOrEqual(count);
  return text;
};

/** A server with the fake source's channels, signed in as its admin. */
const setUp = async () => {
  const fake = await startFakeSource();
  const server = await startTestServer();
  const scratch = mkdtempSync(join(tmpdir(), "slipstream-transcode-"));
  const admin = new Browser(server.url);
  await admin.request("POST", "/api/auth/setup", {
    username: "admin",
    displayName: "Admin",
    password: "correct horse battery staple",
  });
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
  await admin.request("POST", `/api/sources/${(source.json as { id: string }).id}/refresh`);
  const channels = (await admin.request("GET", "/api/channels")).json as Array<{
    id: string;
    name: string;
  }>;
  const channel = (name: string) => {
    const found = channels.find((candidate) => candidate.name === name);
    if (found === undefined) throw new Error(`no channel ${name}`);
    return found.id;
  };
  const fetchTo = async (url: URL, name: string) => {
    const response = await fetch(url);
    expect(response.status).toBe(200);
    const file = join(scratch, name);
    writeFileSync(file, Buffer.from(await response.arrayBuffer()));
    return file;
  };
  const close = async () => {
    await server.close();
    await fake.close();
    rmSync(scratch, { recursive: true, force: true });
  };
  return { server, admin, channel, fetchTo, close };
};

describe.skipIf(!hasFfmpeg)("playback conversion with real ffmpeg", () => {
  it(
    "converts the picture: deinterlaced for a browser, smaller for a low quality, with the audio copied",
    { timeout: 150_000 },
    async () => {
      const { server, admin, channel, fetchTo, close } = await setUp();
      try {
        // 576i for a browser that cannot deinterlace: one frame per field, 50 per second.
        const doku = await admin.request("POST", "/api/playback/sessions", {
          source: { _tag: "Live", channelId: channel("Doku Plus SD") },
          capabilities: chrome,
          quality: { _tag: "Original" },
        });
        const dokuSession = doku.json as { id: string; playlistUrl: string; plan?: unknown };
        expect(dokuSession.plan).toMatchObject({
          decision: "video",
          reasons: ["interlaced"],
          video: { _tag: "Encode", encoder: "software", deinterlace: "field", height: 576 },
          audio: { _tag: "Copy" },
        });
        const dokuUrl = new URL(dokuSession.playlistUrl, server.url);
        const dokuLink = segmentLines(await playlistWith(dokuUrl, 2))[1]!;
        const deinterlaced = await probe(await fetchTo(new URL(dokuLink, dokuUrl), "doku.ts"));
        expect(deinterlaced.streams.find((s) => s.codec_type === "video")?.codec_name).toBe("h264");
        expect(deinterlaced.streams.find((s) => s.codec_type === "audio")?.codec_name).toBe("aac");
        const frames = deinterlaced.packets.filter((p) => p.codec_type === "video").length;
        // Two-second segments: about 100 frames at 50 per second, not 50.
        expect(frames).toBeGreaterThan(80);
        // A 4-core machine (CI) gets one software conversion: end this one before the next.
        await admin.request("DELETE", `/api/playback/sessions/${dokuSession.id}`);

        // 1080p50 at 8 Mbit/s asked for at 2 Mbit/s: 540p H.264, the AAC copied.
        const f1 = await admin.request("POST", "/api/playback/sessions", {
          source: { _tag: "Live", channelId: channel("Sportkanal F1 HD") },
          capabilities: chrome,
          quality: { _tag: "Bitrate", kbps: 2000 },
        });
        const f1Session = f1.json as { id: string; playlistUrl: string; plan?: unknown };
        expect(f1Session.plan).toMatchObject({
          decision: "video",
          reasons: ["requestedQuality"],
          video: { _tag: "Encode", width: 960, height: 540 },
        });
        const f1Url = new URL(f1Session.playlistUrl, server.url);
        const f1Link = segmentLines(await playlistWith(f1Url, 2))[1]!;
        const small = await probe(await fetchTo(new URL(f1Link, f1Url), "f1.ts"));
        expect(small.streams.find((s) => s.codec_type === "video")).toMatchObject({
          codec_name: "h264",
          height: 540,
        });
        await admin.request("DELETE", `/api/playback/sessions/${f1Session.id}`);
      } finally {
        await close();
      }
      expect(await ffmpegChildren()).toEqual([]);
    },
  );

  it(
    "converts AC-3 to AAC for a browser, copies the picture, and keeps the audio timestamps continuous",
    { timeout: 150_000 },
    async () => {
      const { server, admin, channel, fetchTo, close } = await setUp();
      try {
        const filmhaus = { id: channel("Filmhaus HD") };

        // The browser's session waits for the first segment, then converts the audio only.
        const created = await admin.request("POST", "/api/playback/sessions", {
          source: { _tag: "Live", channelId: filmhaus.id },
          capabilities: chrome,
          quality: { _tag: "Auto" },
        });
        expect(created.status).toBe(200);
        const session = created.json as {
          id: string;
          playlistUrl: string;
          plan?: { decision: string; reasons: string[]; audio: { _tag: string } };
        };
        expect(session.plan).toMatchObject({
          decision: "audio",
          reasons: ["audioCodecUnsupported"],
          video: { _tag: "Copy" },
          audio: { _tag: "Encode", codec: "aac", channels: 2, bitrateKbps: 192 },
        });
        expect(session.playlistUrl).toContain(`/hls/live/${filmhaus.id}/copy_aac-0-2-192.m3u8?`);

        // Wait for five segments (two seconds each in tests), then take three in a row.
        const liveUrl = new URL(session.playlistUrl, server.url);
        const playlist = await playlistWith(liveUrl, 5);
        const links = segmentLines(playlist).slice(1, 4);
        expect(links[0]?.startsWith("../../seg/")).toBe(true);
        const converted = await Promise.all(
          links.map((link, index) => fetchTo(new URL(link, liveUrl), `converted-${index}.ts`)),
        );
        const probes = await Promise.all(converted.map(probe));
        for (const probed of probes) {
          const audio = probed.streams.find((stream) => stream.codec_type === "audio");
          expect(probed.streams.find((stream) => stream.codec_type === "video")?.codec_name).toBe(
            "h264",
          );
          expect(audio).toMatchObject({ codec_name: "aac", sample_rate: "48000", channels: 2 });
        }

        // Audio PTS continuity: every AAC frame starts where the one before it ended, across
        // the segment boundaries too.
        const audioPackets = probes.flatMap((probed) =>
          probed.packets.filter((packet) => packet.codec_type === "audio"),
        );
        expect(audioPackets.length).toBeGreaterThan(200);
        const gaps = audioPackets.slice(1).flatMap((packet, index) => {
          const before = audioPackets[index]!;
          const expected = before.pts + (before.duration ?? 1920);
          return packet.pts === expected ? [] : [{ at: index + 1, by: packet.pts - expected }];
        });
        expect(gaps).toEqual([]);

        // A TV that decodes AC-3 gets the original; the converted picture is the same H.264,
        // packet for packet.
        const direct = await admin.request("POST", "/api/playback/sessions", {
          source: { _tag: "Live", channelId: filmhaus.id },
          capabilities: tv,
          quality: { _tag: "Auto" },
        });
        const directSession = direct.json as { id: string; playlistUrl: string; plan?: unknown };
        expect(directSession.plan).toMatchObject({ decision: "direct" });
        expect(directSession.playlistUrl).toContain(`/hls/live/${filmhaus.id}.m3u8?`);
        const directUrl = new URL(directSession.playlistUrl, server.url);
        const directPlaylist = await (await fetch(directUrl)).text();
        const sameSegment = segmentLines(directPlaylist).find((line) =>
          line.startsWith(`../${links[1]!.slice("../../".length).split("?")[0]}`),
        );
        expect(sameSegment).toBeDefined();
        const original = await probe(await fetchTo(new URL(sameSegment!, directUrl), "orig.ts"));
        const videoPts = (probed: Probed) =>
          probed.packets.filter((packet) => packet.codec_type === "video").map((p) => p.pts);
        expect(videoPts(probes[1]!)).toEqual(videoPts(original));
        expect(original.streams.find((stream) => stream.codec_type === "audio")?.codec_name).toBe(
          "ac3",
        );

        // Watching from the start (a range) converts the same way.
        const pdt = playlist
          .split("\n")
          .filter((line) => line.startsWith("#EXT-X-PROGRAM-DATE-TIME:"))
          .map((line) => Date.parse(line.slice("#EXT-X-PROGRAM-DATE-TIME:".length)));
        const range = await admin.request("POST", "/api/playback/sessions", {
          source: {
            _tag: "Range",
            channelId: filmhaus.id,
            range: {
              start: new Date(pdt[0]!).toISOString(),
              end: new Date(pdt[3]!).toISOString(),
            },
          },
          capabilities: chrome,
          quality: { _tag: "Auto" },
        });
        expect(range.status).toBe(200);
        const rangeSession = range.json as { id: string; playlistUrl: string };
        expect(rangeSession.playlistUrl).toContain(
          `/hls/range/${filmhaus.id}/copy_aac-0-2-192.m3u8?`,
        );
        const rangeUrl = new URL(rangeSession.playlistUrl, server.url);
        const rangeLink = segmentLines(await (await fetch(rangeUrl)).text())[0];
        expect(rangeLink).toBeDefined();
        const rangeProbe = await probe(await fetchTo(new URL(rangeLink!, rangeUrl), "range.ts"));
        expect(rangeProbe.streams.find((stream) => stream.codec_type === "audio")?.codec_name).toBe(
          "aac",
        );

        // A grant for the original does not open the converted playlist, nor the other way.
        const swapped = new URL(liveUrl);
        swapped.pathname = directUrl.pathname;
        expect((await fetch(swapped)).status).toBe(403);

        for (const id of [session.id, directSession.id, rangeSession.id]) {
          expect((await admin.request("DELETE", `/api/playback/sessions/${id}`)).status).toBe(204);
        }
      } finally {
        await close();
      }
      expect(await ffmpegChildren()).toEqual([]);
    },
  );

  it(
    "follows Simultaneous picture conversions: one refuses a second, no limit admits it",
    { timeout: 150_000 },
    async () => {
      const { admin, channel, close } = await setUp();
      try {
        const playback = (await admin.request("GET", "/api/settings/playback")).json as Record<
          string,
          unknown
        >;
        expect(playback.pictureConversions).toBe("unlimited");
        const limit = async (pictureConversions: string) =>
          expect(
            (
              await admin.request("PUT", "/api/settings/playback", {
                ...playback,
                pictureConversions,
              })
            ).status,
          ).toBe(200);
        const open = async (name: string) =>
          (
            await admin.request("POST", "/api/playback/sessions", {
              source: { _tag: "Live", channelId: channel(name) },
              capabilities: chrome,
              quality: { _tag: "Bitrate", kbps: 2000 },
            })
          ).json as { id: string; plan?: { decision: string; quality: string } };

        await limit("1");
        const first = await open("Sportkanal F1 HD");
        expect(first.plan).toMatchObject({ decision: "video" });
        // A second conversion is over the limit: this browser plays the original picture.
        const second = await open("Filmhaus HD");
        expect(second.plan).toMatchObject({ quality: "original" });
        expect(second.plan?.decision).not.toBe("video");

        // Read live: with no limit the same request converts, next to the first.
        await limit("unlimited");
        const third = await open("Filmhaus HD");
        expect(third.plan).toMatchObject({ decision: "video" });

        for (const session of [first, second, third]) {
          await admin.request("DELETE", `/api/playback/sessions/${session.id}`);
        }
      } finally {
        await close();
      }
      expect(await ffmpegChildren()).toEqual([]);
    },
  );
});
