/**
 * Channel management through the HTTP API: importing small and big playlists (copies of one
 * channel become one channel), new streams joining channels by guide id on refresh, gone
 * streams, fixed numbers, gentle remove (recordings survive), merge, split and the stream picker.
 * Playlists come from a local HTTP server whose content each test sets.
 */
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { StatementSync } from "node:sqlite";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ChannelId, defaultLayout } from "@slipstream/domain";
import {
  captures,
  channels,
  collections,
  episodeHistory,
  programmes,
  recordings,
  rules,
  users,
} from "../src/db/schema.ts";
import { Browser, startTestServer, type TestServer } from "./harness.ts";

interface Entry {
  readonly name: string;
  readonly tvgId?: string;
  readonly chno?: number;
  readonly group?: string;
}
interface Channel {
  readonly id: string;
  readonly name: string;
  readonly number?: number;
  readonly guideChannelId?: string;
  readonly favourite: boolean;
}
interface StreamEntry {
  readonly id: string;
  readonly name: string;
  readonly group?: string;
  readonly quality: string;
  readonly channel?: { id: string; name: string };
  readonly match?: { channelId: string; name: string; reason: string };
  readonly new: boolean;
  readonly ignored: boolean;
  readonly gone: boolean;
}

const playlists = new Map<string, ReadonlyArray<Entry>>();
const guides = new Map<string, ReadonlyArray<string>>();
let feed: Server;
let feedUrl: string;
let server: TestServer;
let admin: Browser;

const m3u = (entries: ReadonlyArray<Entry>) =>
  [
    "#EXTM3U",
    ...entries.flatMap((entry, index) => [
      `#EXTINF:-1${entry.tvgId === undefined ? "" : ` tvg-id="${entry.tvgId}"`}${entry.chno === undefined ? "" : ` tvg-chno="${entry.chno}"`}${entry.group === undefined ? "" : ` group-title="${entry.group}"`},${entry.name}`,
      `http://streams.test/${encodeURIComponent(entry.name)}/${index}.ts`,
    ]),
  ].join("\n");

const xmltv = (ids: ReadonlyArray<string>) =>
  `<?xml version="1.0"?><tv>${ids.map((id) => `<channel id="${id}"><display-name>${id}</display-name></channel>`).join("")}</tv>`;

beforeAll(async () => {
  feed = createServer((request, response) => {
    const [, kind = "", name = ""] = /^\/(playlist|guide)\/([^/]+)$/.exec(request.url ?? "") ?? [];
    response.writeHead(200);
    response.end(
      kind === "playlist" ? m3u(playlists.get(name) ?? []) : xmltv(guides.get(name) ?? []),
    );
  });
  await new Promise<void>((resolve) => feed.listen(0, "127.0.0.1", resolve));
  feedUrl = `http://127.0.0.1:${(feed.address() as AddressInfo).port}`;
  server = await startTestServer();
  admin = new Browser(server.url);
  await admin.request("POST", "/api/auth/setup", {
    username: "admin",
    displayName: "Admin",
    password: "correct horse battery staple",
  });
});

afterAll(async () => {
  await server?.close();
  await new Promise((resolve) => feed?.close(resolve));
});

const call = async <A>(method: string, path: string, body?: unknown): Promise<A> => {
  const result = await admin.request(method, path, body);
  if (result.status >= 300) {
    throw new Error(`${method} ${path}: ${result.status} ${result.text}`);
  }
  return result.json as A;
};

const addSource = async (name: string) => {
  const source = await call<{ id: string }>("POST", "/api/sources", {
    name,
    config: {
      _tag: "M3u",
      playlistUrl: `${feedUrl}/playlist/${name}`,
      guideUrl: `${feedUrl}/guide/${name}`,
    },
    refreshIntervalMinutes: 60,
    headers: {},
    guideCleanup: { removeDuplicates: true, rewrites: [] },
    enabled: true,
  });
  return source.id;
};

