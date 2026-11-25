/**
 * HLS through the real server: playback sessions hand out signed playlist URLs, playlists are
 * generated from a seeded segment index, segments are served with Range support, and tokens
 * only open what they were signed for: their playlist, their window of time, and only while the
 * sign-in that asked for them lasts. Live playlists span captures with a media sequence that only
 * grows. Also stopping a recording and resume positions, and (on a server whose clock can be
 * moved on) renewing a session past half its token life.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { Clock, Context, DateTime, Duration, Effect, Exit, Layer, References, Scope } from "effect";
import { HttpServer } from "effect/http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ServerConfig } from "../src/config.ts";
import { Db, type DbShape } from "../src/db/client.ts";
import { storeStreamInfo } from "../src/db/codec.ts";
import { captures, segments } from "../src/db/schema.ts";
import { HLS_TOKEN_MILLIS, LIVE_GRANT_TARGETS } from "../src/hls/service.ts";
import { makeServer } from "../src/server.ts";
import { Browser, startTestServer, type TestServer } from "./harness.ts";
import { testSettings } from "./support.ts";

let server: TestServer;
let admin: Browser;
let channelId: string;
let recordingId: string;
const segmentBytes = 1000;
const segmentCount = 5;
let seededFrom: number;

/**
 * What the seeded captures carry, stored as if probed: the segments are filler bytes, which
 * ffprobe would misread (or not read), and the sessions should play them as they are.
 */
const playableInfo = storeStreamInfo({
  container: "mpegts",
  audio: [{ codec: "aac", channels: 2 }],
  probedAt: DateTime.makeUnsafe(0),
});

const capabilities = {
  video: [],
  audio: ["aac"],
  audioPassthrough: [],
  hdr: false,
  canDeinterlace: true,
};

beforeAll(async () => {
  server = await startTestServer();
  admin = new Browser(server.url);
  await admin.request("POST", "/api/auth/setup", {
    username: "admin",
    displayName: "Admin",
    password: "correct horse battery staple",
  });
  const channel = await admin.request("POST", "/api/channels", {
    name: "Sport",
    favourite: false,
    hidden: false,
  });
  channelId = (channel.json as { id: string }).id;

  // A capture that has written five six-second segments up to now.
  const directory = join(server.root, "data", "capture-1");
  mkdirSync(directory, { recursive: true });
  seededFrom = Date.now() - segmentCount * 6000;
  const rows = Array.from({ length: segmentCount }, (_, sequence) => {
    const path = `seg-${sequence}.ts`;
    writeFileSync(join(directory, path), Buffer.alloc(segmentBytes, sequence));
    return {
      captureId: "capture-1",
      sequence,
      runId: "run-1",
      startMs: seededFrom + sequence * 6000,
      durationMs: 6000,
      bytes: segmentBytes,
      path,
    };
  });
  await server.run(
    Effect.gen(function* () {
      yield* server.db.write.insert(captures).values({
        id: "capture-1",
        channelId,
        sourceStreamId: "stream-1",
        streamInfo: playableInfo,
        startedAt: seededFrom,
        state: "running",
        stats: { bytes: segmentBytes * segmentCount, segments: segmentCount, reconnects: 0 },
        directory,
      });
      yield* server.db.write.insert(segments).values(rows);
    }),
  );
});

afterAll(async () => {
  await server?.close();
});

const session = async (source: unknown) => {
  const result = await admin.request("POST", "/api/playback/sessions", {
    source,
    capabilities,
    quality: { _tag: "Auto" },
  });
  expect(result.status).toBe(200);
  return result.json as {
    id: string;
    playlistUrl: string;
    plan?: { decision: string };
    startAt?: string;
  };
};

const fetchPlaylist = async (playlistUrl: string) => {
  const url = new URL(playlistUrl, server.url);
  const response = await fetch(url);
  return {
    url,
    status: response.status,
    type: response.headers.get("content-type"),
    body: await response.text(),
  };
};

