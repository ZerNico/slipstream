/**
 * Source refresh against a running `@slipstream/fake-source`, then the guide, rules,
 * collections and recordings built on what it imported, all through the HTTP API.
 */
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { eq } from "drizzle-orm";
import { startFakeSource, type RunningFakeSource } from "@slipstream/fake-source";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sources, sourceStreams } from "../src/db/schema.ts";
import { Browser, startTestServer, type TestServer } from "./harness.ts";

let server: TestServer;
let fake: RunningFakeSource & { close(): Promise<void> };
let admin: Browser;

interface Programme {
  readonly id: string;
  readonly channelId: string;
  readonly start: string;
  readonly end: string;
  readonly title: string;
  readonly description?: string;
}
interface Channel {
  readonly id: string;
  readonly name: string;
  readonly guideChannelId?: string;
  readonly number?: number;
  readonly logoUrl?: string;
}

beforeAll(async () => {
  // The fake source writes every programme twice, like the tvproxy feed.
  [server, fake] = await Promise.all([
    startTestServer(),
    startFakeSource({ duplicateProgrammes: true }),
  ]);
  admin = new Browser(server.url);
  await admin.request("POST", "/api/auth/setup", {
    username: "admin",
    displayName: "Admin",
    password: "correct horse battery staple",
  });
});

afterAll(async () => {
  await Promise.all([server?.close(), fake?.close()]);
});

const sourceInput = () => ({
  name: "Fake",
  config: {
    _tag: "M3u",
    playlistUrl: `${fake.url}/playlist.m3u?token=s3cret`,
    guideUrl: `${fake.url}/epg.xml`,
  },
  refreshIntervalMinutes: 60,
  headers: { "x-trace": "on" },
  secretHeaders: { "x-api-key": "hunter2" },
  guideCleanup: { removeDuplicates: true, rewrites: [] },
  enabled: true,
});

let sourceId: string;
let news: Channel;
let collectionId: string;