const refresh = (sourceId: string) => call("POST", `/api/sources/${sourceId}/refresh`);
const lineup = () => call<Array<Channel>>("GET", "/api/channels?includeHidden=true");
const byName = async (name: string) => {
  const channel = (await lineup()).find((entry) => entry.name === name);
  if (channel === undefined) throw new Error(`no channel ${name}`);
  return channel;
};
/** Stream names of a channel in fallback order. */
const streamNames = async (channelId: string, sourceIds: ReadonlyArray<string>) => {
  const links = await call<Array<{ sourceStreamId: string }>>(
    "GET",
    `/api/channels/${channelId}/streams`,
  );
  const names = new Map<string, string>();
  for (const sourceId of sourceIds) {
    const page = await call<{ streams: Array<StreamEntry> }>(
      "GET",
      `/api/sources/${sourceId}/catalogue?limit=5000`,
    );
    for (const stream of page.streams) names.set(stream.id, stream.name);
  }
  return links.map((link) => names.get(link.sourceStreamId));
};
interface Review {
  readonly mergeSuggestions: ReadonlyArray<{
    readonly channels: ReadonlyArray<{
      readonly id: string;
      readonly name: string;
      readonly number?: number;
      readonly streams: ReadonlyArray<{ readonly name: string; readonly sourceName: string }>;
    }>;
    readonly reason: string;
  }>;
  readonly goneStreams: ReadonlyArray<{
    readonly name: string;
    readonly channel: { readonly name: string };
    readonly playsFrom?: string;
  }>;
  readonly withoutStreams: ReadonlyArray<{ readonly name: string }>;
}
const catalogue = (sourceId: string, query = "") =>
  call<{ total: number; streams: Array<StreamEntry> }>(
    "GET",
    `/api/sources/${sourceId}/catalogue?limit=5000${query}`,
  );

let small: string;
let big: string;

describe("importing a small playlist", () => {
  it("makes one channel of each channel's copies, best quality first, numbered", async () => {
    small = await addSource("small");
    playlists.set("small", [
      { name: "Das Erste HD", tvgId: "DasErste.de", chno: 1, group: "Vollprogramm" },
      { name: "DE: Das Erste SD", tvgId: "DasErste.de", group: "Vollprogramm" },
      { name: "ARD Das Erste FHD", group: "Vollprogramm" },
      { name: "ZDF", tvgId: "ZDF.de", chno: 2, group: "Vollprogramm" },
      { name: "ZDF HD", group: "Vollprogramm" },
      { name: "kabel eins", chno: 2, group: "Privat" },
      { name: "Kabel 1", group: "Privat" },
    ]);
    guides.set("small", ["DasErste.de", "ZDF.de"]);
    await refresh(small);

    const imported = await lineup();
    expect(imported.map((channel) => [channel.name, channel.number])).toEqual([
      ["ARD Das Erste FHD", 1],
      ["ZDF HD", 2],
      ["kabel eins", 3],
      ["Kabel 1", 4],
    ]);
    const erste = await byName("ARD Das Erste FHD");
    expect(erste.guideChannelId).toBe("DasErste.de");
    expect(await streamNames(erste.id, [small])).toEqual([
      "ARD Das Erste FHD",
      "Das Erste HD",
      "DE: Das Erste SD",
    ]);
    expect(await streamNames((await byName("ZDF HD")).id, [small])).toEqual(["ZDF HD", "ZDF"]);
    // Everything was added; nothing waits for review.
    const page = await catalogue(small);
    expect(page.streams.every((stream) => stream.channel !== undefined && !stream.new)).toBe(true);
  });

  it("attaches new streams with a channel's guide id on refresh and leaves the rest new", async () => {
    playlists.set("small", [
      ...(playlists.get("small") ?? []).filter((entry) => entry.name !== "Kabel 1"),
      { name: "Das Erste UHD", tvgId: "DasErste.de", group: "Vollprogramm" },
      { name: "Sport1", group: "Sport" },
    ]);
    await refresh(small);
    expect(await lineup()).toHaveLength(4);
    const erste = await byName("ARD Das Erste FHD");
    expect((await streamNames(erste.id, [small])).at(-1)).toBe("Das Erste UHD");

    const page = await catalogue(small);
    const sport = page.streams.find((stream) => stream.name === "Sport1");
    expect(sport).toMatchObject({ new: true, gone: false, ignored: false });
    expect(sport?.channel).toBeUndefined();
    // Kabel 1 left the playlist; its channel keeps the stream and shows it as gone.
    expect(page.streams.find((stream) => stream.name === "Kabel 1")).toMatchObject({
      gone: true,
      channel: { name: "Kabel 1" },
    });

    const review = await call<{
      sources: Array<{ sourceId: string; newStreams: number; goneStreams: number }>;
      goneStreams: Array<{ name: string; channel: { name: string } }>;
      withoutStreams: Array<{ name: string }>;
    }>("GET", "/api/channels/review");
    expect(review.sources.find((source) => source.sourceId === small)).toMatchObject({
      newStreams: 1,
      goneStreams: 1,
    });
    expect(review.goneStreams).toEqual([
      expect.objectContaining({
        name: "Kabel 1",
        channel: expect.objectContaining({ name: "Kabel 1" }),
      }),
    ]);
    expect(review.withoutStreams.map((channel) => channel.name)).toEqual(["Kabel 1"]);

    // Marking the source reviewed clears "new".
    await call("POST", `/api/sources/${small}/reviewed`);
    expect((await catalogue(small, "&filter=new")).total).toBe(0);
  });
});