const segmentUris = (body: string) => body.split("\n").filter((line) => line.startsWith("../seg/"));

/** The grant a playlist URL or segment link carries (the token's signed body). */
const grantOf = (link: string) => {
  const token = new URL(link, "http://localhost/hls/x/").searchParams.get("token") ?? "";
  return JSON.parse(Buffer.from(token.split(".")[0] ?? "", "base64url").toString("utf8")) as {
    exp: number;
    from?: number;
    to?: number;
  };
};

/** A guest who accepted an invite to see `channelIds`, signed in in a browser. */
const guest = async (name: string, channelIds: ReadonlyArray<string>) => {
  const created = await admin.request("POST", "/api/guests/invites", {
    name,
    access: { channelIds, mayRecord: false },
    expiry: "sevenDays",
  });
  const token = new URL((created.json as { url: string }).url).searchParams.get("token") ?? "";
  const browser = new Browser(server.url);
  const accepted = await browser.request("POST", "/api/invites/accept", {
    token,
    username: name,
    password: `${name} password 1`,
  });
  expect(accepted.status).toBe(200);
  return { browser, id: (accepted.json as { user: { id: string } }).user.id };
};

describe("recording playlists", () => {
  it("serves a growing EVENT playlist for a recording that is still running", async () => {
    const created = await admin.request("POST", "/api/recordings", {
      _tag: "Manual",
      channelId,
      range: {
        start: new Date(seededFrom).toISOString(),
        end: new Date(Date.now() + 3_600_000).toISOString(),
      },
      title: "Big race",
    });
    expect(created.status).toBe(200);
    const recording = created.json as { id: string; state: string; sizeBytes: number };
    recordingId = recording.id;
    // Its range already began, so the scheduler started it right away.
    expect(recording.state).toBe("recording");
    expect(recording.sizeBytes).toBe(segmentBytes * segmentCount);
    // The library sums every listed recording in one query, to the same bytes.
    const listed = (await admin.request("GET", "/api/recordings")).json as Array<{
      id: string;
      sizeBytes: number;
    }>;
    expect(listed.find((entry) => entry.id === recording.id)?.sizeBytes).toBe(
      segmentBytes * segmentCount,
    );
    const system = (await admin.request("GET", "/api/system")).json as {
      storage: Array<{ recordingsBytes: number; bufferBytes: number }>;
    };
    expect(system.storage[0]?.recordingsBytes).toBe(segmentBytes * segmentCount);

    const { playlistUrl, plan } = await session({ _tag: "Recording", recordingId });
    expect(plan?.decision ?? "direct").toBe("direct");
    expect(playlistUrl).toMatch(new RegExp(`^/hls/recordings/${recordingId}\\.m3u8\\?token=`));
    const playlist = await fetchPlaylist(playlistUrl);
    expect(playlist.status).toBe(200);
    expect(playlist.type).toBe("application/vnd.apple.mpegurl");
    expect(playlist.body).toContain("#EXT-X-PLAYLIST-TYPE:EVENT");
    expect(playlist.body).not.toContain("#EXT-X-ENDLIST");
    expect(playlist.body).toContain(
      `#EXT-X-PROGRAM-DATE-TIME:${new Date(seededFrom).toISOString()}`,
    );
    expect(segmentUris(playlist.body)).toHaveLength(segmentCount);
  });

  it("serves segments with byte ranges, and only with a token for their capture", async () => {
    const { playlistUrl } = await session({ _tag: "Recording", recordingId });
    const playlist = await fetchPlaylist(playlistUrl);
    const [first] = segmentUris(playlist.body);
    const segmentUrl = new URL(first!, playlist.url);
    expect(segmentUrl.pathname).toBe("/hls/seg/capture-1/0.ts");

    const whole = await fetch(segmentUrl);
    expect(whole.status).toBe(200);
    expect(whole.headers.get("content-type")).toBe("video/mp2t");
    expect(whole.headers.get("accept-ranges")).toBe("bytes");
    expect((await whole.arrayBuffer()).byteLength).toBe(segmentBytes);

    const part = await fetch(segmentUrl, { headers: { range: "bytes=10-19" } });
    expect(part.status).toBe(206);
    expect(part.headers.get("content-range")).toBe(`bytes 10-19/${segmentBytes}`);
    expect((await part.arrayBuffer()).byteLength).toBe(10);

    const beyond = await fetch(segmentUrl, { headers: { range: "bytes=5000-" } });
    expect(beyond.status).toBe(416);

    const bare = new URL(segmentUrl);
    bare.search = "";
    expect((await fetch(bare)).status).toBe(403);
    // The playlist token itself is not a segment token.
    const playlistToken = new URL(playlistUrl, server.url).searchParams.get("token")!;
    bare.searchParams.set("token", playlistToken);
    expect((await fetch(bare)).status).toBe(403);
    const missing = new URL(segmentUrl);
    missing.pathname = "/hls/seg/capture-1/99.ts";
    expect((await fetch(missing)).status).toBe(404);
  });

  it("refuses playlists without a valid token or for another recording", async () => {
    const { playlistUrl } = await session({ _tag: "Recording", recordingId });
    const url = new URL(playlistUrl, server.url);
    url.searchParams.set("token", "forged.token");
    expect((await fetch(url)).status).toBe(403);
    const other = new URL(playlistUrl, server.url);
    other.pathname = "/hls/recordings/other.m3u8";
    expect((await fetch(other)).status).toBe(403);
  });

  it("stops a running recording and settles it from the segment index", async () => {
    const stop = await admin.request("POST", `/api/recordings/${recordingId}/stop`);
    expect(stop.status).toBe(200);
    // It settles once the recorder has let go (after the end grace), judged by the index.
    await expect
      .poll(async () => (await admin.request("GET", `/api/recordings/${recordingId}`)).json, {
        timeout: 15_000,
        interval: 250,
      })
      .toMatchObject({ state: "completed", problems: [] });
    const { playlistUrl } = await session({ _tag: "Recording", recordingId });
    const playlist = await fetchPlaylist(playlistUrl);
    expect(playlist.body).toContain("#EXT-X-PLAYLIST-TYPE:VOD");
    expect(playlist.body).toContain("#EXT-X-ENDLIST");
  });
});

