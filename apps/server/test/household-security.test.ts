/**
 * What restricted profiles and guests cannot reach, through the real HTTP server against the
 * fake source's guide: admin-only previews, rule previews and conflicts limited to what the
 * viewer sees, shared recordings that one owner cannot move or stop for the others, the event
 * stream per viewer that follows its sign-in, guide queries filtered in SQL, password changes,
 * sign-in limits under concurrent guesses, playback state and ranges, unsafe rule regexes,
 * record options after a stopped airing, file modes, security headers and the recordings list
 * after the dev seed.
 */
import { statSync } from "node:fs";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { DateTime, Effect, Layer, Logger } from "effect";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startFakeSource, type RunningFakeSource } from "@slipstream/fake-source";
import { seed } from "../../../scripts/dev-seed.ts";
import { LOGIN_PER_USER } from "../src/auth/service.ts";
import { databaseFile } from "../src/db/client.ts";
import {
  captures,
  channels as channelRows,
  recordingOwners,
  recordings,
  segments,
} from "../src/db/schema.ts";
import { parseProxies, ServerConfig, type ServerSettings } from "../src/config.ts";
import {
  compressiblePath,
  ConfigWarnings,
  proxyWarning,
  publicUrlWarning,
  securityHeaders,
} from "../src/server.ts";
import { Browser, startTestServer, type TestServer } from "./harness.ts";
import { testSettings } from "./support.ts";

let server: TestServer;
let fake: RunningFakeSource & { close(): Promise<void> };
let admin: Browser;
let adminId: string;
let sourceId: string;
const password = "correct horse battery staple";

interface Channel {
  readonly id: string;
  readonly name: string;
}
interface Programme {
  readonly id: string;
  readonly channelId: string;
  readonly start: string;
  readonly end: string;
  readonly title: string;
}

let channels: Array<Channel>;
let news: Channel;
let f1: Channel;
let guide: Array<Programme>;

const startMs = (programme: Programme) => Date.parse(programme.start);
const endMs = (programme: Programme) => Date.parse(programme.end);
/** Far enough ahead that recording it starts no capture (padding included). */
const later = (programme: Programme) => startMs(programme) > Date.now() + 45 * 60_000;

beforeAll(async () => {
  [server, fake] = await Promise.all([startTestServer(), startFakeSource()]);
  // The dev seed, as `pnpm dev` runs it on a fresh instance.
  await seed({
    serverUrl: server.url,
    sourceUrl: fake.url,
    admin: { username: "admin", password },
  });
  admin = new Browser(server.url);
  const login = await admin.request("POST", "/api/auth/login", { username: "admin", password });
  adminId = (login.json as { user: { id: string } }).user.id;
  sourceId = ((await admin.request("GET", "/api/sources")).json as Array<{ id: string }>)[0]!.id;
  channels = (await admin.request("GET", "/api/channels")).json as Array<Channel>;
  news = channels.find((channel) => channel.name === "Nachrichten 24")!;
  f1 = channels.find((channel) => channel.name === "Sportkanal F1 HD")!;
  const from = new Date();
  // Three days: tests each record a fresh upcoming F1 programme that isn't a "Live F1" one (the
  // seed's series recording takes those), and in the evening one day holds too few of them.
  const to = new Date(from.getTime() + 72 * 3_600_000);
  guide = (
    await admin.request("GET", `/api/guide?from=${from.toISOString()}&to=${to.toISOString()}`)
  ).json as Array<Programme>;
});

afterAll(async () => {
  await Promise.all([server?.close(), fake?.close()]);
});