describe("importing a big playlist", () => {
  it("creates no channels, but streams with a channel's guide id join it", async () => {
    big = await addSource("big");
    const entries: Array<Entry> = Array.from({ length: 150 }, (_, index) => ({
      name: `Kanal ${index + 1}`,
      group: index < 100 ? "DE | Regional" : "AT | Österreich",
      ...(index % 2 === 0 ? { tvgId: `kanal${index + 1}.de` } : {}),
    }));
    entries.push({ name: "ZDF FHD", tvgId: "ZDF.de", group: "DE | Vollprogramm" });
    entries.push({ name: "Das Erste 4K", group: "DE | Vollprogramm" });
    playlists.set("big", entries);
    guides.set("big", [
      "ZDF.de",
      ...Array.from({ length: 50 }, (_, index) => `kanal${index * 2 + 1}.de`),
    ]);
    const before = (await lineup()).length;
    await refresh(big);
    expect(await lineup()).toHaveLength(before);

    const zdf = await byName("ZDF HD");
    expect((await streamNames(zdf.id, [small, big])).at(-1)).toBe("ZDF FHD");

    const page = await catalogue(big);
    expect(page.total).toBe(152);
    expect(page.streams.filter((stream) => stream.new)).toHaveLength(151);
    // Not added, but looks like an existing channel by name.
    expect(page.streams.find((stream) => stream.name === "Das Erste 4K")).toMatchObject({
      quality: "uhd",
      match: { name: "ARD Das Erste FHD", reason: "similarName" },
    });

    const groups = await call<
      Array<{
        name?: string;
        streams: number;
        withGuide: number;
        guideCoverage: number;
        added: number;
      }>
    >("GET", `/api/sources/${big}/groups`);
    expect(groups).toEqual([
      expect.objectContaining({ name: "AT | Österreich", streams: 50, withGuide: 0, added: 0 }),
      expect.objectContaining({
        name: "DE | Regional",
        streams: 100,
        withGuide: 50,
        guideCoverage: 50,
      }),
      expect.objectContaining({ name: "DE | Vollprogramm", streams: 2, added: 1 }),
    ]);
    const regional = await call<{ total: number; streams: Array<StreamEntry> }>(
      "GET",
      `/api/sources/${big}/catalogue?group=${encodeURIComponent("DE | Regional")}&offset=10&limit=5`,
    );
    expect(regional.total).toBe(100);
    expect(regional.streams).toHaveLength(5);
  });

  it("adds chosen streams: copies become one channel, a guide match joins its channel", async () => {
    playlists.set("big", [
      ...(playlists.get("big") ?? []),
      { name: "Phoenix HD", tvgId: "phoenix.de", chno: 4, group: "DE | Info" },
      { name: "DE: Phoenix SD", group: "DE | Info" },
      { name: "Erstes", tvgId: "DasErste.de", group: "DE | Info" },
    ]);
    await refresh(big);
    // "Erstes" joined Das Erste on refresh already (same guide id).
    const erste = await byName("ARD Das Erste FHD");
    expect((await streamNames(erste.id, [small, big])).at(-1)).toBe("Erstes");

    const page = await catalogue(big);
    const ids = page.streams
      .filter((stream) => ["DE: Phoenix SD", "Phoenix HD", "Kanal 1"].includes(stream.name))
      .map((stream) => stream.id);
    const added = await call<{ created: Array<Channel> }>(
      "POST",
      `/api/sources/${big}/streams/add`,
      {
        streamIds: ids,
      },
    );
    // Number 4 is held by Kabel 1, so Phoenix goes after the highest number.
    // Phoenix's group comes first in the picker's order, so it is numbered first.
    expect(added.created.map((channel) => [channel.name, channel.number])).toEqual([
      ["Phoenix HD", 5],
      ["Kanal 1", 6],
    ]);
    const phoenix = await byName("Phoenix HD");
    expect(await streamNames(phoenix.id, [big])).toEqual(["Phoenix HD", "DE: Phoenix SD"]);

    const foreign = await admin.request("POST", `/api/sources/${big}/streams/add`, {
      streamIds: [(await catalogue(small)).streams[0]?.id],
    });
    expect(foreign.status).toBe(422);
  });

  it("ignores streams and takes them back", async () => {
    const [first] = (await catalogue(big, "&filter=notAdded")).streams;
    await call("POST", `/api/sources/${big}/streams/ignore`, {
      streamIds: [first?.id],
      ignored: true,
    });
    expect((await catalogue(big, "&filter=ignored")).streams.map((stream) => stream.id)).toEqual([
      first?.id,
    ]);
    await call("POST", `/api/sources/${big}/streams/ignore`, {
      streamIds: [first?.id],
      ignored: false,
    });
    expect((await catalogue(big, "&filter=ignored")).total).toBe(0);
  });
});

