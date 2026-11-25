/**
 * Frame grabs with real ffmpeg: a recording whose segment opens with black gets the first
 * picture after it (never a black frame), served as cacheable JPEG and preferred by the artwork
 * resolver; a recording with nothing but black counts a failed attempt and keeps generated
 * artwork.
 */
import { execFile, spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { eq } from "drizzle-orm";
import { Effect } from "effect";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { framePath, grabDueFrames } from "../src/artwork/frames.ts";
import { ServerConfig } from "../src/config.ts";
import { Db } from "../src/db/client.ts";
import { captures, recordingOwners, recordings, segments } from "../src/db/schema.ts";
import { Browser, startTestServer, type TestServer } from "./harness.ts";
import { testSettings } from "./support.ts";
import { MINUTE } from "@slipstream/domain";
import { FfmpegRunner } from "@slipstream/recorder";

const run = promisify(execFile);
/** The binary the server is configured with (`ffmpeg` on PATH in tests). */
const ffmpeg = testSettings("").ffmpegPath;
const hasFfmpeg = spawnSync(ffmpeg, ["-version"]).status === 0;

let server: TestServer;
let admin: Browser;
let adminId: string;
let channelId: string;

/** Writes an MPEG-TS file: `black` seconds of black, then `picture` seconds of a test pattern. */
const segmentFile = async (file: string, black: number, picture: number) => {
  const inputs = [
    "-f",
    "lavfi",
    "-i",
    `color=c=black:s=320x240:r=25:d=${black}`,
    ...(picture > 0 ? ["-f", "lavfi", "-i", `testsrc2=s=320x240:r=25:d=${picture}`] : []),
  ];
  const graph =
    picture > 0 ? ["-filter_complex", "[0:v][1:v]concat=n=2:v=1[v]", "-map", "[v]"] : [];
  await run(ffmpeg, [
    "-hide_banner",
    "-loglevel",
    "error",
    ...inputs,
    ...graph,
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-f",
    "mpegts",
    "-y",
    file,
  ]);
};

/** Average brightness of a picture, from ffmpeg's `signalstats`. */
const brightness = async (file: string) => {
  const { stderr } = await run(ffmpeg, [
    "-hide_banner",
    "-i",
    file,
    "-vf",
    "signalstats,metadata=print:key=lavfi.signalstats.YAVG",
    "-f",
    "null",
    "-",
  ]);
  const match = /lavfi\.signalstats\.YAVG=([\d.]+)/u.exec(stderr);
  return Number(match?.[1] ?? 0);
};

/** A completed recording on the test channel whose frame window holds one segment. */
const seedRecording = async (id: string, startMs: number, kind: "picture" | "black") => {
  const captureId = `capture-${id}`;
  const directory = join(server.root, "data", "captures", captureId);
  mkdirSync(directory, { recursive: true });
  const segmentPath = "000001.ts";
  if (kind === "picture") await segmentFile(join(directory, segmentPath), 3, 5);
  else await segmentFile(join(directory, segmentPath), 6, 0);
  const frameAt = startMs + 10 * MINUTE;
  await server.run(
    Effect.gen(function* () {
      yield* server.db.write.insert(captures).values({
        id: captureId,
        channelId,
        sourceStreamId: "test",
        startedAt: frameAt,
        endedAt: frameAt + 8000,
        state: "stopped",
        stats: { bytes: 0, segments: 1, reconnects: 0 },
        directory,
      });
      yield* server.db.write.insert(segments).values({
        captureId,
        sequence: 1,
        runId: "run",
        startMs: frameAt,
        durationMs: 8000,
        bytes: 1000,
        path: segmentPath,
      });
      yield* server.db.write.insert(recordings).values({
        id,
        channelId,
        start: startMs,
        end: startMs + 60 * MINUTE,
        title: `Seeded ${id}`,
        categories: ["Krimi"],
        repeat: false,
        live: false,
        paddingBeforeMinutes: 0,
        paddingAfterMinutes: 0,
        state: "completed",
        problems: [],
        protected: false,
        exportStatus: "none",
        createdAt: startMs,
      });
      yield* server.db.write
        .insert(recordingOwners)
        .values({ recordingId: id, userId: adminId, addedAt: startMs });
    }),
  );
  return frameAt;
};

const grab = () =>
  server.run(
    grabDueFrames.pipe(
      Effect.provideService(Db, server.db),
      Effect.provideService(ServerConfig, testSettings(server.root)),
      Effect.provide(FfmpegRunner.layer),
    ),
  );

beforeAll(async () => {
  server = await startTestServer();
  admin = new Browser(server.url);
  const setup = await admin.request("POST", "/api/auth/setup", {
    username: "admin",
    displayName: "Admin",
    password: "correct horse battery staple",
  });
  adminId = (setup.json as { user: { id: string } }).user.id;
  const channel = await admin.request("POST", "/api/channels", {
    name: "Krimikanal",
    favourite: false,
    hidden: false,
  });
  channelId = (channel.json as { id: string }).id;
});

afterAll(async () => {
  await server?.close();
});

describe.skipIf(!hasFfmpeg)("frame grabs", () => {
  it("grabs the first picture after black and serves it as cacheable JPEG", async () => {
    const start = Date.now() - 2 * 3_600_000;
    const frameAt = await seedRecording("with-picture", start, "picture");
    await grab();

    expect(await brightness(framePath(join(server.root, "data"), "with-picture"))).toBeGreaterThan(
      24,
    );
    const frame = await fetch(`${server.url}/api/artwork/frames/with-picture?v=${frameAt}`, {
      headers: { cookie: `slipstream_session=${admin.cookies.get("slipstream_session")}` },
    });
    expect(frame.status).toBe(200);
    expect(frame.headers.get("content-type")).toBe("image/jpeg");
    expect(frame.headers.get("cache-control")).toBe("private, max-age=31536000, immutable");
    const bytes = new Uint8Array(await frame.arrayBuffer());
    expect([bytes[0], bytes[1]]).toEqual([0xff, 0xd8]);

    expect((await admin.request("GET", "/api/artwork?recordingIds=with-picture")).json).toEqual([
      {
        target: { _tag: "Recording", recordingId: "with-picture" },
        artwork: {
          _tag: "Frame",
          recordingId: "with-picture",
          grabbedAt: new Date(frameAt).toISOString(),
        },
      },
    ]);
  });

  it("counts a window of only black as a failed attempt", async () => {
    await seedRecording("all-black", Date.now() - 3 * 3_600_000, "black");
    await grab();
    const rows = await server.run(
      server.db.read
        .select({ frameAt: recordings.frameAt, failures: recordings.frameFailures })
        .from(recordings)
        .where(eq(recordings.id, "all-black")),
    );
    expect(rows).toEqual([{ frameAt: null, failures: 1 }]);
    const entry = (await admin.request("GET", "/api/recordings/all-black")).json as {
      artwork: { _tag: string };
    };
    expect(entry.artwork._tag).toBe("Generated");
    expect((await admin.request("GET", "/api/artwork/frames/all-black")).json).toMatchObject({
      _tag: "NotFound",
      entity: "frame",
    });
  });
});
