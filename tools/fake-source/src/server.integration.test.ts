import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { Effect } from "effect";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { channels } from "./channels.ts";
import { type RunningFakeSource, startFakeSource } from "./server.ts";

const run = promisify(execFile);

let source: RunningFakeSource & { close(): Promise<void> };
let scratch: string;

beforeAll(async () => {
  // FAKE_SOURCE_FFMPEG picks another ffmpeg, e.g. one with drawtext to exercise the overlay.
  source = await startFakeSource({ ffmpegPath: process.env["FAKE_SOURCE_FFMPEG"] });
  scratch = await mkdtemp(join(tmpdir(), "fake-source-test-"));
});

afterAll(async () => {
  await source.close();
  await rm(scratch, { recursive: true, force: true });
});

beforeEach(async () => {
  await fetch(`${source.url}/control`, { method: "DELETE" });
  // A stream the previous test hung up on is released once the server sees the disconnect.
  await eventually(async () => (await control()).sessions.length === 0);
});

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Polls until `check` holds or `ms` pass. */
const eventually = async (check: () => boolean | Promise<boolean>, ms = 5000) => {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (await check()) return true;
    await sleep(100);
  }
  return check();
};

const isAlive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

interface Read {
  readonly status: number;
  readonly bytes: Buffer;
  /** How the body ended within the time: `end` (clean), `error` (connection lost) or `open`. */
  readonly ending: "end" | "error" | "open";
}

/** Reads a response body for at most `ms`, then disconnects. */
const readFor = async (url: string, ms: number): Promise<Read> => {
  const abort = new AbortController();
  const response = await fetch(url, { signal: abort.signal });
  const chunks: Array<Uint8Array> = [];
  const reader = response.body?.getReader();
  let ending: Read["ending"] = "open";
  const timer = setTimeout(() => abort.abort(), ms);
  try {
    for (;;) {
      if (!reader) break;
      const { done, value } = await reader.read();
      if (done) {
        ending = "end";
        break;
      }
      chunks.push(value);
    }
  } catch {
    ending = abort.signal.aborted ? "open" : "error";
  } finally {
    clearTimeout(timer);
    abort.abort();
  }
  return { status: response.status, bytes: Buffer.concat(chunks), ending };
};

interface ProbedStream {
  readonly codec_type: string;
  readonly codec_name: string;
  readonly width?: number;
  readonly height?: number;
  readonly r_frame_rate?: string;
  readonly field_order?: string;
}

const ffprobe = async (bytes: Buffer, name: string): Promise<ReadonlyArray<ProbedStream>> => {
  const file = join(scratch, `${name}.ts`);
  await writeFile(file, bytes);
  const { stdout } = await run("ffprobe", [
    "-v",
    "error",
    "-show_entries",
    "stream=codec_type,codec_name,width,height,r_frame_rate,field_order",
    "-of",
    "json",
    file,
  ]);
  return (JSON.parse(stdout) as { streams: Array<ProbedStream> }).streams;
};

/** Parses an XMLTV timestamp (`20261121160000`, `+0100`). */
const xmltvDate = (stamp: string, offset: string) =>
  new Date(
    `${stamp.slice(0, 4)}-${stamp.slice(4, 6)}-${stamp.slice(6, 8)}T${stamp.slice(8, 10)}:` +
      `${stamp.slice(10, 12)}:${stamp.slice(12, 14)}${offset.slice(0, 3)}:${offset.slice(3)}`,
  );

interface ControlState {
  readonly faults: Record<string, unknown>;
  readonly sessions: ReadonlyArray<{ id: number; channelId: string; pid: number | null }>;
}

const control = async (body?: Record<string, unknown>): Promise<ControlState> => {
  const response = await fetch(
    `${source.url}/control`,
    body
      ? {
          method: "POST",
          body: JSON.stringify(body),
          headers: { "content-type": "application/json" },
        }
      : {},
  );
  expect(response.status).toBe(200);
  return (await response.json()) as ControlState;
};