describe("adding new streams automatically", () => {
  it("adds new streams of groups that already have channels when the source asks for it", async () => {
    const source = await call<{ autoAddNew: boolean }>("PATCH", `/api/sources/${big}`, {
      autoAddNew: true,
    });
    expect(source.autoAddNew).toBe(true);
    playlists.set("big", [
      ...(playlists.get("big") ?? []),
      { name: "tagesschau24", group: "DE | Info" },
      { name: "ORF 1", group: "AT | Österreich" },
    ]);
    await refresh(big);
    const names = (await lineup()).map((channel) => channel.name);
    expect(names).toContain("tagesschau24");
    expect(names).not.toContain("ORF 1");
    await call("PATCH", `/api/sources/${big}`, { autoAddNew: false });
  });
});

describe("the stream listing", () => {
  it("reads a few thousand streams with as many statements as a handful", async () => {
    const huge = await addSource("huge");
    playlists.set(
      "huge",
      Array.from({ length: 4000 }, (_, index) => ({
        name: `Stream ${index}`,
        tvgId: `s${index}`,
        group: `Gruppe ${index % 40}`,
      })),
    );
    await refresh(huge);
    const tiny = await addSource("tiny");
    playlists.set("tiny", [
      { name: "Ein Kanal", group: "A" },
      { name: "Zwei Kanal", group: "A" },
    ]);
    guides.set("tiny", []);
    await call("POST", `/api/sources/${tiny}/refresh`);
    await call("POST", "/api/channels/remove", {
      ids: (await lineup()).filter((channel) => channel.name.endsWith("Kanal")).map((c) => c.id),
    });

    /** Counts SQL statements run while the server answers `path`. */
    const statements = async (path: string) => {
      const methods = ["all", "get", "run", "iterate"];
      const originals = methods.map((method): unknown =>
        Reflect.get(StatementSync.prototype, method),
      );
      let count = 0;
      methods.forEach((method, index) => {
        const original = originals[index];
        if (typeof original !== "function") return;
        Reflect.set(
          StatementSync.prototype,
          method,
          function (this: unknown, ...args: Array<unknown>) {
            count += 1;
            return Reflect.apply(original, this, args);
          },
        );
      });
      try {
        const started = performance.now();
        const page = await call<{ total: number }>("GET", path);
        return { count, page, millis: performance.now() - started };
      } finally {
        methods.forEach((method, index) => {
          Reflect.set(StatementSync.prototype, method, originals[index]);
        });
      }
    };
    const few = await statements(`/api/sources/${tiny}/catalogue`);
    const many = await statements(`/api/sources/${huge}/catalogue?limit=5000`);
    expect(few.count).toBeGreaterThan(0);
    expect(few.page.total).toBe(2);
    expect(many.page.total).toBe(4000);
    expect(many.count).toBe(few.count);
    expect(many.millis).toBeLessThan(3000);
  });
});