describe("sources", () => {
  it("creates a source and never shows its secrets again", async () => {
    const created = await admin.request("POST", "/api/sources", sourceInput());
    expect(created.status).toBe(200);
    const source = created.json as {
      id: string;
      config: { playlistUrl: { url: string; hasCredentials: boolean } };
      headers: Record<string, string>;
      secretHeaderNames: Array<string>;
    };
    sourceId = source.id;
    expect(source.config.playlistUrl).toEqual({
      url: `${fake.url}/playlist.m3u?token=***`,
      hasCredentials: true,
    });
    expect(source.headers).toEqual({ "x-trace": "on" });
    expect(source.secretHeaderNames).toEqual(["x-api-key"]);
    expect(created.text).not.toContain("s3cret");
    expect(created.text).not.toContain("hunter2");

    // At rest the secrets are sealed with the key in the config directory.
    const [row] = await server.run(server.db.read.select().from(sources));
    expect(row?.config).toMatch(/^v1:/);
    expect(row?.config).not.toContain("s3cret");
    expect(row?.secretHeaders).not.toContain("hunter2");

    // A patch without the secrets keeps them; the config may leave out its URLs.
    const renamed = await admin.request("PATCH", `/api/sources/${sourceId}`, {
      name: "Fake source",
      config: { _tag: "M3u" },
    });
    expect(renamed.status).toBe(200);
    expect(renamed.json).toMatchObject({
      name: "Fake source",
      config: { playlistUrl: { hasCredentials: true } },
      secretHeaderNames: ["x-api-key"],
    });
    // Switching type needs the new type's secrets.
    const incomplete = await admin.request("PATCH", `/api/sources/${sourceId}`, {
      config: { _tag: "Xtream", username: "me" },
    });
    expect(incomplete.json).toMatchObject({
      problems: [{ path: "config.serverUrl", code: "required" }],
    });
  });

  it("keeps credentials out of plain headers", async () => {
    const result = await admin.request("POST", "/api/sources", {
      ...sourceInput(),
      headers: { Authorization: "Bearer hunter2" },
    });
    expect(result.status).toBe(422);
    expect(result.json).toMatchObject({
      problems: [{ path: "headers.Authorization", code: "secretHeader" }],
    });
  });

  it("rejects source types and rewrite rules it cannot use", async () => {
    const result = await admin.request("POST", "/api/sources", {
      ...sourceInput(),
      config: { _tag: "Url", streamUrl: "http://example.test/stream.ts" },
      guideCleanup: {
        removeDuplicates: true,
        rewrites: [{ field: "title", pattern: "(", replacement: "" }],
      },
    });
    expect(result.status).toBe(422);
    expect(result.json).toMatchObject({
      problems: [
        { path: "config._tag", code: "unsupportedSourceType" },
        { path: "guideCleanup.rewrites.0.pattern", code: "invalidRegex" },
      ],
    });
  });

  it("refreshes: stores streams and the cleaned guide, and creates channels the first time", async () => {
    const refresh = await admin.request("POST", `/api/sources/${sourceId}/refresh`);
    expect(refresh.status).toBe(200);
    const check = refresh.json as {
      streams: number;
      guideChannels: number;
      programmes: number;
      unmappedStreams: number;
    };
    expect(check.streams).toBe(9);
    expect(check.guideChannels).toBe(9);
    expect(check.programmes).toBeGreaterThan(100);
    expect(check.unmappedStreams).toBe(0);

    const source = (await admin.request("GET", `/api/sources/${sourceId}`)).json as {
      health: string;
    };
    expect(source.health).toBe("ok");

    const streams = (
      await admin.request("GET", `/api/sources/${sourceId}/streams?search=nachrichten`)
    ).json as Array<{
      name: string;
      url?: string;
    }>;
    expect(streams.map((stream) => stream.name)).toEqual(["Nachrichten 24"]);
    // Stream URLs may carry account tokens; views never include them.
    expect(streams[0]?.url).toBeUndefined();

    const channels = (await admin.request("GET", "/api/channels")).json as Array<Channel>;
    expect(channels).toHaveLength(9);
    news = channels.find((channel) => channel.name === "Nachrichten 24")!;
    expect(news.guideChannelId).toBe("Nachrichten24.fake.de");

    // A second refresh updates in place and does not duplicate channels.
    await admin.request("POST", `/api/sources/${sourceId}/refresh`);
    expect((await admin.request("GET", "/api/channels")).json).toHaveLength(9);

    // Stream URLs are sealed at rest like the source's own secrets.
    const rows = await server.run(server.db.read.select().from(sourceStreams));
    expect(rows).toHaveLength(9);
    for (const row of rows) {
      expect(row.url).toMatch(/^v1:/);
      expect(row.url).not.toContain(new URL(fake.url).host);
    }
  });

  it("reports a playlist past the size limit as too large", async () => {
    // Announces a body far past the 50 MB playlist limit and never sends it.
    const huge = createServer((_request, response) => {
      response.writeHead(200, { "content-length": String(60 * 1024 * 1024) });
      response.flushHeaders();
    });
    await new Promise<void>((resolve) => huge.listen(0, "127.0.0.1", resolve));
    try {
      const { port } = huge.address() as AddressInfo;
      const result = await admin.request("POST", "/api/sources/test", {
        ...sourceInput(),
        config: { _tag: "M3u", playlistUrl: `http://127.0.0.1:${port}/huge.m3u` },
        headers: {},
      });
      expect(result.status).toBe(502);
      expect(result.json).toMatchObject({ _tag: "SourceFailed", reason: "tooLarge" });
    } finally {
      huge.closeAllConnections();
      await new Promise((resolve) => huge.close(resolve));
    }
  });

  it("reports a failing source as a typed failure and marks its health", async () => {
    const broken = await admin.request("POST", "/api/sources", {
      ...sourceInput(),
      name: "Broken",
      config: { _tag: "M3u", playlistUrl: `${fake.url}/missing.m3u` },
      headers: {},
    });
    const id = (broken.json as { id: string }).id;
    const refresh = await admin.request("POST", `/api/sources/${id}/refresh`);
    expect(refresh.status).toBe(502);
    expect(refresh.json).toMatchObject({
      _tag: "SourceFailed",
      reason: "httpError",
      httpStatus: 404,
    });
    expect((await admin.request("GET", `/api/sources/${id}`)).json).toMatchObject({
      health: "unreachable",
    });
    expect((await admin.request("DELETE", `/api/sources/${id}`)).status).toBe(204);
  });

  it("keys a nameless stream by a hash of its URL, stable across refreshes", async () => {
    const streamUrl = "http://me:pw@cdn.test/live/1.ts?token=abc123";
    const playlist = `#EXTM3U\n#EXTINF:-1,\n#EXTVLCOPT:http-user-agent=VLC/3.0.20\n#EXTVLCOPT:http-referrer=http://portal.test/\n${streamUrl}\n`;
    const nameless = createServer((request, response) => {
      if (request.url?.startsWith("/playlist.m3u") === true) response.end(playlist);
      else response.end("<tv></tv>");
    });
    await new Promise<void>((resolve) => nameless.listen(0, "127.0.0.1", resolve));
    try {
      const { port } = nameless.address() as AddressInfo;
      const created = await admin.request("POST", "/api/sources", {
        ...sourceInput(),
        name: "Nameless",
        config: {
          _tag: "M3u",
          playlistUrl: `http://127.0.0.1:${port}/playlist.m3u`,
          guideUrl: `http://127.0.0.1:${port}/epg.xml`,
        },
        headers: {},
      });
      const id = (created.json as { id: string }).id;
      const streamsOf = () =>
        server.run(
          server.db.read.select().from(sourceStreams).where(eq(sourceStreams.sourceId, id)),
        );
      expect((await admin.request("POST", `/api/sources/${id}/refresh`)).status).toBe(200);
      const [fresh] = await streamsOf();
      expect(fresh?.upstreamId).toMatch(/^url:[\w-]{22}$/);
      expect(fresh?.upstreamId).not.toContain("pw");
      // What the playlist asks to send for the stream is kept for its captures.
      expect(fresh).toMatchObject({ userAgent: "VLC/3.0.20", referrer: "http://portal.test/" });

      expect((await admin.request("POST", `/api/sources/${id}/refresh`)).status).toBe(200);
      const rows = await streamsOf();
      // The row was matched again (kept its id); nothing new was added.
      expect(rows.map((row) => row.id)).toEqual([fresh?.id]);
      expect(rows[0]?.upstreamId).toBe(fresh?.upstreamId);
      const listed = await admin.request("GET", `/api/sources/${id}/streams`);
      expect(listed.json).toMatchObject([{ upstreamId: rows[0]?.upstreamId }]);
      expect(listed.text).not.toContain("pw");
      expect(listed.text).not.toContain("abc123");
      expect(listed.json).toMatchObject([{ name: "http://cdn.test/live/1.ts" }]);
      // The first refresh offered the stream as a channel; the guide tests count only the fake's.
      const offered = ((await admin.request("GET", "/api/channels")).json as Array<Channel>).find(
        (channel) => channel.name === "http://cdn.test/live/1.ts",
      );
      expect(offered).toBeDefined();
      expect((await admin.request("DELETE", `/api/channels/${offered?.id}`)).status).toBe(204);
      expect((await admin.request("DELETE", `/api/sources/${id}`)).status).toBe(204);
    } finally {
      nameless.closeAllConnections();
      await new Promise((resolve) => nameless.close(resolve));
    }
  });
});