/** A guest who accepted an invite with `access`, signed in in a browser. */
const guest = async (name: string, access: Record<string, unknown>) => {
  const created = await admin.request("POST", "/api/guests/invites", {
    name,
    access,
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

/** A household profile that signs in on its own, signed in in a browser. */
const profile = async (username: string, access?: Record<string, unknown>) => {
  const created = await admin.request("POST", "/api/profiles", {
    displayName: username,
    avatarTone: "teal",
    login: { username, password: `${username} password 1` },
    ...(access === undefined ? {} : { access }),
  });
  expect(created.status).toBe(200);
  const browser = new Browser(server.url);
  await browser.request("POST", "/api/auth/login", {
    username,
    password: `${username} password 1`,
  });
  return { browser, id: (created.json as { id: string }).id };
};

const record = (browser: Browser, programme: Programme, collectionId?: string) =>
  browser.request("POST", "/api/recordings", {
    _tag: "Programme",
    programmeId: programme.id,
    ...(collectionId === undefined ? {} : { collectionId }),
  });

const draftCollection = {
  name: "Draft",
  rank: 5,
  matcher: {
    channels: [],
    title: [{ _tag: "IsExactly", values: ["Nothing airs under this title"] }],
    categories: [],
    weekdays: [],
  },
  labels: [],
  layout: { parts: [], path: ["{date}"] },
};

describe("the dev seed", () => {
  it("leaves a library that lists, also with a recording that has problems", async () => {
    expect((await admin.request("GET", "/api/recordings")).status).toBe(200);
    // A recording that ended with a gap: its problem carries instants, stored as JSON.
    const now = Date.now();
    await server.run(
      Effect.gen(function* () {
        yield* server.db.write.insert(recordings).values({
          id: "with-gap",
          programmeId: null,
          channelId: news.id,
          start: now - 3_600_000,
          end: now - 1_800_000,
          title: "Gappy",
          subtitle: null,
          description: null,
          categories: [],
          episode: null,
          originalAirDate: null,
          repeat: false,
          live: false,
          imageUrl: null,
          paddingBeforeMinutes: 0,
          paddingAfterMinutes: 0,
          state: "incomplete",
          problems: [
            {
              _tag: "Gap",
              range: {
                start: DateTime.makeUnsafe(now - 3_000_000),
                end: DateTime.makeUnsafe(now - 2_900_000),
              },
            },
          ],
          ruleId: null,
          protected: false,
          pinnedCollectionId: null,
          exportStatus: "none",
          createdAt: now - 3_600_000,
        });
        yield* server.db.write
          .insert(recordingOwners)
          .values({ recordingId: "with-gap", userId: adminId, addedAt: now - 3_600_000 });
      }).pipe(Effect.orDie),
    );
    const list = await admin.request("GET", "/api/recordings");
    expect(list.status).toBe(200);
    const gappy = (list.json as Array<{ id: string; problems: unknown }>).find(
      (entry) => entry.id === "with-gap",
    );
    expect(gappy?.problems).toEqual([
      {
        _tag: "Gap",
        range: {
          start: new Date(now - 3_000_000).toISOString(),
          end: new Date(now - 2_900_000).toISOString(),
        },
      },
    ]);
    await server.run(
      server.db.write.delete(recordings).where(eq(recordings.id, "with-gap")).pipe(Effect.orDie),
    );
  });
});

describe("collection previews", () => {
  it("answer 403 to a guest", async () => {
    const { browser } = await guest("previewer", { channelIds: [news.id], mayRecord: false });
    const collection = (await admin.request("GET", "/api/collections")).json as Array<{
      id: string;
    }>;
    const collectionId = collection[0]!.id;
    expect(
      (await browser.request("POST", "/api/collections/preview", { collection: draftCollection }))
        .status,
    ).toBe(403);
    expect(
      (
        await browser.request("POST", `/api/collections/${collectionId}/similar/preview`, {
          recordingId: "any",
        })
      ).status,
    ).toBe(403);
    expect(
      (await admin.request("POST", "/api/collections/preview", { collection: draftCollection }))
        .status,
    ).toBe(200);
  });
});

/** A rule on the news channel for a title that airs on the F1 channel. */
const rule = () => {
  const onF1 = guide.find(
    (programme) =>
      programme.channelId === f1.id &&
      !guide.some((other) => other.channelId !== f1.id && other.title === programme.title),
  )!;
  return {
    name: "Near miss",
    enabled: true,
    matcher: {
      channels: [news.id],
      title: [{ _tag: "IsExactly", values: [onF1.title] }],
      categories: [],
      weekdays: [],
    },
    padding: { beforeMinutes: 0, afterMinutes: 0 },
    retention: { _tag: "KeepAll" },
  };
};

describe("rule previews", () => {
  it("refuse profiles that may not record", async () => {
    const { browser } = await guest("watcher", { channelIds: [news.id], mayRecord: false });
    expect((await browser.request("POST", "/api/rules/preview", { rule: rule() })).status).toBe(
      403,
    );
  });

  it("show a restricted guest nothing from channels it cannot see", async () => {
    const { browser } = await guest("planner", { channelIds: [news.id], mayRecord: true });
    const preview = await browser.request("POST", "/api/rules/preview", { rule: rule() });
    expect(preview.status).toBe(200);
    const body = preview.json as {
      matches: Array<{ programme: Programme }>;
    };
    expect(body.matches.every((item) => item.programme.channelId === news.id)).toBe(true);
  });
});

/** An upcoming F1 programme and a news programme that overlaps it. */
const overlappingPair = () => {
  for (const onF1 of guide.filter(
    (programme) => programme.channelId === f1.id && later(programme),
  )) {
    const onNews = guide.find(
      (programme) =>
        programme.channelId === news.id &&
        later(programme) &&
        startMs(programme) < endMs(onF1) &&
        endMs(programme) > startMs(onF1),
    );
    if (onNews !== undefined) return { onF1, onNews };
  }
  throw new Error("no overlapping programmes in the fake guide");
};

describe("conflicts and shared recordings", () => {
  let planner: Awaited<ReturnType<typeof guest>>;
  let newsRecordingId: string;

  it("lists conflicts only when the viewer sees every recording in them", async () => {
    const { onF1, onNews } = overlappingPair();
    expect(
      (await admin.request("PATCH", `/api/sources/${sourceId}`, { maxStreams: 1 })).status,
    ).toBe(200);
    expect((await record(admin, onF1)).status).toBe(200);
    const created = await record(admin, onNews);
    expect(created.status).toBe(200);
    newsRecordingId = (created.json as { id: string }).id;
    const query = `?from=${new Date().toISOString()}&to=${new Date(Date.now() + 86_400_000).toISOString()}`;
    const forAdmin = (await admin.request("GET", `/api/recordings/conflicts${query}`))
      .json as Array<{ recordingIds: Array<string> }>;
    expect(forAdmin.length).toBeGreaterThan(0);
    planner = await guest("sharer", { channelIds: [news.id], mayRecord: true });
    expect(
      (await planner.browser.request("GET", `/api/recordings/conflicts${query}`)).json,
    ).toEqual([]);
  });

  it("lets a co-owner label a shared recording but not stop, move or protect it", async () => {
    const { onNews } = overlappingPair();
    // Recording what the household records already adds the guest as an owner.
    expect((await record(planner.browser, onNews)).status).toBe(200);
    const path = `/api/recordings/${newsRecordingId}`;
    expect((await planner.browser.request("PATCH", path, { protected: true })).status).toBe(403);
    expect(
      (
        await planner.browser.request("PATCH", path, {
          padding: { beforeMinutes: 1, afterMinutes: 1 },
        })
      ).status,
    ).toBe(403);
    expect((await planner.browser.request("POST", `${path}/stop`)).status).toBe(403);
    expect((await planner.browser.request("PATCH", path, { labels: ["mine"] })).status).toBe(200);
    expect((await admin.request("PATCH", path, { protected: true })).json).toMatchObject({
      protected: true,
      ownerIds: [adminId, planner.id],
    });
  });

  it("does not move a household recording when a collection-limited profile records it too", async () => {
    const pick = guide.find(
      (programme) =>
        programme.channelId === news.id &&
        later(programme) &&
        programme.id !== overlappingPair().onNews.id,
    )!;
    const created = await record(admin, pick);
    const recordingId = (created.json as { id: string }).id;
    const own = (
      await admin.request("POST", "/api/collections", { ...draftCollection, name: "Kids" })
    ).json as { id: string };
    const kid = await profile("kid", { collectionIds: [own.id], mayRecord: true });
    await record(kid.browser, pick, own.id);
    const after = (await admin.request("GET", `/api/recordings/${recordingId}`)).json as {
      pinnedCollectionId?: string;
      ownerIds: Array<string>;
      group: { collectionId?: string };
    };
    expect(after.ownerIds).toEqual([adminId, kid.id]);
    expect(after.pinnedCollectionId).toBeUndefined();
    expect(after.group.collectionId).not.toBe(own.id);
    // Nor can it pin it to its collection afterwards: it does not even see it.
    expect(
      (
        await kid.browser.request("PATCH", `/api/recordings/${recordingId}`, {
          pinnedCollectionId: own.id,
        })
      ).status,
    ).toBe(404);
  });

  it("does not let a guest stop a recording on a channel it no longer sees", async () => {
    const pick = guide.find(
      (programme) =>
        programme.channelId === news.id &&
        later(programme) &&
        programme.id !== overlappingPair().onNews.id,
    )!;
    const mine = await guest("leaver", { channelIds: [news.id], mayRecord: true });
    const created = await record(mine.browser, pick);
    const recordingId = (created.json as { id: string; ownerIds: Array<string> }).id;
    await admin.request("PATCH", `/api/guests/${mine.id}`, {
      access: { channelIds: [f1.id], mayRecord: true },
    });
    expect((await mine.browser.request("POST", `/api/recordings/${recordingId}/stop`)).status).toBe(
      404,
    );
    expect((await mine.browser.request("DELETE", `/api/recordings/${recordingId}`)).status).toBe(
      404,
    );
    expect(
      (await admin.request("PATCH", `/api/sources/${sourceId}`, { maxStreams: 10 })).status,
    ).toBe(200);
  });
});

/** The guide programmes the household records or has scheduled already. */
const recordedProgrammes = async () =>
  new Set(
    ((await admin.request("GET", "/api/recordings")).json as Array<{ programmeId?: string }>)
      .map((entry) => entry.programmeId)
      .filter((id) => id !== undefined),
  );

/** An upcoming programme matching `where` that nothing records yet. */
const unrecorded = (recorded: Set<string>, where: (programme: Programme) => boolean) => {
  const pick = guide.find(
    (programme) => later(programme) && !recorded.has(programme.id) && where(programme),
  );
  if (pick === undefined) throw new Error("no unrecorded programme in the fake guide");
  return pick;
};

/** Reads server-sent events from `/api/events` for a browser until `until` holds. */
const listen = (browser: Browser) => {
  const controller = new AbortController();
  const events: Array<{ _tag: string; [key: string]: unknown }> = [];
  /** The server ended the stream. */
  const state = { ended: false };
  const opened = fetch(`${server.url}/api/events`, {
    headers: {
      cookie: [...browser.cookies].map(([name, value]) => `${name}=${value}`).join("; "),
    },
    signal: controller.signal,
  });
  const reading = opened
    .then(async (response) => {
      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) {
          state.ended = true;
          return;
        }
        buffer += decoder.decode(value, { stream: true });
        let index = buffer.indexOf("\n\n");
        while (index >= 0) {
          const block = buffer.slice(0, index);
          buffer = buffer.slice(index + 2);
          const data = block
            .split("\n")
            .filter((line) => line.startsWith("data:"))
            .map((line) => line.slice(5).trim())
            .join("");
          if (data !== "") events.push(JSON.parse(data) as { _tag: string });
          index = buffer.indexOf("\n\n");
        }
      }
    })
    .catch(() => undefined);
  return {
    events,
    state,
    close: async () => {
      controller.abort();
      await reading;
    },
  };
};

describe("the event stream", () => {
  it("tells each viewer only about what it may see", async () => {
    const { browser } = await guest("listener", { channelIds: [news.id], mayRecord: false });
    const forGuest = listen(browser);
    const forAdmin = listen(admin);
    await expect.poll(() => forGuest.events.length).toBeGreaterThan(0);
    await expect.poll(() => forAdmin.events.length).toBeGreaterThan(0);
    await admin.request("POST", `/api/sources/${sourceId}/refresh`);
    // Fresh recordings only: recording what is already recorded (by an earlier test, or by the
    // seed's "Live F1:" rule) changes nothing and sends no event.
    const startedAt = Date.now();
    const onF1 = unrecorded(
      await recordedProgrammes(),
      (programme) =>
        programme.channelId === f1.id &&
        !programme.title.startsWith("Live F1:") &&
        programme.id !== overlappingPair().onF1.id,
    );
    const hidden = (await record(admin, onF1)).json as { id: string; createdAt: string };
    const visiblePick = unrecorded(
      await recordedProgrammes(),
      (programme) => programme.channelId === news.id,
    );
    const visible = (await record(admin, visiblePick)).json as { id: string; createdAt: string };
    for (const created of [hidden, visible]) {
      expect(Date.parse(created.createdAt)).toBeGreaterThanOrEqual(startedAt - 1000);
    }
    await expect
      .poll(() =>
        forGuest.events.some(
          (event) => event._tag === "RecordingChanged" && event["recordingId"] === visible.id,
        ),
      )
      .toBe(true);
    await expect
      .poll(() => forAdmin.events.some((event) => event["recordingId"] === visible.id))
      .toBe(true);
    await Promise.all([forGuest.close(), forAdmin.close()]);
    expect(forAdmin.events.map((event) => event._tag)).toContain("GuideRefreshed");
    expect(forAdmin.events.some((event) => event["recordingId"] === hidden.id)).toBe(true);
    expect(forGuest.events[0]?._tag).toBe("Connected");
    expect(
      forGuest.events.filter(
        (event) =>
          event._tag === "GuideRefreshed" ||
          event._tag === "SourceHealthChanged" ||
          event["recordingId"] === hidden.id,
      ),
    ).toEqual([]);
  });

  it("follows a demotion at once: admin events stop for the demoted profile", async () => {
    const boss = await admin.request("POST", "/api/profiles", {
      displayName: "boss",
      avatarTone: "teal",
      role: "admin",
      login: { username: "boss", password: "boss password 1" },
    });
    expect(boss.status).toBe(200);
    const bossId = (boss.json as { id: string }).id;
    const browser = new Browser(server.url);
    await browser.request("POST", "/api/auth/login", {
      username: "boss",
      password: "boss password 1",
    });
    const forBoss = listen(browser);
    const forAdmin = listen(admin);
    await expect.poll(() => forBoss.events.length).toBeGreaterThan(0);
    await expect.poll(() => forAdmin.events.length).toBeGreaterThan(0);
    const refreshes = (stream: ReturnType<typeof listen>) =>
      stream.events.filter((event) => event._tag === "GuideRefreshed").length;
    await admin.request("POST", `/api/sources/${sourceId}/refresh`);
    await expect.poll(() => refreshes(forBoss)).toBe(1);
    expect((await admin.request("PATCH", `/api/profiles/${bossId}`, { role: "user" })).status).toBe(
      200,
    );
    await admin.request("POST", `/api/sources/${sourceId}/refresh`);
    await expect.poll(() => refreshes(forAdmin)).toBe(2);
    expect(refreshes(forBoss)).toBe(1);
    await Promise.all([forBoss.close(), forAdmin.close()]);
  });

  it("follows a narrowed access at once: events stop for the channel taken away", async () => {
    const { browser, id } = await guest("narrowed", {
      channelIds: [news.id, f1.id],
      mayRecord: false,
    });
    const stream = listen(browser);
    await expect.poll(() => stream.events.length).toBeGreaterThan(0);
    const heard = (recordingId: string) =>
      stream.events.some((event) => event["recordingId"] === recordingId);
    const onF1 = unrecorded(
      await recordedProgrammes(),
      (programme) => programme.channelId === f1.id && !programme.title.startsWith("Live F1:"),
    );
    const before = (await record(admin, onF1)).json as { id: string };
    await expect.poll(() => heard(before.id)).toBe(true);
    // The connection keeps its viewer; the access change must still reach it.
    const narrowed = await admin.request("PATCH", `/api/guests/${id}`, {
      access: { channelIds: [news.id], mayRecord: false },
    });
    expect(narrowed.status).toBe(200);
    const laterOnF1 = unrecorded(
      await recordedProgrammes(),
      (programme) => programme.channelId === f1.id && !programme.title.startsWith("Live F1:"),
    );
    const after = (await record(admin, laterOnF1)).json as { id: string };
    const onNews = unrecorded(
      await recordedProgrammes(),
      (programme) => programme.channelId === news.id,
    );
    const seen = (await record(admin, onNews)).json as { id: string };
    await expect.poll(() => heard(seen.id)).toBe(true);
    expect(heard(after.id)).toBe(false);
    await stream.close();
  });

  it("ends when its sign-in ends", async () => {
    const { browser } = await guest("leaving", { channelIds: [news.id], mayRecord: false });
    const stream = listen(browser);
    await expect.poll(() => stream.events.length).toBeGreaterThan(0);
    expect((await browser.request("POST", "/api/auth/logout")).status).toBe(204);
    await expect.poll(() => stream.state.ended, { timeout: 8_000 }).toBe(true);
    await stream.close();
  });
});

/** A rule whose regex could backtrack without end on a long title. */
const evil = () => ({
  ...rule(),
  matcher: {
    channels: [news.id],
    title: [{ _tag: "Regex", pattern: "^(.+)+X$" }],
    categories: [],
    weekdays: [],
  },
});

/** A resume position for `target`. */
const progress = (target: Record<string, string>) => ({
  target,
  positionMillis: 1_000,
  watched: false,
});

/** The grant inside a playlist URL's token (its body is plain base64url JSON). */
const grantOf = (playlistUrl: string) => {
  const token = new URL(playlistUrl, "http://x").searchParams.get("token") ?? "";
  return JSON.parse(Buffer.from(token.split(".")[0] ?? "", "base64url").toString()) as {
    from: number;
    to: number;
  };
};

/** A file's permission bits. */
const modeOf = (path: string) => statSync(path).mode & 0o777;

describe("rule regexes", () => {
  it("refuses a pattern that could backtrack without end before matching anything", async () => {
    const started = performance.now();
    const preview = await admin.request("POST", "/api/rules/preview", { rule: evil() });
    expect(performance.now() - started).toBeLessThan(1_000);
    expect(preview.status).toBe(422);
    expect(preview.json).toMatchObject({
      _tag: "InvalidInput",
      problems: [{ path: "matcher.title", code: "unsafeRegex" }],
    });
    const saved = await admin.request("POST", "/api/rules", evil());
    expect(saved.status).toBe(422);
  });

  it("leaves the export path to admins and keeps it inside the export folder", async () => {
    const outside = await admin.request("POST", "/api/rules", {
      ...rule(),
      exportTemplate: "../../etc/{title}",
    });
    expect(outside.json).toMatchObject({ problems: [{ path: "exportTemplate" }] });
    const { browser } = await guest("exporter", { channelIds: [news.id], mayRecord: true });
    const forGuest = await browser.request("POST", "/api/rules", {
      ...rule(),
      exportTemplate: "Sport/{title}",
    });
    expect(forGuest.status).toBe(403);
  });
});

describe("playback state", () => {
  it("answers NotFound for recordings and programmes outside the viewer's access", async () => {
    const onF1 = unrecorded(
      await recordedProgrammes(),
      (programme) => programme.channelId === f1.id && !programme.title.startsWith("Live F1:"),
    );
    const hidden = (await record(admin, onF1)).json as { id: string };
    const { browser } = await guest("resumer", { channelIds: [news.id], mayRecord: false });
    expect(
      (await browser.request("GET", `/api/playback/state/recordings/${hidden.id}`)).status,
    ).toBe(404);
    expect(
      (
        await browser.request(
          "PUT",
          "/api/playback/state",
          progress({ _tag: "Recording", recordingId: hidden.id }),
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await browser.request(
          "PUT",
          "/api/playback/state",
          progress({ _tag: "Programme", programmeId: onF1.id }),
        )
      ).status,
    ).toBe(404);
    const onNews = guide.find((programme) => programme.channelId === news.id)!;
    expect(
      (
        await browser.request(
          "PUT",
          "/api/playback/state",
          progress({ _tag: "Programme", programmeId: onNews.id }),
        )
      ).status,
    ).toBe(200);
    expect((await admin.request("GET", `/api/playback/state/recordings/${hidden.id}`)).status).toBe(
      200,
    );
  });
});

/**
 * A second server for what needs its own sign-in limits (requests tell their client address
 * through the trusted proxy header), a short DVR window, and a look at its files.
 */
describe("an instance of its own", () => {
  let own: TestServer;
  let ownAdmin: Browser;
  const channelId = "own-channel";
  const dvrWindowMs = 3_000;

  const capabilities = {
    video: [{ codec: "h264", profiles: [], maxWidth: 1920, maxHeight: 1080 }],
    audio: ["aac", "mp2"],
    audioPassthrough: [],
    hdr: false,
    canDeinterlace: true,
  };

  /** A browser whose requests come from `address` (through the trusted proxy). */
  class BrowserAt extends Browser {
    readonly address: string;

    constructor(address: string) {
      super(own.url);
      this.address = address;
    }

    override request(
      method: string,
      path: string,
      body?: unknown,
      headers: Record<string, string> = {},
    ) {
      return super.request(method, path, body, { "x-forwarded-for": this.address, ...headers });
    }
  }
  const from = (address: string) => new BrowserAt(address);

  beforeAll(async () => {
    own = await startTestServer({
      trustedProxies: parseProxies("127.0.0.1"),
      recorder: { segmentSeconds: 2, endGraceMs: 3000, dvrWindowMs },
    });
    ownAdmin = from("10.0.0.1");
    expect(
      (
        await ownAdmin.request("POST", "/api/auth/setup", {
          username: "admin",
          displayName: "Admin",
          password,
        })
      ).status,
    ).toBe(200);
    await own.run(
      own.db.write
        .insert(channelRows)
        .values({ id: channelId, name: "Eigener Kanal", favourite: false, hidden: false })
        .pipe(Effect.orDie),
    );
  });

  afterAll(async () => {
    await own?.close();
  });

  it("lets at most the account's limit of concurrent wrong PINs reach the check", async () => {
    const created = await ownAdmin.request("POST", "/api/profiles", {
      displayName: "pinny",
      avatarTone: "teal",
      pin: "1234",
    });
    expect(created.status).toBe(200);
    const id = (created.json as { id: string }).id;
    const statuses = await Promise.all(
      Array.from({ length: 20 }, () =>
        ownAdmin
          .request("POST", `/api/profiles/${id}/pin/verify`, { pin: "9999" })
          .then((result) => result.status),
      ),
    );
    const checked = statuses.filter((status) => status !== 429);
    expect(checked.every((status) => status === 401)).toBe(true);
    expect(checked.length).toBeLessThanOrEqual(LOGIN_PER_USER.max);
    expect(statuses.filter((status) => status === 429).length).toBeGreaterThanOrEqual(
      20 - LOGIN_PER_USER.max,
    );
  });

  it("does not lift the admin's sign-in backoff for someone else's session", async () => {
    const created = await ownAdmin.request("POST", "/api/guests/invites", {
      name: "Guesser",
      access: { mayRecord: false },
      expiry: "sevenDays",
    });
    const token = new URL((created.json as { url: string }).url).searchParams.get("token") ?? "";
    const guesser = from("10.0.0.2");
    expect(
      (
        await guesser.request("POST", "/api/invites/accept", {
          token,
          username: "guesser",
          password: "guesser password 1",
        })
      ).status,
    ).toBe(200);
    const statuses = [];
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const result = await guesser.request("POST", "/api/auth/login", {
        username: "admin",
        password: `guess ${attempt}`,
      });
      statuses.push(result.status);
    }
    expect(statuses).toEqual([401, 401, 401, 401, 429]);
    // The admin's own browser is not held up by it.
    expect(
      (await ownAdmin.request("POST", "/api/auth/login", { username: "admin", password })).status,
    ).toBe(200);
  });

  /** Starts a range session (start over) on the channel, epoch ms. */
  const rangeSession = (browser: Browser, start: number, end: number) =>
    browser.request("POST", "/api/playback/sessions", {
      source: {
        _tag: "Range",
        channelId,
        range: { start: new Date(start).toISOString(), end: new Date(end).toISOString() },
      },
      capabilities,
      quality: { _tag: "Auto" },
    });

  /**
   * A finished capture of the channel with one-second segments over `[fromMs, toMs)`: what the
   * timeshift buffer holds for a range session to play.
   */
  const captured = (id: string, fromMs: number, toMs: number) =>
    own.run(
      Effect.gen(function* () {
        yield* own.db.write.insert(captures).values({
          id,
          channelId,
          sourceStreamId: "own-stream",
          startedAt: fromMs,
          endedAt: toMs,
          state: "stopped",
          stats: { bytes: 0, segments: 0, reconnects: 0 },
          directory: join(own.root, "data", id),
        });
        const count = Math.ceil((toMs - fromMs) / 1000);
        yield* own.db.write.insert(segments).values(
          Array.from({ length: count }, (_, sequence) => ({
            captureId: id,
            sequence,
            runId: `${id}-run`,
            startMs: fromMs + sequence * 1000,
            durationMs: 1000,
            bytes: 1,
            path: `seg-${sequence}.ts`,
          })),
        );
      }).pipe(Effect.orDie),
    );

  /** Why the admin's range session is refused. */
  const refusalCode = async (start: number, end: number) => {
    const result = await rangeSession(ownAdmin, start, end);
    expect(result.status).toBe(422);
    return (result.json as { problems: Array<{ code: string }> }).problems[0]?.code;
  };

  it("refuses ranges that are inverted, longer than a day or not over yet", async () => {
    const now = Date.now();
    expect(await refusalCode(now - 60_000, now - 120_000)).toBe("beforeStart");
    expect(await refusalCode(now - 26 * 3_600_000, now - 60_000)).toBe("rangeTooLong");
    expect(await refusalCode(now - 60_000, now + 3_600_000)).toBe("notOverYet");
    await captured("range-capture", now - 120_000, now - 50_000);
    expect((await rangeSession(ownAdmin, now - 120_000, now - 60_000)).status).toBe(200);
  });

  it("answers RangeNotCaptured for a range the timeshift buffer does not hold", async () => {
    const now = Date.now();
    const notCaptured = async (start: number, end: number) => {
      const result = await rangeSession(ownAdmin, start, end);
      expect(result.status).toBe(404);
      expect(result.json).toMatchObject({
        _tag: "RangeNotCaptured",
        channelId,
        range: { start: new Date(start).toISOString(), end: new Date(end).toISOString() },
      });
    };
    // Before the oldest captured segment: the buffer moved on (or never reached back so far).
    await notCaptured(now - 200_000, now - 100_000);
    // After the oldest segment, but nothing captured inside it.
    await notCaptured(now - 40_000, now - 30_000);
    // A channel that never captured anything.
    await own.run(
      own.db.write
        .insert(channelRows)
        .values({ id: "empty-channel", name: "Leer", favourite: false, hidden: false })
        .pipe(Effect.orDie),
    );
    const empty = await ownAdmin.request("POST", "/api/playback/sessions", {
      source: {
        _tag: "Range",
        channelId: "empty-channel",
        range: {
          start: new Date(now - 120_000).toISOString(),
          end: new Date(now - 60_000).toISOString(),
        },
      },
      capabilities,
      quality: { _tag: "Auto" },
    });
    expect(empty.json).toMatchObject({ _tag: "RangeNotCaptured", channelId: "empty-channel" });
  });

  it("keeps a collection-limited profile's range inside the DVR window as it renews", async () => {
    const collection = (await ownAdmin.request("POST", "/api/collections", draftCollection))
      .json as { id: string };
    await ownAdmin.request("POST", "/api/profiles", {
      displayName: "kiddo",
      avatarTone: "teal",
      login: { username: "kiddo", password: "kiddo password 1" },
      access: { collectionIds: [collection.id], mayRecord: false },
    });
    const kid = from("10.0.0.4");
    await kid.request("POST", "/api/auth/login", {
      username: "kiddo",
      password: "kiddo password 1",
    });
    const now = Date.now();
    const range = { start: now - 2_000, end: now - 1_000 };
    await captured("recent-capture", range.start, now);
    const created = await rangeSession(kid, range.start, range.end);
    expect(created.status).toBe(200);
    const first = created.json as { id: string; playlistUrl: string };
    expect(grantOf(first.playlistUrl)).toMatchObject({ from: range.start, to: range.end });
    // Older than the DVR window, the stretch belongs to recordings: a renewed token opens none.
    await new Promise((resolve) => setTimeout(resolve, dvrWindowMs + 500));
    const renewed = await kid.request("PATCH", `/api/playback/sessions/${first.id}`, {});
    expect(renewed.status).toBe(200);
    const grant = grantOf((renewed.json as { playlistUrl: string }).playlistUrl);
    expect(grant.from).toBe(range.end);
  });

  it("keeps the config directory and database private to the server's user", async () => {
    const configDir = join(own.root, "config");
    expect(modeOf(configDir)).toBe(0o700);
    expect(modeOf(join(configDir, databaseFile))).toBe(0o600);
    expect(modeOf(join(configDir, "secret.key"))).toBe(0o600);
    for (const companion of ["-wal", "-shm"]) {
      expect(modeOf(join(configDir, `${databaseFile}${companion}`))).toBe(0o600);
    }
  });
});

describe("guide queries", () => {
  it("search filters to the viewer's channels before the limit", async () => {
    const title = guide.find((programme) => programme.channelId === f1.id)!.title.split(/\s+/)[0]!;
    const forAdmin = (
      await admin.request("GET", `/api/guide/search?q=${encodeURIComponent(title)}`)
    ).json as Array<Programme>;
    expect(forAdmin.some((programme) => programme.channelId === f1.id)).toBe(true);
    const { browser } = await guest("searcher", { channelIds: [news.id], mayRecord: false });
    const forGuest = (
      await browser.request("GET", `/api/guide/search?q=${encodeURIComponent(title)}`)
    ).json as Array<Programme>;
    expect(forGuest.every((programme) => programme.channelId === news.id)).toBe(true);
  });

  it("leaves hidden channels out of the window for everyone but admins", async () => {
    const third = channels.find((channel) => channel.id !== news.id && channel.id !== f1.id)!;
    await admin.request("PATCH", `/api/channels/${third.id}`, { hidden: true });
    const from = new Date();
    const to = new Date(from.getTime() + 3 * 3_600_000);
    const query = `/api/guide?from=${from.toISOString()}&to=${to.toISOString()}&channels=${third.id}`;
    expect(((await admin.request("GET", query)).json as Array<Programme>).length).toBeGreaterThan(
      0,
    );
    const { browser } = await profile("viewer");
    expect((await browser.request("GET", query)).json).toEqual([]);
    await admin.request("PATCH", `/api/channels/${third.id}`, { hidden: false });
  });
});

describe("accounts", () => {
  it("never makes a guest an admin", async () => {
    const { id } = await guest("climber", { channelIds: [news.id], mayRecord: false });
    const promoted = await admin.request("PATCH", `/api/profiles/${id}`, { role: "admin" });
    expect(promoted.status).toBe(422);
    expect(promoted.json).toMatchObject({ problems: [{ path: "role", code: "guestAdmin" }] });
  });

  it("signs out everything else of yours when you change your own password", async () => {
    const { browser, id } = await profile("pat");
    const other = new Browser(server.url);
    await other.request("POST", "/api/auth/login", { username: "pat", password: "pat password 1" });
    const device = (await new Browser(server.url).request("POST", "/api/auth/login", {
      username: "pat",
      password: "pat password 1",
      device: { name: "Phone", kind: "phone" },
    })) as { json: { token: string; device: { id: string } } };
    const changed = await browser.request("PATCH", `/api/profiles/${id}`, {
      password: "pat password 2",
      currentPassword: "pat password 1",
    });
    expect(changed.status).toBe(200);
    expect((await browser.request("GET", "/api/auth/me")).status).toBe(200);
    expect((await other.request("GET", "/api/auth/me")).status).toBe(401);
    expect(
      (
        await fetch(`${server.url}/api/auth/me`, {
          headers: { authorization: `Bearer ${device.json.token}` },
        })
      ).status,
    ).toBe(401);
    const devices = (await admin.request("GET", "/api/devices")).json as Array<{
      id: string;
      revokedAt?: string;
    }>;
    expect(devices.find((entry) => entry.id === device.json.device.id)?.revokedAt).toBeDefined();

    // Wrong current passwords count like wrong sign-ins.
    const statuses = [];
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const wrong = await browser.request("PATCH", `/api/profiles/${id}`, {
        password: "pat password 3",
        currentPassword: "guess",
      });
      statuses.push(wrong.status);
    }
    expect(statuses).toEqual([422, 422, 422, 422, 422, 429]);
  });
});