describe("live and range playlists", () => {
  it("serves a sliding live playlist of the current capture", async () => {
    const live = await session({ _tag: "Live", channelId });
    const playlist = await fetchPlaylist(live.playlistUrl);
    expect(playlist.status).toBe(200);
    expect(playlist.body).not.toContain("#EXT-X-PLAYLIST-TYPE");
    expect(playlist.body).not.toContain("#EXT-X-ENDLIST");
    expect(playlist.body).toContain("#EXT-X-MEDIA-SEQUENCE:0");
    expect(segmentUris(playlist.body)).toHaveLength(segmentCount);
    expect((await admin.request("DELETE", `/api/playback/sessions/${live.id}`)).status).toBe(204);
    expect((await admin.request("DELETE", `/api/playback/sessions/${live.id}`)).status).toBe(404);
  });

  it("holds a live playlist request until a starting capture writes its first segment", async () => {
    const channel = await admin.request("POST", "/api/channels", {
      name: "News",
      favourite: false,
      hidden: false,
    });
    const newsId = (channel.json as { id: string }).id;
    const directory = join(server.root, "data", "capture-2");
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, "seg-0.ts"), Buffer.alloc(segmentBytes, 7));
    await server.run(
      server.db.write.insert(captures).values({
        id: "capture-2",
        channelId: newsId,
        sourceStreamId: "stream-2",
        streamInfo: playableInfo,
        startedAt: Date.now(),
        state: "running",
        stats: { bytes: 0, segments: 0, reconnects: 0 },
        directory,
      }),
    );
    const live = await session({ _tag: "Live", channelId: newsId });
    const pending = fetchPlaylist(live.playlistUrl);
    await new Promise((resolve) => setTimeout(resolve, 1200));
    await server.run(
      server.db.write.insert(segments).values({
        captureId: "capture-2",
        sequence: 0,
        runId: "run-2",
        startMs: Date.now() - 6000,
        durationMs: 6000,
        bytes: segmentBytes,
        path: "seg-0.ts",
      }),
    );
    const playlist = await pending;
    expect(playlist.status).toBe(200);
    expect(segmentUris(playlist.body)).toHaveLength(1);
    expect((await admin.request("DELETE", `/api/playback/sessions/${live.id}`)).status).toBe(204);
  });

  it("serves any captured range for start over", async () => {
    const range = {
      start: new Date(seededFrom + 6000).toISOString(),
      end: new Date(seededFrom + 18_000).toISOString(),
    };
    const { playlistUrl, startAt } = await session({ _tag: "Range", channelId, range });
    expect(startAt).toBe(range.start);
    const playlist = await fetchPlaylist(playlistUrl);
    expect(segmentUris(playlist.body).map((uri) => uri.split("?")[0])).toEqual([
      "../seg/capture-1/1.ts",
      "../seg/capture-1/2.ts",
    ]);
    // A range token does not open the live playlist.
    const live = new URL(playlistUrl, server.url);
    live.pathname = `/hls/live/${channelId}.m3u8`;
    expect((await fetch(live)).status).toBe(403);
  });

  it("opens only the range a token was signed for, playlist and segments", async () => {
    const range = {
      start: new Date(seededFrom + 6000).toISOString(),
      end: new Date(seededFrom + 18_000).toISOString(),
    };
    const { playlistUrl } = await session({ _tag: "Range", channelId, range });
    for (const [name, value] of [
      ["from", seededFrom - 3_600_000],
      ["to", seededFrom + 3_600_000],
    ] as const) {
      const rewritten = new URL(playlistUrl, server.url);
      rewritten.searchParams.set(name, String(value));
      expect((await fetch(rewritten)).status).toBe(403);
    }
    const playlist = await fetchPlaylist(playlistUrl);
    const inside = new URL(segmentUris(playlist.body)[0]!, playlist.url);
    expect((await fetch(inside)).status).toBe(200);
    // The same capture token for a segment outside the range.
    const outside = new URL(inside);
    outside.pathname = "/hls/seg/capture-1/4.ts";
    expect((await fetch(outside)).status).toBe(403);
  });

  it("refuses a collection-limited profile a range older than the live window", async () => {
    await admin.request("POST", "/api/profiles", {
      displayName: "Kid",
      avatarTone: "teal",
      login: { username: "kid", password: "kid password 1" },
      access: { collectionIds: [], mayRecord: false },
    });
    const kid = new Browser(server.url);
    await kid.request("POST", "/api/auth/login", { username: "kid", password: "kid password 1" });
    const start = Date.now() - 5 * 3_600_000;
    const old = await kid.request("POST", "/api/playback/sessions", {
      source: {
        _tag: "Range",
        channelId,
        range: {
          start: new Date(start).toISOString(),
          end: new Date(start + 60_000).toISOString(),
        },
      },
      capabilities,
      quality: { _tag: "Auto" },
    });
    expect(old.status).toBe(403);
    const recent = await kid.request("POST", "/api/playback/sessions", {
      source: {
        _tag: "Range",
        channelId,
        range: { start: new Date(seededFrom).toISOString(), end: new Date().toISOString() },
      },
      capabilities,
      quality: { _tag: "Auto" },
    });
    expect(recent.status).toBe(200);
  });

  it("renews the playlist token when the session is updated", async () => {
    const created = await session({ _tag: "Live", channelId });
    // The token's expiry is `now + ttl` in milliseconds; a renewal within the same millisecond
    // would sign the same grant, so let the clock tick first.
    await new Promise((resolve) => setTimeout(resolve, 5));
    const updated = await admin.request("PATCH", `/api/playback/sessions/${created.id}`, {});
    expect(updated.status).toBe(200);
    const next = updated.json as { playlistUrl: string; expiresAt: string };
    expect(next.playlistUrl).not.toBe(created.playlistUrl);
    expect((await fetchPlaylist(next.playlistUrl)).status).toBe(200);
    await admin.request("DELETE", `/api/playback/sessions/${created.id}`);
  });

  it("stops serving a revoked device on its next playlist request", async () => {
    const login = (await new Browser(server.url).request("POST", "/api/auth/login", {
      username: "admin",
      password: "correct horse battery staple",
      device: { name: "Shield", kind: "tv" },
    })) as { json: { token: string; device: { id: string } } };
    const created = await fetch(`${server.url}/api/playback/sessions`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${login.json.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        source: { _tag: "Recording", recordingId },
        capabilities,
        quality: { _tag: "Auto" },
      }),
    });
    const { playlistUrl } = (await created.json()) as { playlistUrl: string };
    const playlist = await fetchPlaylist(playlistUrl);
    expect(playlist.status).toBe(200);
    const segment = new URL(segmentUris(playlist.body)[0]!, playlist.url);
    expect((await fetch(segment)).status).toBe(200);
    expect((await admin.request("DELETE", `/api/devices/${login.json.device.id}`)).status).toBe(
      204,
    );
    expect((await fetchPlaylist(playlistUrl)).status).toBe(403);
    expect((await fetch(segment)).status).toBe(403);
  });

  it("links live segments a few target durations ahead, so a revoked guest loses new ones", async () => {
    const { browser, id } = await guest("viewer", [channelId]);
    const created = await browser.request("POST", "/api/playback/sessions", {
      source: { _tag: "Live", channelId },
      capabilities,
      quality: { _tag: "Auto" },
    });
    expect(created.status).toBe(200);
    const { playlistUrl } = created.json as { playlistUrl: string };
    const before = Date.now();
    const playlist = await fetchPlaylist(playlistUrl);
    expect(playlist.status).toBe(200);
    const [link] = segmentUris(playlist.body);
    const grant = grantOf(link!);
    // Six-second segments: the window ends three target durations past the live edge.
    const reach = LIVE_GRANT_TARGETS * 6000;
    expect(grant.to).toBeGreaterThanOrEqual(before - 1000 + reach);
    expect(grant.to).toBeLessThanOrEqual(Date.now() + reach);

    // Two later segments of the same capture: one inside the window, one past it.
    const directory = join(server.root, "data", "capture-1");
    const later = [
      { sequence: 100, startMs: grant.to! - 7000 },
      { sequence: 101, startMs: grant.to! + 1000 },
    ];
    for (const { sequence } of later) {
      writeFileSync(join(directory, `seg-${sequence}.ts`), Buffer.alloc(segmentBytes, 1));
    }
    await server.run(
      server.db.write.insert(segments).values(
        later.map(({ sequence, startMs }) => ({
          captureId: "capture-1",
          sequence,
          runId: "run-1",
          startMs,
          durationMs: 6000,
          bytes: segmentBytes,
          path: `seg-${sequence}.ts`,
        })),
      ),
    );
    const segmentAt = (sequence: number) => {
      const url = new URL(link!, playlist.url);
      url.pathname = `/hls/seg/capture-1/${sequence}.ts`;
      return url;
    };

    // The guest loses the channel: its next playlist request is refused, and its old links
    // reach no further than their window.
    expect(
      (
        await admin.request("PATCH", `/api/guests/${id}`, {
          access: { channelIds: [], mayRecord: false },
        })
      ).status,
    ).toBe(200);
    expect((await fetchPlaylist(playlistUrl)).status).toBe(403);
    expect((await fetch(segmentAt(100))).status).toBe(200);
    expect((await fetch(segmentAt(101))).status).toBe(403);
    await server.run(server.db.write.delete(segments).where(eq(segments.sequence, 100)));
    await server.run(server.db.write.delete(segments).where(eq(segments.sequence, 101)));
  });

  it("numbers a live playlist across a capture change so it only grows", async () => {
    const channel = await admin.request("POST", "/api/channels", {
      name: "Restarted",
      favourite: false,
      hidden: false,
    });
    const restartedId = (channel.json as { id: string }).id;
    const now = Date.now();
    const seedCapture = async (id: string, startedAt: number, count: number) => {
      const directory = join(server.root, "data", id);
      mkdirSync(directory, { recursive: true });
      const rows = Array.from({ length: count }, (_, sequence) => {
        const path = `seg-${sequence}.ts`;
        writeFileSync(join(directory, path), Buffer.alloc(segmentBytes, sequence));
        return {
          captureId: id,
          sequence,
          runId: `${id}-run`,
          startMs: startedAt + sequence * 6000,
          durationMs: 6000,
          bytes: segmentBytes,
          path,
        };
      });
      await server.run(
        Effect.gen(function* () {
          yield* server.db.write.insert(captures).values({
            id,
            channelId: restartedId,
            sourceStreamId: "stream-3",
            streamInfo: playableInfo,
            startedAt,
            state: "running",
            stats: { bytes: 0, segments: count, reconnects: 0 },
            directory,
          });
          yield* server.db.write.insert(segments).values(rows);
        }),
      );
    };
    await seedCapture("first-run", now - 60_000, 3);
    // The first capture failed; a new one took over a little later.
    await server.run(
      server.db.write
        .update(captures)
        .set({ state: "failed", endedAt: now - 42_000 })
        .where(eq(captures.id, "first-run")),
    );
    await seedCapture("second-run", now - 30_000, 2);

    const live = await session({ _tag: "Live", channelId: restartedId });
    const before = await fetchPlaylist(live.playlistUrl);
    expect(before.body).toContain("#EXT-X-MEDIA-SEQUENCE:0\n");
    expect(before.body).toContain("#EXT-X-DISCONTINUITY-SEQUENCE:0\n");
    expect(before.body.match(/#EXT-X-DISCONTINUITY\n/g)).toHaveLength(1);
    // Each stretch keeps its own clock, so players show the gap between them (a kept buffer
    // from before the channel stopped, then the capture that started again).
    expect(before.body).toContain(
      `#EXT-X-DISCONTINUITY\n#EXT-X-PROGRAM-DATE-TIME:${new Date(now - 30_000).toISOString()}\n`,
    );
    expect(segmentUris(before.body).map((uri) => uri.split("?")[0])).toEqual([
      "../seg/first-run/0.ts",
      "../seg/first-run/1.ts",
      "../seg/first-run/2.ts",
      "../seg/second-run/0.ts",
      "../seg/second-run/1.ts",
    ]);

    // Retention drops the old capture: the new one keeps its numbers (3 and 4).
    await server.run(server.db.write.delete(captures).where(eq(captures.id, "first-run")));
    const after = await fetchPlaylist(live.playlistUrl);
    expect(after.body).toContain("#EXT-X-MEDIA-SEQUENCE:3\n");
    expect(after.body).toContain("#EXT-X-DISCONTINUITY-SEQUENCE:1\n");
    expect(after.body).not.toContain("#EXT-X-DISCONTINUITY\n");
    expect(segmentUris(after.body).map((uri) => uri.split("?")[0])).toEqual([
      "../seg/second-run/0.ts",
      "../seg/second-run/1.ts",
    ]);
    await admin.request("DELETE", `/api/playback/sessions/${live.id}`);
  });
});