describe("numbers", () => {
  it("moves the holder of a taken number to the next free one, nothing else", async () => {
    const before = await lineup();
    const kabel = await byName("kabel eins");
    const after = await call<Array<Channel>>("PUT", `/api/channels/${kabel.id}/number`, {
      number: 1,
    });
    const numbers = new Map(after.map((channel) => [channel.name, channel.number]));
    expect(numbers.get("kabel eins")).toBe(1);
    // Das Erste had 1; 2 is ZDF's, 3 is free since kabel eins left it.
    expect(numbers.get("ARD Das Erste FHD")).toBe(3);
    for (const channel of before) {
      if (["kabel eins", "ARD Das Erste FHD"].includes(channel.name)) continue;
      expect(numbers.get(channel.name)).toBe(channel.number);
    }
    // The lineup is in number order.
    const sorted = after.map((channel) => channel.number ?? Infinity);
    expect(sorted).toEqual(sorted.toSorted((a, b) => a - b));
  });

  it("moves several channels to a run and keeps numbers unique, also through update", async () => {
    const zdf = await byName("ZDF HD");
    const phoenix = await byName("Phoenix HD");
    const after = await call<Array<Channel>>("POST", "/api/channels/numbers", {
      ids: [phoenix.id, zdf.id],
      start: 10,
    });
    const numbers = new Map(after.map((channel) => [channel.name, channel.number]));
    expect([numbers.get("Phoenix HD"), numbers.get("ZDF HD")]).toEqual([10, 11]);
    await call("PATCH", `/api/channels/${zdf.id}`, { number: 10 });
    const again = await lineup();
    const taken = again.flatMap((channel) =>
      channel.number === undefined ? [] : [channel.number],
    );
    expect(new Set(taken).size).toBe(taken.length);
    expect(again.find((channel) => channel.id === zdf.id)?.number).toBe(10);
    expect(again.find((channel) => channel.id === phoenix.id)?.number).toBe(11);
  });
});

/** Seeds a recording on a channel, as planning would have made it. */
const seedRecording = (id: string, channelId: string) =>
  server.run(
    server.db.write.insert(recordings).values({
      id,
      channelId,
      start: 0,
      end: 1,
      title: "Tatort",
      categories: [],
      repeat: false,
      live: false,
      paddingBeforeMinutes: 0,
      paddingAfterMinutes: 0,
      state: "completed",
      problems: [],
      protected: false,
      exportStatus: "none",
      createdAt: 0,
    }),
  );

const adminId = async () => {
  const [row] = await server.run(server.db.read.select({ id: users.id }).from(users));
  return row?.id ?? "";
};

describe("removing", () => {
  // First: recordings seeded below have no owner, and the scheduler reads every recording.
  it("cancels one-off recordings still scheduled on it and says so beforehand", async () => {
    const created = await call<Channel>("POST", "/api/channels", {
      name: "Short lived",
      favourite: false,
      hidden: false,
    });
    const later = Date.now() + 6 * 3_600_000;
    const scheduled = await call<{ id: string; state: string }>("POST", "/api/recordings", {
      _tag: "Manual",
      channelId: created.id,
      range: {
        start: new Date(later).toISOString(),
        end: new Date(later + 3_600_000).toISOString(),
      },
      title: "Late film",
    });
    expect(scheduled.state).toBe("scheduled");

    const preview = await call<{ scheduledRecordings: number }>(
      "POST",
      "/api/channels/remove/preview",
      { ids: [created.id] },
    );
    expect(preview).toEqual({ scheduledRecordings: 1 });

    const removed = await admin.request("POST", "/api/channels/remove", { ids: [created.id] });
    expect(removed.status).toBe(204);
    const rows = await server.run(
      server.db.read
        .select({ id: recordings.id, state: recordings.state })
        .from(recordings)
        .where(eq(recordings.channelId, created.id)),
    );
    // Cancelled, not deleted: it stays in the library's history like any cancelled recording.
    expect(rows).toEqual([{ id: scheduled.id, state: "cancelled" }]);
  });

  it("keeps recordings, captures and the row; the streams go back to the pool for good", async () => {
    const kabel = await byName("Kabel 1");
    await seedRecording("kept", kabel.id);
    await server.run(
      server.db.write.insert(captures).values({
        id: "capture",
        channelId: kabel.id,
        sourceStreamId: "x",
        startedAt: 0,
        state: "stopped",
        stats: { bytes: 0, segments: 0, reconnects: 0 },
        directory: "capture",
      }),
    );
    const removed = await admin.request("DELETE", `/api/channels/${kabel.id}`);
    expect(removed.status).toBe(204);

    const [recording] = await server.run(
      server.db.read.select().from(recordings).where(eq(recordings.id, "kept")),
    );
    expect(recording?.channelId).toBe(kabel.id);
    const [capture] = await server.run(
      server.db.read.select().from(captures).where(eq(captures.id, "capture")),
    );
    expect(capture).toBeDefined();
    const [row] = await server.run(
      server.db.read.select().from(channels).where(eq(channels.id, kabel.id)),
    );
    expect(row?.removedAt).not.toBeNull();
    expect((await lineup()).some((channel) => channel.id === kabel.id)).toBe(false);
    expect((await admin.request("GET", `/api/channels/${kabel.id}`)).status).toBe(404);

    // Its stream is in the pool again and a refresh does not bring the channel back.
    const back = { name: "Kabel 1", group: "Privat" };
    playlists.set("small", [...(playlists.get("small") ?? []), back]);
    await refresh(small);
    const stream = (await catalogue(small)).streams.find((entry) => entry.name === "Kabel 1");
    expect(stream?.channel).toBeUndefined();
    expect((await lineup()).some((channel) => channel.name === "Kabel 1")).toBe(false);
  });
});