describe("record options", () => {
  it("allows recording an airing again once its recording stopped", async () => {
    const now = Date.now();
    // Any airing on now with a minute left; the news channel when it has one (the fake guide
    // has gaps, so a fixed channel made this test depend on the time of day).
    const onNow = guide.filter(
      (programme) => startMs(programme) <= now && endMs(programme) > now + 60_000,
    );
    const airing = onNow.find((programme) => programme.channelId === news.id) ?? onNow[0];
    if (airing === undefined) throw new Error("the fake guide has nothing on air");
    await server.run(
      Effect.gen(function* () {
        yield* server.db.write.insert(recordings).values({
          id: "stopped-early",
          programmeId: airing.id,
          channelId: airing.channelId,
          start: startMs(airing),
          end: endMs(airing),
          title: airing.title,
          subtitle: null,
          description: null,
          categories: [],
          episode: null,
          originalAirDate: null,
          repeat: false,
          live: false,
          imageUrl: null,
          paddingBeforeMinutes: 0,
          paddingAfterMinutes: 0,
          state: "incomplete",
          problems: [],
          ruleId: null,
          protected: false,
          pinnedCollectionId: null,
          exportStatus: "none",
          stoppedAt: now - 1000,
          createdAt: startMs(airing),
        });
        yield* server.db.write
          .insert(recordingOwners)
          .values({ recordingId: "stopped-early", userId: adminId, addedAt: startMs(airing) });
      }).pipe(Effect.orDie),
    );
    const options = await admin.request("GET", `/api/programmes/${airing.id}/record-options`);
    expect(options.json).toMatchObject({ status: { _tag: "NotScheduled" } });
  });
});