describe("resume positions", () => {
  it("saves a position, resumes from it and lists it under continue watching", async () => {
    const empty = await admin.request("GET", `/api/playback/state/recordings/${recordingId}`);
    expect(empty.json).toMatchObject({ positionMillis: 0, watched: false });
    const saved = await admin.request("PUT", "/api/playback/state", {
      target: { _tag: "Recording", recordingId },
      positionMillis: 12_000,
      watched: false,
    });
    expect(saved.json).toMatchObject({ positionMillis: 12_000 });
    const resumed = await session({ _tag: "Recording", recordingId });
    expect(resumed.startAt).toBe(new Date(seededFrom + 12_000).toISOString());
    const continuing = (await admin.request("GET", "/api/playback/continue")).json as Array<{
      target: unknown;
    }>;
    expect(continuing.map((state) => state.target)).toEqual([{ _tag: "Recording", recordingId }]);
    // The library shows the caller's own progress and filters by it.
    expect((await admin.request("GET", `/api/recordings/${recordingId}`)).json).toMatchObject({
      watched: false,
      positionMillis: 12_000,
    });
    await admin.request("PUT", "/api/playback/state", {
      target: { _tag: "Recording", recordingId },
      positionMillis: 30_000,
      watched: true,
    });
    const ids = async (query: string) =>
      ((await admin.request("GET", `/api/recordings${query}`)).json as Array<{ id: string }>).map(
        (entry) => entry.id,
      );
    expect(await ids("?watched=true")).toEqual([recordingId]);
    expect(await ids("?watched=false")).toEqual([]);
    const unknown = await admin.request("PUT", "/api/playback/state", {
      target: { _tag: "Recording", recordingId: "nope" },
      positionMillis: 1,
      watched: false,
    });
    expect(unknown.status).toBe(404);
  });
});