describe("playlist and guide", () => {
  it("serves an M3U with every channel pointing back at the server", async () => {
    const response = await fetch(`${source.url}/playlist.m3u?dropAfter=5&unrelated=1`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("mpegurl");
    const lines = (await response.text()).trimEnd().split("\n");
    expect(lines[0]).toMatch(/^#EXTM3U url-tvg=".+\/epg\.xml"/);
    const urls = lines.filter((line) => line.startsWith("http"));
    expect(urls).toHaveLength(channels.length);
    expect(urls[0]).toBe(`${source.url}/stream/sportkanal-f1.ts?dropAfter=5`);
    const logo = /tvg-logo="([^"]+)"/.exec(lines[1] ?? "")?.[1] ?? "";
    const svg = await fetch(logo);
    expect(svg.headers.get("content-type")).toBe("image/svg+xml");
    expect(await svg.text()).toMatch(/^<svg /);
  });

  it("serves 72 hours of XMLTV starting with what is on now", async () => {
    const guide = await (await fetch(`${source.url}/epg.xml`)).text();
    expect(guide.match(/<channel id=/g)).toHaveLength(channels.length);
    const starts = [...guide.matchAll(/<programme start="(\d{14}) ([+-]\d{4})" stop="(\d{14})/g)];
    expect(starts.length).toBeGreaterThan(500);
    const now = Date.now();
    const times = starts.map(([, start = "", offset = "", stop = ""]) => ({
      start: xmltvDate(start, offset).getTime(),
      stop: xmltvDate(stop, offset).getTime(),
    }));
    expect(times.some((time) => time.start <= now && time.stop > now)).toBe(true);
    expect(Math.max(...times.map((time) => time.stop))).toBeGreaterThanOrEqual(
      now + 71.9 * 3_600_000,
    );
  });

  it("duplicates programmes on request and rejects bad parameters", async () => {
    const once = await (await fetch(`${source.url}/epg.xml?hours=2`)).text();
    const twice = await (await fetch(`${source.url}/epg.xml?hours=2&duplicates=1`)).text();
    expect(twice.match(/<programme /g)?.length).toBe((once.match(/<programme /g)?.length ?? 0) * 2);
    expect((await fetch(`${source.url}/epg.xml?hours=-3`)).status).toBe(400);
  });

  it("serves the big line-up and its guide with ?lineup=big", async () => {
    const playlist = await (await fetch(`${source.url}/playlist.m3u?lineup=big`)).text();
    const entries = playlist.split("\n").filter((line) => line.startsWith("#EXTINF"));
    expect(entries.length).toBeGreaterThan(4500);
    expect(playlist).toContain('group-title="UK | Entertainment"');
    expect(playlist).toContain(`url-tvg="${source.url}/epg.xml?lineup=big"`);
    const guide = await (await fetch(`${source.url}/epg.xml?lineup=big&hours=2`)).text();
    expect(guide).toContain('<channel id="daserste.de.big">');
    expect(guide).toContain(`<channel id="${channels[0]?.tvgId}">`);
  });
});

describe("streams", () => {
  it("streams live 1080p50 H.264 + AAC on the F1 channel", async () => {
    const read = await readFor(`${source.url}/stream/sportkanal-f1.ts`, 3000);
    expect(read.status).toBe(200);
    expect(read.bytes.length).toBeGreaterThan(100_000);
    expect(read.bytes[0]).toBe(0x47);
    const streams = await ffprobe(read.bytes, "f1");
    expect(streams.find((stream) => stream.codec_type === "video")).toMatchObject({
      codec_name: "h264",
      width: 1920,
      height: 1080,
      r_frame_rate: "50/1",
    });
    expect(streams.find((stream) => stream.codec_type === "audio")?.codec_name).toBe("aac");
  });

  it("streams 576i on the documentary channel and MP2 audio on the regional one", async () => {
    const [doku, regional] = await Promise.all([
      readFor(`${source.url}/stream/doku-plus.ts`, 3000),
      readFor(`${source.url}/stream/regional.ts`, 3000),
    ]);
    const dokuVideo = (await ffprobe(doku.bytes, "doku")).find(
      (stream) => stream.codec_type === "video",
    );
    expect(dokuVideo).toMatchObject({ width: 720, height: 576, field_order: "tt" });
    const regionalStreams = await ffprobe(regional.bytes, "regional");
    expect(regionalStreams.find((stream) => stream.codec_type === "audio")?.codec_name).toBe("mp2");
    expect(regionalStreams.find((stream) => stream.codec_type === "video")).toMatchObject({
      width: 1280,
      height: 720,
    });
  });

  it("returns 404 for an unknown channel", async () => {
    expect((await fetch(`${source.url}/stream/nope.ts`)).status).toBe(404);
  });

  it("stops ffmpeg when the client disconnects", async () => {
    const abort = new AbortController();
    const response = await fetch(`${source.url}/stream/kunterbunt.ts`, { signal: abort.signal });
    const reader = response.body?.getReader();
    await reader?.read();
    const [session] = (await control()).sessions;
    const pid = session?.pid ?? 0;
    expect(session?.channelId).toBe("kunterbunt");
    expect(isAlive(pid)).toBe(true);
    abort.abort();
    expect(await eventually(() => !isAlive(pid))).toBe(true);
    expect(await eventually(async () => (await control()).sessions.length === 0)).toBe(true);
  });
});

describe("fault injection", () => {
  it.each([403, 429, 509])("refuses with HTTP %i", async (status) => {
    const response = await fetch(`${source.url}/stream/serienwelt.ts?refuse=${status}`);
    expect(response.status).toBe(status);
    expect((await control()).sessions).toHaveLength(0);
  });

  it("answers with an immediate EOF", async () => {
    const read = await readFor(`${source.url}/stream/serienwelt.ts?refuse=eof`, 2000);
    expect(read).toMatchObject({ status: 200, ending: "end" });
    expect(read.bytes.length).toBe(0);
  });

  it("refuses a counted number of requests set through /control", async () => {
    await control({ refuse: 429, refuseCount: 2 });
    const first = await fetch(`${source.url}/stream/serienwelt.ts`);
    const second = await fetch(`${source.url}/stream/serienwelt.ts`);
    expect([first.status, second.status]).toEqual([429, 429]);
    const third = await readFor(`${source.url}/stream/serienwelt.ts`, 1000);
    expect(third.status).toBe(200);
    expect(third.bytes.length).toBeGreaterThan(0);
  });

  it("drops the connection after N seconds", async () => {
    const started = Date.now();
    const read = await readFor(`${source.url}/stream/testbild-kurz.ts?dropAfter=1.5`, 8000);
    const elapsed = Date.now() - started;
    expect(read.ending).toBe("error");
    expect(read.bytes.length).toBeGreaterThan(0);
    expect(elapsed).toBeGreaterThan(1400);
    expect(elapsed).toBeLessThan(5000);
  });

  it("ends the stream cleanly after N seconds in eof mode", async () => {
    const read = await readFor(
      `${source.url}/stream/testbild-kurz.ts?dropAfter=1&dropMode=eof`,
      8000,
    );
    expect(read.ending).toBe("end");
    expect(read.bytes.length).toBeGreaterThan(0);
  });

  it("stalls: stops sending and stops ffmpeg but keeps the connection open", async () => {
    const abort = new AbortController();
    const response = await fetch(`${source.url}/stream/testbild-kurz.ts?stallAfter=1`, {
      signal: abort.signal,
    });
    const reader = response.body?.getReader();
    let received = 0;
    let lastChunkAt = Date.now();
    const pump = (async () => {
      try {
        for (;;) {
          if (!reader) break;
          const { done, value } = await reader.read();
          if (done) return "end";
          received += value.length;
          lastChunkAt = Date.now();
        }
      } catch {
        return abort.signal.aborted ? "aborted" : "error";
      }
      return "end";
    })();
    await sleep(3500);
    const [session] = (await control()).sessions;
    expect(received).toBeGreaterThan(0);
    expect(Date.now() - lastChunkAt).toBeGreaterThan(1500);
    expect(session?.pid && isAlive(session.pid)).toBe(false);
    abort.abort();
    expect(await pump).toBe("aborted");
  });

  it("enforces the concurrent stream limit and frees the slot on disconnect", async () => {
    await control({ maxStreams: 1, limitStatus: 509 });
    const abort = new AbortController();
    const first = await fetch(`${source.url}/stream/nachrichten-24.ts`, { signal: abort.signal });
    expect(first.status).toBe(200);
    await first.body?.getReader().read();
    const second = await fetch(`${source.url}/stream/kino-klassik.ts`);
    expect(second.status).toBe(509);
    expect(await second.text()).toContain("limit");
    abort.abort();
    expect(await eventually(async () => (await control()).sessions.length === 0)).toBe(true);
    const third = await readFor(`${source.url}/stream/kino-klassik.ts`, 1000);
    expect(third.status).toBe(200);
  });

  it("validates fault parameters and control updates", async () => {
    expect((await fetch(`${source.url}/stream/regional.ts?refuse=200`)).status).toBe(400);
    const response = await fetch(`${source.url}/control`, {
      method: "POST",
      body: JSON.stringify({ maxStreams: -1 }),
      headers: { "content-type": "application/json" },
    });
    expect(response.status).toBe(400);
  });
});

describe("shutdown", () => {
  it("stops every ffmpeg when the source closes", async () => {
    const own = await startFakeSource();
    const abort = new AbortController();
    try {
      const response = await fetch(`${own.url}/stream/regional.ts`, { signal: abort.signal });
      await response.body?.getReader().read();
      // Read straight from the service rather than over HTTP.
      const [session] = await Effect.runPromise(own.sessions.list);
      const pid = session?.pid ?? 0;
      expect(isAlive(pid)).toBe(true);
      await own.close();
      expect(await eventually(() => !isAlive(pid))).toBe(true);
    } finally {
      abort.abort();
      await own.close();
    }
  });
});