interface Entry {
  readonly id: string;
  readonly programmeId?: string;
  readonly ownerIds: ReadonlyArray<string>;
}

/** A rule recording every airing of `programme`'s title on its channel. */
const titleRule = (name: string, programme: Programme) => ({
  name,
  enabled: true,
  matcher: {
    channels: [programme.channelId],
    title: [{ _tag: "IsExactly", values: [programme.title] }],
    categories: [],
    weekdays: [],
  },
  padding: { beforeMinutes: 0, afterMinutes: 0 },
  retention: { _tag: "KeepAll" },
});

const removals = (stream: ReturnType<typeof listen>, recordingId: string) =>
  stream.events.filter(
    (event) => event._tag === "RecordingRemoved" && event["recordingId"] === recordingId,
  );

describe("leaving and deleting recordings", () => {
  let bob: Awaited<ReturnType<typeof profile>>;

  it("keeps a co-owner who left a rule recording out of it when the rules plan again", async () => {
    bob = await profile("bob");
    const pick = unrecorded(
      await recordedProgrammes(),
      (programme) => programme.channelId === news.id,
    );
    const ours = (await admin.request("POST", "/api/rules", titleRule("Ours", pick))).json as {
      id: string;
    };
    const his = (await bob.browser.request("POST", "/api/rules", titleRule("His", pick))).json as {
      id: string;
    };
    const planned = (
      (await admin.request("GET", `/api/recordings?ruleId=${ours.id}`)).json as Array<Entry>
    ).find((entry) => entry.programmeId === pick.id)!;
    expect(planned.ownerIds).toEqual([adminId, bob.id]);

    const forBob = listen(bob.browser);
    await expect.poll(() => forBob.events.length).toBeGreaterThan(0);
    const path = `/api/recordings/${planned.id}`;
    expect((await bob.browser.request("DELETE", path)).status).toBe(204);
    await expect
      .poll(() => removals(forBob, planned.id))
      .toEqual([{ _tag: "RecordingRemoved", recordingId: planned.id, ownerIds: [bob.id] }]);
    await forBob.close();

    // Editing his rule plans again; he stays out of the recording he left.
    expect(
      (await bob.browser.request("PATCH", `/api/rules/${his.id}`, { name: "His, renamed" })).status,
    ).toBe(200);
    expect(((await admin.request("GET", path)).json as Entry).ownerIds).toEqual([adminId]);
    const bobs = (await bob.browser.request("GET", "/api/recordings?mine=true"))
      .json as Array<Entry>;
    expect(bobs.map((entry) => entry.id)).not.toContain(planned.id);

    // Recording it himself makes him an owner again.
    expect((await record(bob.browser, pick)).status).toBe(200);
    expect(((await admin.request("GET", path)).json as Entry).ownerIds).toEqual([adminId, bob.id]);

    for (const [browser, id] of [
      [admin, ours.id],
      [bob.browser, his.id],
    ] as const) {
      expect((await browser.request("DELETE", `/api/rules/${id}`)).status).toBe(204);
    }
  });

  it("tells the owner when deleting a rule takes its scheduled recordings along", async () => {
    const pick = unrecorded(
      await recordedProgrammes(),
      (programme) => programme.channelId === news.id,
    );
    const gone = (await bob.browser.request("POST", "/api/rules", titleRule("Gone", pick)))
      .json as { id: string };
    const planned = (
      (await bob.browser.request("GET", `/api/recordings?ruleId=${gone.id}`)).json as Array<Entry>
    ).find((entry) => entry.programmeId === pick.id)!;
    expect(planned.ownerIds).toEqual([bob.id]);
    const forBob = listen(bob.browser);
    await expect.poll(() => forBob.events.length).toBeGreaterThan(0);
    expect((await bob.browser.request("DELETE", `/api/rules/${gone.id}`)).status).toBe(204);
    // Nobody else owned it, so the recording itself is gone, and Bob's lists hear about it.
    await expect
      .poll(() => removals(forBob, planned.id))
      .toEqual([{ _tag: "RecordingRemoved", recordingId: planned.id, ownerIds: [bob.id] }]);
    await forBob.close();
    expect((await admin.request("GET", `/api/recordings/${planned.id}`)).status).toBe(404);
  });

  it("tells the owners when a recording's labels, pin or protection change", async () => {
    const pick = unrecorded(
      await recordedProgrammes(),
      (programme) => programme.channelId === news.id,
    );
    const created = (await record(bob.browser, pick)).json as Entry;
    const forBob = listen(bob.browser);
    await expect.poll(() => forBob.events.length).toBeGreaterThan(0);
    const path = `/api/recordings/${created.id}`;
    const changes = () =>
      forBob.events.filter(
        (event) => event._tag === "RecordingChanged" && event["recordingId"] === created.id,
      ).length;
    expect(changes()).toBe(0);
    expect((await bob.browser.request("PATCH", path, { labels: ["Keep"] })).status).toBe(200);
    await expect.poll(changes).toBeGreaterThan(0);
    await forBob.close();
    expect((await bob.browser.request("DELETE", path)).status).toBe(204);
  });

  it("hands the recordings only a deleted profile owned to the admin who deleted it", async () => {
    const leaver = await profile("handed-on");
    const pick = unrecorded(
      await recordedProgrammes(),
      (programme) => programme.channelId === news.id,
    );
    const created = (await record(leaver.browser, pick)).json as Entry;
    expect(created.ownerIds).toEqual([leaver.id]);
    expect((await admin.request("DELETE", `/api/profiles/${leaver.id}`)).status).toBe(204);
    const kept = await admin.request("GET", `/api/recordings/${created.id}`);
    expect((kept.json as Entry).ownerIds).toEqual([adminId]);
    expect((await admin.request("GET", "/api/recordings")).status).toBe(200);
    expect((await admin.request("DELETE", `/api/recordings/${created.id}`)).status).toBe(204);
  });

  it("tells every owner when an admin deletes a shared recording", async () => {
    const pick = unrecorded(
      await recordedProgrammes(),
      (programme) => programme.channelId === news.id,
    );
    const created = (await record(admin, pick)).json as Entry;
    expect(((await record(bob.browser, pick)).json as Entry).ownerIds).toEqual([adminId, bob.id]);
    const outsider = await profile("outsider");
    const forBob = listen(bob.browser);
    const forOutsider = listen(outsider.browser);
    await expect.poll(() => forBob.events.length).toBeGreaterThan(0);
    await expect.poll(() => forOutsider.events.length).toBeGreaterThan(0);
    expect((await admin.request("DELETE", `/api/recordings/${created.id}`)).status).toBe(204);
    // The row is gone, yet Bob hears it: the owners read before the delete decide.
    await expect
      .poll(() => removals(forBob, created.id))
      .toEqual([
        { _tag: "RecordingRemoved", recordingId: created.id, ownerIds: [adminId, bob.id] },
      ]);
    await Promise.all([forBob.close(), forOutsider.close()]);
    expect(removals(forOutsider, created.id)).toEqual([]);
    expect((await admin.request("GET", `/api/recordings/${created.id}`)).status).toBe(404);
  });

  it("hides a recording pinned to another collection from GET, PATCH and the list alike", async () => {
    const pick = unrecorded(
      await recordedProgrammes(),
      (programme) => programme.channelId === news.id,
    );
    const theirs = (
      await admin.request("POST", "/api/collections", { ...draftCollection, name: "Theirs" })
    ).json as { id: string };
    const own = (
      await admin.request("POST", "/api/collections", { ...draftCollection, name: "Own" })
    ).json as { id: string };
    const created = (await record(admin, pick, theirs.id)).json as Entry & {
      pinnedCollectionId?: string;
    };
    expect(created.pinnedCollectionId).toBe(theirs.id);
    const limited = await guest("pinned-out", {
      channelIds: [news.id],
      collectionIds: [own.id],
      mayRecord: true,
    });
    // Recording it too makes the guest an owner, but it stays pinned where the guest cannot see.
    await record(limited.browser, pick, own.id);
    const path = `/api/recordings/${created.id}`;
    expect(((await admin.request("GET", path)).json as Entry).ownerIds).toEqual([
      adminId,
      limited.id,
    ]);
    expect((await limited.browser.request("GET", path)).status).toBe(404);
    expect((await limited.browser.request("PATCH", path, { labels: ["mine"] })).status).toBe(404);
    const listed = (await limited.browser.request("GET", "/api/recordings")).json as Array<Entry>;
    expect(listed.map((entry) => entry.id)).not.toContain(created.id);
  });

  it("shows a manual recording that covers an airing on its programme sheet", async () => {
    const pick = unrecorded(
      await recordedProgrammes(),
      (programme) => programme.channelId === news.id,
    );
    const manual = await admin.request("POST", "/api/recordings", {
      _tag: "Manual",
      channelId: news.id,
      title: "Around the news",
      range: {
        start: new Date(startMs(pick) - 5 * 60_000).toISOString(),
        end: new Date(endMs(pick) + 5 * 60_000).toISOString(),
      },
    });
    expect(manual.status).toBe(200);
    const options = await admin.request("GET", `/api/programmes/${pick.id}/record-options`);
    expect(options.json).toMatchObject({
      status: { _tag: "Recorded", recordingId: (manual.json as Entry).id, state: "scheduled" },
    });
  });
});