describe("merging and splitting", () => {
  it("previews and moves streams, recordings, history and rules to the kept channel", async () => {
    const keep = await byName("ZDF HD");
    const other = await byName("kabel eins");
    const owner = await adminId();
    await seedRecording("on-other", other.id);
    const matcher = {
      channels: [ChannelId.make(other.id), ChannelId.make(keep.id)],
      title: [],
      categories: [],
      weekdays: [],
    };
    await server.run(
      server.db.write.insert(rules).values({
        id: "rule",
        name: "Tatort",
        enabled: true,
        ownerId: owner,
        matcher,
        paddingBeforeMinutes: 0,
        paddingAfterMinutes: 0,
        retention: { _tag: "KeepAll" },
        createdAt: 0,
      }),
    );
    await server.run(
      server.db.write.insert(collections).values({
        id: "collection",
        name: "Krimis",
        rank: 0,
        matcher: { ...matcher, channels: [ChannelId.make(other.id)] },
        labels: [],
        layout: defaultLayout,
      }),
    );
    await server.run(
      server.db.write.insert(episodeHistory).values({
        id: "history",
        userId: owner,
        showKey: "tatort",
        class: "Episode",
        airedAt: 0,
        channelId: other.id,
        title: "Tatort",
        createdAt: 0,
      }),
    );
    await call("PATCH", `/api/channels/${other.id}`, { favourite: true });
    const keepStreams = await streamNames(keep.id, [small, big]);
    const otherStreams = await streamNames(other.id, [small, big]);

    const preview = await call<{
      recordings: number;
      seriesRecordings: number;
      collections: number;
      streams: number;
    }>("POST", "/api/channels/merge/preview", { keepId: keep.id, otherIds: [other.id] });
    expect(preview).toMatchObject({
      recordings: 1,
      seriesRecordings: 1,
      collections: 1,
      streams: 1,
    });

    const merged = await call<Channel>("POST", "/api/channels/merge", {
      keepId: keep.id,
      otherIds: [other.id],
    });
    expect(merged.favourite).toBe(true);
    expect(await streamNames(keep.id, [small, big])).toEqual([...keepStreams, ...otherStreams]);
    const [recording] = await server.run(
      server.db.read.select().from(recordings).where(eq(recordings.id, "on-other")),
    );
    expect(recording?.channelId).toBe(keep.id);
    const [rule] = await server.run(
      server.db.read.select().from(rules).where(eq(rules.id, "rule")),
    );
    expect(rule?.matcher.channels).toEqual([keep.id]);
    const [collection] = await server.run(
      server.db.read.select().from(collections).where(eq(collections.id, "collection")),
    );
    expect(collection?.matcher.channels).toEqual([keep.id]);
    const [history] = await server.run(
      server.db.read.select().from(episodeHistory).where(eq(episodeHistory.id, "history")),
    );
    expect(history?.channelId).toBe(keep.id);
    const [gone] = await server.run(
      server.db.read.select().from(channels).where(eq(channels.id, other.id)),
    );
    expect(gone).toMatchObject({ mergedInto: keep.id });
    expect(gone?.removedAt).not.toBeNull();

    const again = await admin.request("POST", "/api/channels/merge", {
      keepId: keep.id,
      otherIds: [keep.id],
    });
    expect(again.status).toBe(422);
  });

  it("splits one stream out into a channel of its own", async () => {
    const zdf = await byName("ZDF HD");
    const links = await call<Array<{ sourceStreamId: string }>>(
      "GET",
      `/api/channels/${zdf.id}/streams`,
    );
    const page = await catalogue(small);
    const plain = page.streams.find((stream) => stream.name === "ZDF");
    const split = await call<Channel>("POST", `/api/channels/${zdf.id}/split`, {
      sourceStreamId: plain?.id,
    });
    expect(split.name).toBe("ZDF");
    expect(split.guideChannelId).toBe("ZDF.de");
    const after = await call<Array<{ sourceStreamId: string }>>(
      "GET",
      `/api/channels/${zdf.id}/streams`,
    );
    expect(after).toHaveLength(links.length - 1);
    expect(after.map((link) => link.sourceStreamId)).not.toContain(plain?.id);

    // Both carry ZDF.de, but split apart on purpose: never suggested back.
    const review = await call<Review>("GET", "/api/channels/review");
    expect(
      review.mergeSuggestions.some((suggestion) =>
        suggestion.channels.some((channel) => channel.id === split.id),
      ),
    ).toBe(false);
  });
});