const window = (hours: number) => {
  const from = new Date();
  const to = new Date(from.getTime() + hours * 3_600_000);
  return `from=${from.toISOString()}&to=${to.toISOString()}`;
};

describe("channel numbers and logos", () => {
  it("swaps numbers instead of giving two channels the same one", async () => {
    const list = () =>
      admin.request("GET", "/api/channels").then((response) => response.json as Array<Channel>);
    const [first, second] = (await list()).filter((channel) => channel.number !== undefined);
    if (first?.number === undefined || second?.number === undefined) throw new Error("numbers");
    await admin.request("PATCH", `/api/channels/${second.id}`, { number: first.number });
    const after = await list();
    expect(after.find((channel) => channel.id === second.id)?.number).toBe(first.number);
    expect(after.find((channel) => channel.id === first.id)?.number).toBe(second.number);
    const numbers = after.flatMap((channel) =>
      channel.number === undefined ? [] : [channel.number],
    );
    expect(new Set(numbers).size).toBe(numbers.length);
    // Back as they were, for the tests after this one.
    await admin.request("PATCH", `/api/channels/${first.id}`, { number: first.number });
  });

  it("goes back to the automatic logo with null", async () => {
    const channel = (await admin.request("GET", "/api/channels")).json as Array<Channel>;
    const target = channel[0]!;
    await admin.request("PATCH", `/api/channels/${target.id}`, {
      logoUrl: "https://example.org/logo.png",
    });
    const set = (await admin.request("GET", `/api/channels/${target.id}`)).json as Channel;
    expect(set.logoUrl).toBe("https://example.org/logo.png");
    await admin.request("PATCH", `/api/channels/${target.id}`, { logoUrl: null });
    const reset = (await admin.request("GET", `/api/channels/${target.id}`)).json as Channel;
    // The fake source's guide has an icon for every channel, so the guide's icon shows.
    expect(reset.logoUrl).not.toBe("https://example.org/logo.png");
  });
});

