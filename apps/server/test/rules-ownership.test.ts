/**
 * Series recordings in a household of several people, through the real HTTP server against the
 * fake source's guide: deleting a rule leaves upcoming recordings other people own with them,
 * an undo by someone who may not edit collections keeps the linked collection, "Group them"
 * twice at once links one collection, and the episode history answers for the rule's owner
 * whoever looks.
 */
import { and, eq } from "drizzle-orm";
import { Effect } from "effect";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startFakeSource, type RunningFakeSource } from "@slipstream/fake-source";
import { collections, episodeHistory, recordingOwners, recordings } from "../src/db/schema.ts";
import { Browser, startTestServer, type TestServer } from "./harness.ts";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const password = "correct horse battery staple";

interface Programme {
  readonly id: string;
  readonly channelId: string;
  readonly start: string;
  readonly title: string;
}
interface Rule {
  readonly id: string;
  readonly collectionId?: string;
}

let server: TestServer;
let fake: RunningFakeSource & { close(): Promise<void> };
let admin: Browser;
let guide: ReadonlyArray<Programme>;

beforeAll(async () => {
  [server, fake] = await Promise.all([startTestServer(), startFakeSource({ guideHours: 72 })]);
  admin = new Browser(server.url);
  await admin.request("POST", "/api/auth/setup", {
    username: "admin",
    displayName: "Admin",
    password,
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
  const sourceId = (source.json as { id: string }).id;
  expect((await admin.request("POST", `/api/sources/${sourceId}/refresh`)).status).toBe(200);
  // From now to the fake guide's end, so a "single airing" is single for the rule too.
  const from = new Date();
  const to = new Date(from.getTime() + 3 * DAY);
  guide = (
    await admin.request("GET", `/api/guide?from=${from.toISOString()}&to=${to.toISOString()}`)
  ).json as Array<Programme>;
});

afterAll(async () => {
  await Promise.all([server?.close(), fake?.close()]);
});

const profile = async (username: string) => {
  const created = await admin.request("POST", "/api/profiles", {
    displayName: username,
    avatarTone: "teal",
    login: { username, password: `${username} password 1` },
  });
  expect(created.status).toBe(200);
  const browser = new Browser(server.url);
  await browser.request("POST", "/api/auth/login", {
    username,
    password: `${username} password 1`,
  });
  return { browser, id: (created.json as { id: string }).id };
};

/** Titles nobody else's test uses, so each test's rule matches only its own airings. */
const usedTitles = new Set<string>();

/**
 * An upcoming programme, hours away (nothing captures), whose title no other test took and
 * that airs only once in the guide. The guide answers with everything that overlaps its window,
 * so a long programme already on air leads the list: it is never picked, but it counts, since a
 * rule for its title would record it at once and skip the later airing as a repeat.
 */
const freshProgramme = () => {
  const programme = guide.find(
    (candidate) =>
      Date.parse(candidate.start) > Date.now() + HOUR &&
      !usedTitles.has(candidate.title) &&
      guide.filter((other) => other.title === candidate.title).length === 1,
  );
  if (programme === undefined) throw new Error("the fake guide ran out of single airings");
  usedTitles.add(programme.title);
  return programme;
};

/** A rule for exactly this programme's title on its channel. */
const ruleFor = async (browser: Browser, programme: Programme, name = programme.title) => {
  const created = await browser.request("POST", "/api/rules", {
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
  expect(created.status).toBe(200);
  return created.json as Rule;
};

const recordByHand = async (browser: Browser, programme: Programme) => {
  const recorded = await browser.request("POST", "/api/recordings", {
    _tag: "Programme",
    programmeId: programme.id,
  });
  expect(recorded.status).toBe(200);
  return (recorded.json as { id: string }).id;
};

const db = <A, E>(effect: (write: TestServer["db"]["write"]) => Effect.Effect<A, E>) =>
  server.run(effect(server.db.write));

/** The scheduled recordings of a programme, with their rule and owners (who added them). */
const scheduledOf = async (programme: Programme) => {
  const rows = await db((write) =>
    write
      .select({ id: recordings.id, ruleId: recordings.ruleId })
      .from(recordings)
      .where(and(eq(recordings.programmeId, programme.id), eq(recordings.state, "scheduled"))),
  );
  return Promise.all(
    rows.map(async (row) => ({
      ...row,
      owners: (
        await db((write) =>
          write
            .select({ userId: recordingOwners.userId, addedBy: recordingOwners.addedByRuleId })
            .from(recordingOwners)
            .where(eq(recordingOwners.recordingId, row.id)),
        )
      ).toSorted((a, b) => a.userId.localeCompare(b.userId)),
    })),
  );
};

/** Waits for the recorder's planning pass (it runs after the request answers). */
const until = async <A>(read: () => Promise<A>, done: (value: A) => boolean) => {
  const deadline = Date.now() + 10_000;
  for (;;) {
    const value = await read();
    if (done(value) || Date.now() > deadline) return value;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
};

describe("deleting a series recording others share", () => {
  it("leaves Jonas's hand recording with him when Mara's rule shared it", async () => {
    const jonas = await profile("jonas");
    const mara = await profile("mara");
    const programme = freshProgramme();
    const recordingId = await recordByHand(jonas.browser, programme);
    const rule = await ruleFor(mara.browser, programme);
    const shared = await until(
      () => scheduledOf(programme),
      (rows) => rows[0]?.owners.length === 2,
    );
    expect(shared).toEqual([
      {
        id: recordingId,
        ruleId: null,
        owners: [
          { userId: jonas.id, addedBy: null },
          { userId: mara.id, addedBy: rule.id },
        ].toSorted((a, b) => a.userId.localeCompare(b.userId)),
      },
    ]);

    expect((await mara.browser.request("DELETE", `/api/rules/${rule.id}`)).status).toBe(204);
    expect(await scheduledOf(programme)).toEqual([
      { id: recordingId, ruleId: null, owners: [{ userId: jonas.id, addedBy: null }] },
    ]);
    const mine = (await jonas.browser.request("GET", "/api/recordings")).json as Array<{
      id: string;
    }>;
    expect(mine.map((entry) => entry.id)).toContain(recordingId);
  });

  it("keeps the rule's recording for Jonas when he recorded the same airing by hand", async () => {
    const jonas = await profile("jonas2");
    const mara = await profile("mara2");
    const programme = freshProgramme();
    const rule = await ruleFor(mara.browser, programme);
    const [planned] = await until(
      () => scheduledOf(programme),
      (rows) => rows.length === 1,
    );
    expect(planned).toMatchObject({ ruleId: rule.id, owners: [{ userId: mara.id }] });
    // Recording it by hand joins the rule's recording instead of making a second one.
    expect(await recordByHand(jonas.browser, programme)).toBe(planned?.id);

    expect((await mara.browser.request("DELETE", `/api/rules/${rule.id}`)).status).toBe(204);
    // Only Mara left it; with no rule of Jonas's wanting it, it is his hand recording now.
    expect(await scheduledOf(programme)).toEqual([
      { id: planned?.id, ruleId: null, owners: [{ userId: jonas.id, addedBy: null }] },
    ]);
  });

  it("deletes upcoming recordings nobody else owns", async () => {
    const mara = await profile("mara3");
    const programme = freshProgramme();
    const rule = await ruleFor(mara.browser, programme);
    await until(
      () => scheduledOf(programme),
      (rows) => rows.length === 1,
    );
    expect((await mara.browser.request("DELETE", `/api/rules/${rule.id}`)).status).toBe(204);
    expect(await scheduledOf(programme)).toEqual([]);
  });
});

const groupAsAdmin = async (rule: Rule, name: string) => {
  const grouped = await admin.request("POST", `/api/rules/${rule.id}/collection`, {
    name,
    layout: { parts: [], path: ["{title}"] },
  });
  expect(grouped.status).toBe(200);
  return (grouped.json as { id: string }).id;
};

const collectionRow = async (id: string) =>
  (await db((write) => write.select().from(collections).where(eq(collections.id, id))))[0];

describe("undoing a series recording with a linked collection", () => {
  it("keeps the collection, unlinked, when someone who may not edit collections undoes", async () => {
    const jonas = await profile("jonas4");
    const rule = await ruleFor(jonas.browser, freshProgramme(), "Jonas undo");
    const collectionId = await groupAsAdmin(rule, "Jonas undo");
    expect((await jonas.browser.request("DELETE", `/api/rules/${rule.id}?undo=true`)).status).toBe(
      204,
    );
    expect(await collectionRow(collectionId)).toMatchObject({ id: collectionId, ruleId: null });
  });

  it("takes the collection back when an admin undoes", async () => {
    const rule = await ruleFor(admin, freshProgramme(), "Admin undo");
    const collectionId = await groupAsAdmin(rule, "Admin undo");
    expect((await admin.request("DELETE", `/api/rules/${rule.id}?undo=true`)).status).toBe(204);
    expect(await collectionRow(collectionId)).toBeUndefined();
  });
});

describe("Group them", () => {
  it("links exactly one collection when asked twice at once", async () => {
    const rule = await ruleFor(admin, freshProgramme(), "Twice at once");
    const body = { name: "Twice at once", layout: { parts: [], path: ["{title}"] } };
    const answers = await Promise.all([
      admin.request("POST", `/api/rules/${rule.id}/collection`, body),
      admin.request("POST", `/api/rules/${rule.id}/collection`, body),
    ]);
    expect(answers.map((answer) => answer.status).toSorted((a, b) => a - b)).toEqual([200, 409]);
    expect(answers.find((answer) => answer.status === 409)?.json).toMatchObject({
      code: "alreadyGrouped",
    });
    const linked = await db((write) =>
      write.select().from(collections).where(eq(collections.ruleId, rule.id)),
    );
    expect(linked).toHaveLength(1);
    const stored = (await admin.request("GET", `/api/rules/${rule.id}`)).json as Rule;
    expect(stored.collectionId).toBe(linked[0]?.id);
  });
});

describe("a rule's episode history", () => {
  it("counts and forgets the owner's history when an admin looks at someone else's rule", async () => {
    const mara = await profile("mara5");
    const programme = freshProgramme();
    const rule = await ruleFor(mara.browser, programme);
    await db((write) =>
      write.insert(episodeHistory).values(
        [1, 2].map((episode) => ({
          id: `history-${rule.id}-${episode}`,
          userId: mara.id,
          ruleId: rule.id,
          showKey: programme.title.toLowerCase(),
          season: 1,
          episode,
          class: "Episode" as const,
          airedAt: Date.now() - DAY,
          channelId: programme.channelId,
          title: programme.title,
          createdAt: Date.now(),
        })),
      ),
    );
    const count = async (browser: Browser) =>
      ((await browser.request("GET", `/api/rules/${rule.id}/history`)).json as { count: number })
        .count;
    expect(await count(admin)).toBe(2);
    expect(await count(mara.browser)).toBe(2);

    const forgotten = await admin.request("DELETE", `/api/rules/${rule.id}/history`);
    expect(forgotten.json).toEqual({ count: 0 });
    expect(await count(mara.browser)).toBe(0);
    const left = await db((write) =>
      write.select().from(episodeHistory).where(eq(episodeHistory.ruleId, rule.id)),
    );
    expect(left).toEqual([]);
  });
});