describe("needs review", () => {
  it("names suggested channels' streams and sources; 'Not the same' sticks", async () => {
    const first = await addSource("dup-a");
    playlists.set("dup-a", [
      { name: "Tele 5 HD", group: "Privat" },
      { name: "Nitro HD", group: "Privat" },
    ]);
    await refresh(first);
    const second = await addSource("dup-b");
    playlists.set("dup-b", [
      { name: "DE: Tele 5 FHD", group: "DE" },
      { name: "DE: Nitro", group: "DE" },
    ]);
    await refresh(second);
    const tele5 = await byName("Tele 5 HD");
    const copy = await byName("DE: Tele 5 FHD");
    const suggestionOf = (review: Review, id: string) =>
      review.mergeSuggestions.find((suggestion) =>
        suggestion.channels.some((channel) => channel.id === id),
      );

    const before = await call<Review>("GET", "/api/channels/review");
    expect(suggestionOf(before, tele5.id)).toEqual({
      channels: [
        {
          id: tele5.id,
          name: "Tele 5 HD",
          number: tele5.number,
          streams: [{ name: "Tele 5 HD", sourceName: "dup-a" }],
        },
        {
          id: copy.id,
          name: "DE: Tele 5 FHD",
          number: copy.number,
          streams: [{ name: "DE: Tele 5 FHD", sourceName: "dup-b" }],
        },
      ],
      reason: "similarName",
    });

    const tooFew = await admin.request("POST", "/api/channels/apart", { ids: [tele5.id] });
    expect(tooFew.status).toBe(422);
    expect(
      (await admin.request("POST", "/api/channels/apart", { ids: [tele5.id, copy.id] })).status,
    ).toBe(204);
    // Again is fine: the pair is stored once.
    expect(
      (await admin.request("POST", "/api/channels/apart", { ids: [copy.id, tele5.id] })).status,
    ).toBe(204);

    const after = await call<Review>("GET", "/api/channels/review");
    expect(suggestionOf(after, tele5.id)).toBeUndefined();
    expect(suggestionOf(after, (await byName("Nitro HD")).id)).toBeDefined();
  });

  it("says which source a channel that lost a stream still plays from", async () => {
    const source = await addSource("fallback");
    playlists.set("fallback", [
      { name: "Comedy Central HD", tvgId: "ComedyCentral.de", group: "Fun" },
      { name: "Comedy Central SD", tvgId: "ComedyCentral.de", group: "Fun" },
    ]);
    await refresh(source);
    const channel = await byName("Comedy Central HD");
    playlists.set("fallback", [
      { name: "Comedy Central HD", tvgId: "ComedyCentral.de", group: "Fun" },
    ]);
    await refresh(source);
    const review = await call<Review>("GET", "/api/channels/review");
    expect(review.goneStreams).toContainEqual(
      expect.objectContaining({
        name: "Comedy Central SD",
        channel: { id: channel.id, name: "Comedy Central HD" },
        playsFrom: "fallback",
      }),
    );
    expect(review.withoutStreams.map((entry) => entry.name)).not.toContain("Comedy Central HD");

    // Nothing left: the channel has no stream, until it is hidden.
    playlists.set("fallback", [{ name: "Filler", group: "Other" }]);
    await refresh(source);
    const empty = await call<Review>("GET", "/api/channels/review");
    expect(empty.withoutStreams.map((entry) => entry.name)).toContain("Comedy Central HD");
    await call("PATCH", `/api/channels/${channel.id}`, { hidden: true });
    const hidden = await call<Review>("GET", "/api/channels/review");
    expect(hidden.withoutStreams.map((entry) => entry.name)).not.toContain("Comedy Central HD");
    expect(hidden.goneStreams.some((entry) => entry.channel.name === "Comedy Central HD")).toBe(
      false,
    );
  });
});