describe("guide", () => {
  it("returns a time window without the feed's duplicate programmes", async () => {
    const result = await admin.request("GET", `/api/guide?${window(6)}&channels=${news.id}`);
    expect(result.status).toBe(200);
    const programmes = result.json as Array<Programme>;
    expect(programmes.length).toBeGreaterThan(5);
    expect(programmes.every((programme) => programme.channelId === news.id)).toBe(true);
    const starts = programmes.map((programme) => programme.start);
    expect(new Set(starts).size).toBe(starts.length);
    const now = Date.now();
    expect(programmes.every((programme) => Date.parse(programme.end) > now)).toBe(true);
  });

  it("sends the window as guide entries: the details are in each programme's own answer", async () => {
    const entries = (await admin.request("GET", `/api/guide?${window(6)}&channels=${news.id}`))
      .json as Array<Record<string, unknown>>;
    expect(entries.length).toBeGreaterThan(0);
    for (const entry of entries) {
      expect(entry).not.toHaveProperty("description");
      expect(entry).not.toHaveProperty("imageUrl");
      expect(entry).toHaveProperty("title");
    }
    const described = (
      (await admin.request("GET", `/api/guide/programmes/${String(entries[0]?.["id"])}`))
        .json as Programme
    ).description;
    expect(described).toBeDefined();
  });

  it("knows where the guide data ends", async () => {
    const extent = (await admin.request("GET", "/api/guide/extent")).json as { end?: string };
    const from = new Date(Date.now() - 3_600_000).toISOString();
    const to = new Date(Date.now() + 7 * 86_400_000).toISOString();
    const entries = (await admin.request("GET", `/api/guide?from=${from}&to=${to}`))
      .json as Array<Programme>;
    const last = Math.max(...entries.map((entry) => Date.parse(entry.end)));
    expect(Date.parse(extent.end ?? "")).toBe(last);
  });

  it("validates the window", async () => {
    const to = new Date().toISOString();
    const from = new Date(Date.now() + 3_600_000).toISOString();
    const result = await admin.request("GET", `/api/guide?from=${from}&to=${to}`);
    expect(result.status).toBe(422);
  });

  it("knows what is on now and next on every channel", async () => {
    const rows = (await admin.request("GET", "/api/guide/now-next")).json as Array<{
      channelId: string;
      now?: Programme;
      next?: Programme;
    }>;
    expect(rows).toHaveLength(9);
    const row = rows.find((candidate) => candidate.channelId === news.id);
    expect(Date.parse(row!.now!.start)).toBeLessThanOrEqual(Date.now());
    expect(Date.parse(row!.next!.start)).toBeGreaterThan(Date.now());
  });

  it("searches titles and descriptions by word prefix", async () => {
    const results = (await admin.request("GET", "/api/guide/search?q=wett")).json as Array<
      Programme & { readonly subtitle?: string; readonly description?: string }
    >;
    expect(results.length).toBeGreaterThan(0);
    for (const result of results) {
      const text =
        `${result.title} ${result.subtitle ?? ""} ${result.description ?? ""}`.toLowerCase();
      expect(text).toMatch(/\bwett/);
    }
    const weather = results.find((programme) => programme.title === "Wetter")!;
    const programme = await admin.request("GET", `/api/guide/programmes/${weather.id}`);
    expect(programme.json).toMatchObject({ title: "Wetter", channelId: news.id });
    expect((await admin.request("GET", "/api/guide/programmes/nope")).status).toBe(404);
  });
});

const weatherRule = () => ({
  name: "Weather",
  enabled: true,
  matcher: {
    channels: [news.id],
    title: [{ _tag: "IsExactly", values: ["Wetter"] }],
    categories: [],
    weekdays: [],
  },
  padding: { beforeMinutes: 1, afterMinutes: 2 },
  retention: { _tag: "KeepNewest", count: 3 },
});