/** The encoding the server picks for `path` when Brotli and gzip are both accepted. */
const encoding = async (path: string) =>
  (await admin.request("GET", path, undefined, { "accept-encoding": "br, gzip" })).headers.get(
    "content-encoding",
  );

describe("responses", () => {
  it("are compressed where they are large and carry no secret", async () => {
    const from = new Date(Date.now() - 3_600_000).toISOString();
    const to = new Date(Date.now() + 48 * 3_600_000).toISOString();
    expect(await encoding(`/api/guide?from=${from}&to=${to}`)).toBe("br");
    // Sign-in answers carry tokens: never compressed, whatever their size.
    expect(await encoding("/api/auth/me")).toBeNull();
    expect(compressiblePath("/api/guide")).toBe(true);
    expect(compressiblePath("/api/guide/repeats")).toBe(true);
    expect(compressiblePath("/api/guides")).toBe(false);
    expect(compressiblePath("/api/auth/login")).toBe(false);
    expect(compressiblePath("/api/settings/recording")).toBe(false);
    expect(compressiblePath("/hls/seg/a/1.ts")).toBe(false);
    expect(compressiblePath("/assets/index.js")).toBe(true);
  });

  it("carry the security headers, also on errors and HLS", async () => {
    for (const path of ["/api/health", "/api/channels", "/hls/seg/none/1.ts?token=x"]) {
      const response = await fetch(`${server.url}${path}`);
      for (const [name, value] of Object.entries(securityHeaders)) {
        expect(response.headers.get(name)).toBe(value);
      }
    }
    expect(securityHeaders["content-security-policy"]).toBe("frame-ancestors 'none'");
  });
});

/** What the startup checks of the settings log. */
const warnings = async (overrides: Partial<ServerSettings>) => {
  const messages: Array<string> = [];
  const capture = Logger.layer([
    Logger.make(({ message }) => {
      messages.push(String(message));
    }),
  ]);
  await Effect.runPromise(
    Effect.scoped(
      Layer.build(
        ConfigWarnings.pipe(
          Layer.provide(ServerConfig.layerWith(testSettings(server.root, overrides))),
          Layer.provide(capture),
        ),
      ),
    ),
  );
  return messages;
};

describe("startup", () => {
  it("warns when served over https without trusted proxies", async () => {
    expect(await warnings({ publicUrl: "https://tv.example.test" })).toEqual([proxyWarning]);
    expect(
      await warnings({
        publicUrl: "https://tv.example.test",
        trustedProxies: parseProxies("172.16.0.0/12"),
      }),
    ).toEqual([]);
    expect(await warnings({ publicUrl: "http://tv.example.test" })).toEqual([]);
  });

  it("warns once that links point at localhost without a public URL", async () => {
    expect(await warnings({ publicUrl: undefined })).toEqual([publicUrlWarning]);
  });
});