describe("guide mapping", () => {
  it("clears a channel's guide", async () => {
    const zdf = await byName("ZDF HD");
    const cleared = await call<Channel>("PATCH", `/api/channels/${zdf.id}`, {
      guideChannelId: null,
    });
    expect(cleared.guideChannelId).toBeUndefined();
    const back = await call<Channel>("PATCH", `/api/channels/${zdf.id}`, {
      guideChannelId: "ZDF.de",
    });
    expect(back.guideChannelId).toBe("ZDF.de");
  });

  it("says what is on now in guide searches and suggestions", async () => {
    const now = Date.now();
    await server.run(
      server.db.write.insert(programmes).values({
        id: "zdf-now",
        sourceId: small,
        guideChannelId: "ZDF.de",
        start: now - 60_000,
        end: now + 3_600_000,
        title: "heute journal",
        categories: [],
        repeat: false,
        live: false,
      }),
    );
    const found = await call<Array<{ xmltvId: string; now?: string }>>(
      "GET",
      "/api/channels/guide-channels?search=zdf",
    );
    expect(found.map((entry) => entry.now)).toEqual(["heute journal", "heute journal"]);
    const erste = await call<Array<{ xmltvId: string; now?: string }>>(
      "GET",
      "/api/channels/guide-channels?search=erste",
    );
    expect(erste.every((entry) => entry.now === undefined)).toBe(true);
    const zdf = await byName("ZDF HD");
    const suggested = await call<Array<{ xmltvId: string; now?: string }>>(
      "GET",
      `/api/channels/${zdf.id}/guide-suggestions`,
    );
    expect(suggested).toContainEqual(
      expect.objectContaining({ xmltvId: "ZDF.de", now: "heute journal" }),
    );
  });

  it("searches guide channels and suggests one for a channel", async () => {
    const found = await call<Array<{ xmltvId: string; channels: number }>>(
      "GET",
      "/api/channels/guide-channels?search=zdf",
    );
    expect(found.map((entry) => entry.xmltvId)).toEqual(["ZDF.de", "ZDF.de"]);
    expect(found[0]?.channels).toBe(2);
    const phoenix = await byName("Phoenix HD");
    const suggestions = await call<Array<{ xmltvId: string; reason: string }>>(
      "GET",
      `/api/channels/${phoenix.id}/guide-suggestions`,
    );
    expect(suggestions).toEqual([]);
    const erste = await byName("ARD Das Erste FHD");
    expect(
      await call<Array<{ xmltvId: string; reason: string }>>(
        "GET",
        `/api/channels/${erste.id}/guide-suggestions`,
      ),
    ).toEqual([expect.objectContaining({ xmltvId: "DasErste.de", reason: "sameGuide" })]);
  });

  it("keeps channel writes for admins", async () => {
    const guest = new Browser(server.url);
    const response = await guest.request("POST", "/api/channels/merge", {
      keepId: "a",
      otherIds: ["b"],
    });
    expect(response.status).toBe(401);
  });
});