describe("rules and recordings", () => {
  it("previews what a draft rule would record, with padded ranges", async () => {
    const until = new Date(Date.now() + 6 * 3_600_000).toISOString();
    const preview = await admin.request("POST", "/api/rules/preview", {
      rule: weatherRule(),
      until,
    });
    expect(preview.status).toBe(200);
    const { matches } = preview.json as {
      matches: Array<{
        programme: Programme;
        range: { start: string; end: string };
        skip?: { _tag: string };
      }>;
    };
    expect(matches.length).toBeGreaterThanOrEqual(5);
    for (const match of matches) {
      expect(match.programme.title).toBe("Wetter");
      expect(Date.parse(match.programme.start) - Date.parse(match.range.start)).toBe(60_000);
      expect(Date.parse(match.range.end) - Date.parse(match.programme.end)).toBe(120_000);
      expect(match.skip).toBeUndefined();
    }
  });

  it("refuses a rule that would match the whole guide", async () => {
    const result = await admin.request("POST", "/api/rules", {
      ...weatherRule(),
      matcher: { channels: [], title: [], categories: [], weekdays: [] },
    });
    expect(result.status).toBe(422);
    expect(result.json).toMatchObject({ problems: [{ code: "matchesEverything" }] });
  });

  it("schedules matching programmes when a rule is saved, grouped in the library", async () => {
    const created = await admin.request("POST", "/api/rules", weatherRule());
    expect(created.status).toBe(200);
    const ruleId = (created.json as { id: string }).id;
    const recordings = (await admin.request("GET", `/api/recordings?ruleId=${ruleId}`))
      .json as Array<{
      title: string;
      state: string;
      group: { source: string; folders: Array<{ _tag: string; text?: string }> };
      padding: { beforeMinutes: number; afterMinutes: number };
    }>;
    expect(recordings.length).toBeGreaterThan(10);
    expect(recordings.every((recording) => recording.title === "Wetter")).toBe(true);
    expect(recordings.some((recording) => recording.state === "scheduled")).toBe(true);
    expect(recordings[0]?.padding).toEqual({ beforeMinutes: 1, afterMinutes: 2 });
    expect(recordings[0]?.group.source).toBe("title");
    expect(recordings[0]?.group.folders[0]).toEqual({ _tag: "Text", text: "Wetter" });

    // Already scheduled airings show up as duplicates in a preview now.
    const preview = (await admin.request("POST", "/api/rules/preview", { rule: weatherRule() }))
      .json as { matches: Array<{ skip?: { _tag: string } }> };
    expect(preview.matches.every((match) => match.skip?._tag === "SameAiring")).toBe(true);
  });

  it("places recordings in a collection and explains why", async () => {
    const draft = {
      name: "Wetterdienst",
      rank: 0,
      matcher: {
        channels: [],
        title: [{ _tag: "StartsWith", values: ["Wett"] }],
        categories: [],
        weekdays: [],
      },
      labels: [],
      layout: { parts: [], path: ["{year}", "{date}"] },
    };
    const preview = (await admin.request("POST", "/api/collections/preview", { collection: draft }))
      .json as {
      recordings: Array<{ group: { folders: Array<{ text?: string }> } }>;
      overlaps: Array<unknown>;
    };
    expect(preview.recordings.length).toBeGreaterThan(0);
    expect(preview.recordings[0]?.group.folders[0]).toEqual({ _tag: "Text", text: "Wetterdienst" });
    expect(preview.overlaps).toEqual([]);

    const created = await admin.request("POST", "/api/collections", draft);
    expect(created.status).toBe(200);
    collectionId = (created.json as { id: string }).id;
    const inCollection = (
      await admin.request("GET", `/api/recordings?collectionId=${collectionId}`)
    ).json as Array<{
      placement: {
        collectionId: string;
        reason: string;
        criteria: Array<{ _tag: string; value?: string }>;
      };
    }>;
    expect(inCollection.length).toBeGreaterThan(0);
    expect(inCollection[0]?.placement).toMatchObject({
      collectionId,
      reason: "only",
      criteria: [{ _tag: "Title", condition: "StartsWith", value: "Wett" }],
    });

    const invalid = await admin.request("POST", "/api/collections", {
      ...draft,
      layout: { parts: [], path: ["{nonsense}"] },
    });
    expect(invalid.status).toBe(422);
    expect(invalid.json).toMatchObject({ problems: [{ code: "unknownVariable" }] });
  });

  it("moves a rule back to Automatic when the update sends collectionId null", async () => {
    const created = await admin.request("POST", "/api/rules", {
      ...weatherRule(),
      name: "Weather in a collection",
      collectionId,
    });
    expect(created.status).toBe(200);
    const ruleId = (created.json as { id: string }).id;
    const renamed = await admin.request("PATCH", `/api/rules/${ruleId}`, { name: "Kept" });
    expect(renamed.json).toMatchObject({ name: "Kept", collectionId });
    const automatic = await admin.request("PATCH", `/api/rules/${ruleId}`, { collectionId: null });
    expect(automatic.status).toBe(200);
    expect(automatic.json).not.toHaveProperty("collectionId");
    const stored = await admin.request("GET", `/api/rules/${ruleId}`);
    expect(stored.json).not.toHaveProperty("collectionId");
    await admin.request("DELETE", `/api/rules/${ruleId}`);
  });

  it("records a guide programme once, however often it is requested", async () => {
    // Far enough ahead that the five minutes of padding added below cannot start the capture.
    const earliest = Date.now() + 15 * 60_000;
    const upcoming = (await admin.request("GET", `/api/guide?${window(6)}`))
      .json as Array<Programme>;
    const programme = upcoming.find(
      (candidate) => candidate.channelId !== news.id && Date.parse(candidate.start) > earliest,
    )!;
    const first = await admin.request("POST", "/api/recordings", {
      _tag: "Programme",
      programmeId: programme.id,
    });
    expect(first.status).toBe(200);
    const recording = first.json as {
      id: string;
      padding: unknown;
      ownerIds: Array<string>;
      state: string;
    };
    expect(recording.padding).toEqual({ beforeMinutes: 2, afterMinutes: 10 });
    expect(recording.state).toBe("scheduled");
    const again = await admin.request("POST", "/api/recordings", {
      _tag: "Programme",
      programmeId: programme.id,
    });
    expect((again.json as { id: string }).id).toBe(recording.id);

    const update = await admin.request("PATCH", `/api/recordings/${recording.id}`, {
      protected: true,
      labels: ["keep", "keep", " "],
      padding: { beforeMinutes: 5, afterMinutes: 30 },
    });
    expect(update.json).toMatchObject({
      protected: true,
      labels: ["keep"],
      padding: { beforeMinutes: 5, afterMinutes: 30 },
    });

    // Moved into the weather collection by hand: "also move similar ones" widens its matcher.
    const similar = await admin.request(
      "POST",
      `/api/collections/${collectionId}/similar/preview`,
      { recordingId: recording.id },
    );
    expect(similar.status).toBe(200);
    const preview = similar.json as {
      extension: { _tag: string; changes?: Array<{ _tag: string }> };
      past: Array<unknown>;
      future: Array<{ title: string; recordingId?: string; programmeId?: string }>;
    };
    expect(preview.extension._tag).toBe("Extended");
    expect(preview.extension.changes?.map((change) => change._tag)).toContain("AddTitleValue");
    expect(preview.future.map((item) => item.recordingId)).toContain(recording.id);
    const moved = await admin.request("POST", `/api/collections/${collectionId}/similar`, {
      recordingId: recording.id,
    });
    expect(moved.status).toBe(200);
    const values = (moved.json as { matcher: { title: Array<{ values: Array<string> }> } }).matcher
      .title[0]?.values;
    expect(values?.length).toBeGreaterThan(1);
    expect((await admin.request("GET", `/api/recordings/${recording.id}`)).json).toMatchObject({
      placement: { collectionId },
    });
    // Nothing has finished yet, so retention has nothing to delete.
    expect((await admin.request("GET", "/api/recordings/retention")).json).toEqual([]);

    const stop = await admin.request("POST", `/api/recordings/${recording.id}/stop`);
    expect(stop.status).toBe(409);
    expect(stop.json).toMatchObject({ code: "notRecording" });
    expect((await admin.request("DELETE", `/api/recordings/${recording.id}`)).status).toBe(204);
    expect((await admin.request("GET", `/api/recordings/${recording.id}`)).status).toBe(404);
  });

  it("finds no conflicts while sources have no stream limit", async () => {
    const from = new Date().toISOString();
    const to = new Date(Date.now() + 86_400_000).toISOString();
    const conflicts = await admin.request("GET", `/api/recordings/conflicts?from=${from}&to=${to}`);
    expect(conflicts.status).toBe(200);
    expect(conflicts.json).toEqual([]);
  });
});