/**
 * A whole server whose clock runs `offset` ahead of the real one, so a test can let a token age
 * without waiting. Sleeps still take real time.
 */
const startShiftedServer = async () => {
  const root = mkdtempSync(join(tmpdir(), "slipstream-hls-"));
  const shift = { offset: 0 };
  const millis = () => Date.now() + shift.offset;
  const clock: Clock.Clock = {
    currentTimeMillisUnsafe: millis,
    currentTimeMillis: Effect.sync(millis),
    currentTimeNanosUnsafe: () => BigInt(millis()) * 1_000_000n,
    currentTimeNanos: Effect.sync(() => BigInt(millis()) * 1_000_000n),
    monotonicTimeNanosUnsafe: () => process.hrtime.bigint(),
    monotonicTimeNanos: Effect.sync(() => process.hrtime.bigint()),
    sleep: (duration) =>
      Effect.callback<void>((resume) => {
        const timer = setTimeout(() => resume(Effect.void), Duration.toMillis(duration));
        return Effect.sync(() => clearTimeout(timer));
      }),
  };
  const scope = Scope.makeUnsafe();
  const context = await Effect.runPromise(
    Layer.build(
      makeServer().pipe(
        Layer.provideMerge(ServerConfig.layerWith(testSettings(root))),
        Layer.provide(Layer.succeed(References.MinimumLogLevel, "Error")),
        Layer.provide(Layer.succeed(Clock.Clock, clock)),
      ),
    ).pipe(Scope.provide(scope)),
  );
  const address = Context.get(context, HttpServer.HttpServer).address;
  if (address._tag === "UnixPathAddress") throw new Error("expected a TCP address");
  const db: DbShape = Context.get(context, Db);
  return {
    url: `http://127.0.0.1:${address.port}`,
    root,
    db,
    now: millis,
    /** Moves the server's clock on by `millis`. */
    advance: (by: number) => {
      shift.offset += by;
    },
    close: async () => {
      await Effect.runPromise(Scope.close(scope, Exit.void));
      rmSync(root, { recursive: true, force: true });
    },
  };
};

describe("renewing a session past half its token life", () => {
  let shifted: Awaited<ReturnType<typeof startShiftedServer>>;
  let owner: Browser;
  let shiftedChannel: string;
  const start = Date.now() - segmentCount * 6000;

  beforeAll(async () => {
    shifted = await startShiftedServer();
    owner = new Browser(shifted.url);
    await owner.request("POST", "/api/auth/setup", {
      username: "admin",
      displayName: "Admin",
      password: "correct horse battery staple",
    });
    shiftedChannel = (
      (
        await owner.request("POST", "/api/channels", {
          name: "Aging",
          favourite: false,
          hidden: false,
        })
      ).json as { id: string }
    ).id;
    const directory = join(shifted.root, "data", "aging");
    mkdirSync(directory, { recursive: true });
    for (let sequence = 0; sequence < segmentCount; sequence += 1) {
      writeFileSync(join(directory, `seg-${sequence}.ts`), Buffer.alloc(segmentBytes, sequence));
    }
    await Effect.runPromise(
      Effect.gen(function* () {
        yield* shifted.db.write.insert(captures).values({
          id: "aging",
          channelId: shiftedChannel,
          sourceStreamId: "stream-aging",
          streamInfo: playableInfo,
          startedAt: start,
          endedAt: start + segmentCount * 6000,
          state: "stopped",
          stats: { bytes: segmentBytes * segmentCount, segments: segmentCount, reconnects: 0 },
          directory,
        });
        yield* shifted.db.write.insert(segments).values(
          Array.from({ length: segmentCount }, (_, sequence) => ({
            captureId: "aging",
            sequence,
            runId: "run-aging",
            startMs: start + sequence * 6000,
            durationMs: 6000,
            bytes: segmentBytes,
            path: `seg-${sequence}.ts`,
          })),
        );
      }).pipe(Effect.orDie),
    );
  });

  afterAll(async () => {
    await shifted?.close();
  });

  it("answers an empty update with a fresh token, a later expiry and segment links to match", async () => {
    const range = {
      start: new Date(start).toISOString(),
      end: new Date(start + segmentCount * 6000).toISOString(),
    };
    const created = await owner.request("POST", "/api/playback/sessions", {
      source: { _tag: "Range", channelId: shiftedChannel, range },
      capabilities,
      quality: { _tag: "Auto" },
    });
    expect(created.status).toBe(200);
    const first = created.json as { id: string; playlistUrl: string; expiresAt: string };
    expect(grantOf(first.playlistUrl).exp).toBe(Date.parse(first.expiresAt));
    const firstPlaylist = await fetch(new URL(first.playlistUrl, shifted.url));
    const [firstLink] = segmentUris(await firstPlaylist.text());
    expect(grantOf(firstLink!).exp).toBe(Date.parse(first.expiresAt));

    // Past half the token's life, the player renews with an empty update.
    shifted.advance(HLS_TOKEN_MILLIS * 0.6);
    const renewed = await owner.request("PATCH", `/api/playback/sessions/${first.id}`, {});
    expect(renewed.status).toBe(200);
    const next = renewed.json as { id: string; playlistUrl: string; expiresAt: string };
    expect(next.id).toBe(first.id);
    expect(next.playlistUrl).not.toBe(first.playlistUrl);
    expect(Date.parse(next.expiresAt)).toBe(grantOf(next.playlistUrl).exp);
    expect(Date.parse(next.expiresAt)).toBeGreaterThanOrEqual(
      Date.parse(first.expiresAt) + HLS_TOKEN_MILLIS * 0.6 - 1000,
    );
    expect(Date.parse(next.expiresAt) - shifted.now()).toBeGreaterThan(HLS_TOKEN_MILLIS - 60_000);

    const playlistUrl = new URL(next.playlistUrl, shifted.url);
    const renewedPlaylist = await fetch(playlistUrl);
    expect(renewedPlaylist.status).toBe(200);
    const links = segmentUris(await renewedPlaylist.text());
    expect(links).toHaveLength(segmentCount);
    for (const link of links) expect(grantOf(link).exp).toBe(Date.parse(next.expiresAt));

    // Once the first token has expired, only the renewed playlist and its links still open.
    shifted.advance(HLS_TOKEN_MILLIS * 0.5);
    expect((await fetch(new URL(first.playlistUrl, shifted.url))).status).toBe(403);
    expect((await fetch(new URL(firstLink!, firstPlaylist.url))).status).toBe(403);
    expect((await fetch(playlistUrl)).status).toBe(200);
    expect((await fetch(new URL(links[0]!, playlistUrl))).status).toBe(200);
    await owner.request("DELETE", `/api/playback/sessions/${first.id}`);
  });
});
