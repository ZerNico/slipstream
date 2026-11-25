/**
 * The recording model on the server (docs/design/recording-model.md §3.3–§3.7, §7) through the
 * real HTTP server against the fake source's guide: linked collections and their invariant,
 * the collection offer, rule deletion with its collection and its undo, episode history,
 * deleting damaged recordings, "Keep the original", guide repeats and record options per
 * viewer, and older clients that do not know `skipRepeats`.
 *
 * Library rows the recorder would write (finished, failed and replaced recordings) are seeded
 * straight into the database.
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { and, eq } from "drizzle-orm";
import { Effect } from "effect";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startFakeSource, type RunningFakeSource } from "@slipstream/fake-source";
import {
  captures,
  collections,
  episodeHistory,
  recordingOwners,
  recordings,
  rules,
  segments,
} from "../src/db/schema.ts";
import { Browser, startTestServer, type TestServer } from "./harness.ts";

const MINUTE = 60_000;
const DAY = 86_400_000;
const password = "correct horse battery staple";
/** What a browser plays, for playback sessions. */
const capabilities = {
  video: [],
  audio: ["aac"],
  audioPassthrough: [],
  hdr: false,
  canDeinterlace: true,
};

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
  readonly subtitle?: string;
  readonly description?: string;
  readonly categories: ReadonlyArray<string>;
  readonly episode?: Record<string, unknown>;
  readonly repeat: boolean;
  readonly live: boolean;
}
interface Rule {
  readonly id: string;
  readonly name: string;
  readonly skipRepeats: boolean;
  readonly offerDeclined: boolean;
  readonly collectionId?: string;
}
interface Collection {
  readonly id: string;
  readonly name: string;
  readonly matcher: { readonly title: ReadonlyArray<{ readonly values?: ReadonlyArray<string> }> };
  readonly follows?: { readonly ruleId: string; readonly ruleName?: string };
}
interface Entry {
  readonly id: string;
  readonly ownerIds: ReadonlyArray<string>;
  readonly hiddenAt?: string;
  readonly replaces?: {
    readonly recordingId: string;
    readonly replacedAt?: string;
    readonly keepUntil?: string;
  };
  readonly rerun?: { readonly state: string; readonly repeat?: { readonly recordingId: string } };
}

let server: TestServer;
let fake: RunningFakeSource & { close(): Promise<void> };
let admin: Browser;
let adminId: string;
let f1: Channel;
let regional: Channel;
let serienwelt: Channel;

beforeAll(async () => {
  [server, fake] = await Promise.all([startTestServer(), startFakeSource({ guideHours: 72 })]);
  admin = new Browser(server.url);
  const setup = await admin.request("POST", "/api/auth/setup", {
    username: "admin",
    displayName: "Admin",
    password,
  });
  adminId = (setup.json as { user: { id: string } }).user.id;
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
  const channels = (await admin.request("GET", "/api/channels")).json as Array<Channel>;
  const byName = (name: string) => channels.find((channel) => channel.name === name)!;
  f1 = byName("Sportkanal F1 HD");
  regional = byName("Regional Fernsehen");
  serienwelt = byName("Serienwelt HD");
});

afterAll(async () => {
  await Promise.all([server?.close(), fake?.close()]);
});

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

/** A rule body: titles starting with `prefix` on one channel, nothing else set. */
const ruleBody = (name: string, channelId: string, prefix: string, extra = {}) => ({
  name,
  enabled: false,
  matcher: {
    channels: [channelId],
    title: [{ _tag: "StartsWith", values: [prefix] }],
    categories: [],
    weekdays: [],
  },
  padding: { beforeMinutes: 0, afterMinutes: 0 },
  retention: { _tag: "KeepAll" },
  ...extra,
});

const createRule = async (browser: Browser, body: Record<string, unknown>) => {
  const created = await browser.request("POST", "/api/rules", body);
  expect(created.status).toBe(200);
  return created.json as Rule;
};

const layout = { parts: [], path: ["{year}", "{title}"] };

/** "Group them" as the admin: a collection that follows the rule. */
const group = async (ruleId: string, name: string) => {
  const grouped = await admin.request("POST", `/api/rules/${ruleId}/collection`, { name, layout });
  expect(grouped.status).toBe(200);
  const collection = grouped.json as Collection;
  expect(collection.follows?.ruleId).toBe(ruleId);
  return collection;
};

const collectionOf = async (collectionId: string) =>
  admin.request("GET", `/api/collections/${collectionId}`);

/** Runs a database effect against the server. */
const db = <A, E>(effect: (write: TestServer["db"]["write"]) => Effect.Effect<A, E>) =>
  server.run(effect(server.db.write));

/** A recording's row, as the database holds it. */
const rowOf = (recordingId: string) =>
  db((write) => write.select().from(recordings).where(eq(recordings.id, recordingId)));

let seeded = 0;

/** A recording row as the recorder leaves it, with its owners (and who added them). */
const seedRecording = async (options: {
  readonly channelId: string;
  readonly title: string;
  readonly owners: ReadonlyArray<{ readonly userId: string; readonly addedByRuleId?: string }>;
  readonly state?: "completed" | "failed" | "incomplete";
  readonly startMs?: number;
  readonly ruleId?: string;
  readonly programme?: Programme;
  readonly extra?: Partial<typeof recordings.$inferInsert>;
}) => {
  seeded += 1;
  const id = `seeded-${seeded}`;
  const startMs = options.startMs ?? Date.now() - 2 * DAY - seeded * 3 * 3_600_000;
  const programme = options.programme;
  await db((write) =>
    Effect.gen(function* () {
      yield* write.insert(recordings).values({
        id,
        channelId: options.channelId,
        start: startMs,
        end: startMs + 45 * MINUTE,
        title: options.title,
        subtitle: programme?.subtitle ?? null,
        description: programme?.description ?? null,
        categories: programme?.categories ?? [],
        episode: (programme?.episode as never) ?? null,
        repeat: false,
        live: false,
        paddingBeforeMinutes: 0,
        paddingAfterMinutes: 0,
        state: options.state ?? "completed",
        problems: [],
        ruleId: options.ruleId ?? null,
        protected: false,
        exportStatus: "none",
        createdAt: startMs,
        ...options.extra,
      });
      yield* write.insert(recordingOwners).values(
        options.owners.map((owner, index) => ({
          recordingId: id,
          userId: owner.userId,
          addedAt: startMs + index,
          addedByRuleId: owner.addedByRuleId ?? null,
        })),
      );
    }),
  );
  return id;
};

describe("series recordings and their linked collections", () => {
  it("keeps skipRepeats when an older client PATCHes a rule without it", async () => {
    const rule = await createRule(
      admin,
      ruleBody("Every airing", f1.id, "Old Client", { skipRepeats: false }),
    );
    expect(rule).toMatchObject({ skipRepeats: false, offerDeclined: false });
    const renamed = await admin.request("PATCH", `/api/rules/${rule.id}`, { name: "Renamed" });
    expect(renamed.json).toMatchObject({ name: "Renamed", skipRepeats: false });
    const created = await createRule(admin, ruleBody("Default", f1.id, "New Client"));
    expect(created.skipRepeats).toBe(true);
    const stored = (await admin.request("GET", `/api/rules/${rule.id}`)).json as Rule;
    expect(stored.skipRepeats).toBe(false);
  });

  it("links a collection to a rule and rewrites its snapshot with every save", async () => {
    const rule = await createRule(admin, ruleBody("Snapshot", f1.id, "Snap"));
    const collection = await group(rule.id, "Snapshots");
    expect((await admin.request("GET", `/api/rules/${rule.id}`)).json).toMatchObject({
      collectionId: collection.id,
    });
    // Twice is a conflict: the rule records into a collection already.
    const again = await admin.request("POST", `/api/rules/${rule.id}/collection`, {
      name: "Twice",
    });
    expect(again.status).toBe(409);

    await admin.request("PATCH", `/api/rules/${rule.id}`, {
      matcher: {
        channels: [f1.id],
        title: [{ _tag: "StartsWith", values: ["Snapper"] }],
        categories: [],
        weekdays: ["mon"],
      },
    });
    const followed = (await collectionOf(collection.id)).json as Collection;
    expect(followed.follows).toEqual({ ruleId: rule.id, ruleName: "Snapshot" });
    expect(followed.matcher.title[0]?.values).toEqual(["Snapper"]);
    const [row] = await db((write) =>
      write.select().from(collections).where(eq(collections.id, collection.id)),
    );
    // The stored snapshot is the rule's what conditions, without its weekdays.
    expect(row?.matcher).toMatchObject({ title: [{ values: ["Snapper"] }], weekdays: [] });
  });

  it("refuses a matcher on a linked collection (FollowsRule) and unlinks on request", async () => {
    const rule = await createRule(admin, ruleBody("Follows", f1.id, "Follow"));
    const collection = await group(rule.id, "Followers");
    const refused = await admin.request("PATCH", `/api/collections/${collection.id}`, {
      matcher: {
        channels: [],
        title: [{ _tag: "Contains", values: ["x"] }],
        categories: [],
        weekdays: [],
      },
    });
    expect(refused.status).toBe(409);
    expect(refused.json).toMatchObject({ code: "followsRule" });
    const renamed = await admin.request("PATCH", `/api/collections/${collection.id}`, {
      name: "Renamed followers",
    });
    expect(renamed.status).toBe(200);
    expect((renamed.json as Collection).follows?.ruleId).toBe(rule.id);

    const unlinked = await admin.request("POST", `/api/collections/${collection.id}/unlink`);
    expect(unlinked.status).toBe(200);
    expect((unlinked.json as Collection).follows).toBeUndefined();
    expect((unlinked.json as Collection).matcher.title[0]?.values).toEqual(["Follow"]);
    // Its own conditions from now on: a matcher change is fine.
    const changed = await admin.request("PATCH", `/api/collections/${collection.id}`, {
      matcher: {
        channels: [f1.id],
        title: [{ _tag: "Contains", values: ["x"] }],
        categories: [],
        weekdays: [],
      },
    });
    expect(changed.status).toBe(200);
  });

  it("unlinks when Goes to leaves the followed collection", async () => {
    const rule = await createRule(admin, ruleBody("Goes to", f1.id, "Goes"));
    const collection = await group(rule.id, "Goes to");
    const moved = await admin.request("PATCH", `/api/rules/${rule.id}`, { collectionId: null });
    expect(moved.status).toBe(200);
    expect((moved.json as Rule).collectionId).toBeUndefined();
    const kept = (await collectionOf(collection.id)).json as Collection;
    expect(kept.follows).toBeUndefined();
    expect(kept.matcher.title[0]?.values).toEqual(["Goes"]);
  });

  it("unlinks first when someone who may not edit collections changes the conditions", async () => {
    const jonas = await profile("jonas");
    const rule = await createRule(jonas.browser, ruleBody("Jonas", f1.id, "Jonas Show"));
    // Linking takes the right to create collections.
    const refused = await jonas.browser.request("POST", `/api/rules/${rule.id}/collection`, {
      name: "Mine",
    });
    expect(refused.status).toBe(403);
    const collection = await group(rule.id, "Jonas");

    // A save that keeps the conditions keeps the link.
    await jonas.browser.request("PATCH", `/api/rules/${rule.id}`, { name: "Jonas renamed" });
    expect(((await collectionOf(collection.id)).json as Collection).follows?.ruleId).toBe(rule.id);

    const edited = await jonas.browser.request("PATCH", `/api/rules/${rule.id}`, {
      matcher: {
        channels: [f1.id],
        title: [{ _tag: "StartsWith", values: ["Jonas Other"] }],
        categories: [],
        weekdays: [],
      },
    });
    expect(edited.status).toBe(200);
    const kept = (await collectionOf(collection.id)).json as Collection;
    expect(kept.follows).toBeUndefined();
    expect(kept.matcher.title[0]?.values).toEqual(["Jonas Show"]);
  });

  it("keeps or removes the collection when its rule is deleted", async () => {
    const keep = await createRule(admin, ruleBody("Keep", f1.id, "Keep"));
    const kept = await group(keep.id, "Kept");
    expect((await admin.request("DELETE", `/api/rules/${keep.id}`)).status).toBe(204);
    const after = (await collectionOf(kept.id)).json as Collection;
    expect(after.follows).toBeUndefined();
    expect(after.matcher.title[0]?.values).toEqual(["Keep"]);

    const remove = await createRule(admin, ruleBody("Remove", f1.id, "Remove"));
    const removed = await group(remove.id, "Removed");
    expect(
      (await admin.request("DELETE", `/api/rules/${remove.id}?collection=remove`)).status,
    ).toBe(204);
    expect((await collectionOf(removed.id)).status).toBe(404);
  });

  it("unlinks the collections of a deleted person's rules before they cascade", async () => {
    const lea = await profile("lea");
    const rule = await createRule(lea.browser, ruleBody("Lea", f1.id, "Lea Show"));
    const collection = await group(rule.id, "Lea");
    expect((await admin.request("DELETE", `/api/profiles/${lea.id}`)).status).toBe(204);
    const after = await collectionOf(collection.id);
    expect(after.status).toBe(200);
    expect((after.json as Collection).follows).toBeUndefined();
    expect((after.json as Collection).matcher.title[0]?.values).toEqual(["Lea Show"]);
  });

  it("deletes the collection when Group them is undone, without declining the offer", async () => {
    const rule = await createRule(admin, ruleBody("Ungroup", f1.id, "Ungroup"));
    const collection = await group(rule.id, "Ungroup");
    expect((await admin.request("DELETE", `/api/rules/${rule.id}/collection`)).status).toBe(204);
    expect((await collectionOf(collection.id)).status).toBe(404);
    expect((await admin.request("GET", `/api/rules/${rule.id}`)).json).toMatchObject({
      offerDeclined: false,
    });
  });

  it("sets offerDeclined when a collection a rule records into is deleted", async () => {
    const rule = await createRule(admin, ruleBody("Deleted collection", f1.id, "Deleted"));
    const collection = await group(rule.id, "Deleted");
    expect((await admin.request("DELETE", `/api/collections/${collection.id}`)).status).toBe(204);
    const after = (await admin.request("GET", `/api/rules/${rule.id}`)).json as Rule;
    expect(after.collectionId).toBeUndefined();
    expect(after.offerDeclined).toBe(true);
  });
});

describe("the collection offer", () => {
  it("offers to group scattering F1 sessions until it is declined", async () => {
    const rule = await createRule(admin, ruleBody("Live F1", f1.id, "Live F1:", { enabled: true }));
    const offer = await admin.request("GET", `/api/rules/${rule.id}/offer`);
    expect(offer.status).toBe(200);
    const { offer: found } = offer.json as { offer?: { name: string; groups: number } };
    expect(found?.name).toBe("Live F1");
    expect(found?.groups).toBeGreaterThanOrEqual(2);

    const preview = await admin.request("POST", "/api/rules/preview", {
      rule: ruleBody("Live F1", f1.id, "Live F1:", { enabled: true }),
    });
    expect((preview.json as { offer?: { name: string } }).offer?.name).toBe("Live F1");

    const declined = await admin.request("POST", `/api/rules/${rule.id}/offer/decline`);
    expect(declined.json).toMatchObject({ offerDeclined: true });
    expect((await admin.request("GET", `/api/rules/${rule.id}/offer`)).json).toEqual({});
    expect((await admin.request("DELETE", `/api/rules/${rule.id}`)).status).toBe(204);
  });

  it("never offers anything to someone who may not create collections", async () => {
    const tom = await profile("tom");
    const rule = await createRule(tom.browser, ruleBody("Tom F1", f1.id, "Live F1:"));
    expect((await tom.browser.request("GET", `/api/rules/${rule.id}/offer`)).json).toEqual({});
  });
});

describe("undoing Record series", () => {
  it("takes back the rule, the owners it added and its collection within 10 minutes", async () => {
    const maja = await profile("maja");
    const rule = await createRule(admin, ruleBody("Undo me", f1.id, "Undo Show"));
    const collection = await group(rule.id, "Undo");
    const recordingId = await seedRecording({
      channelId: f1.id,
      title: "Undo Show",
      owners: [{ userId: maja.id }, { userId: adminId, addedByRuleId: rule.id }],
    });
    const undone = await admin.request("DELETE", `/api/rules/${rule.id}?undo=true`);
    expect(undone.status).toBe(204);
    expect((await admin.request("GET", `/api/rules/${rule.id}`)).status).toBe(404);
    expect((await collectionOf(collection.id)).status).toBe(404);
    const entry = (await admin.request("GET", `/api/recordings/${recordingId}`)).json as Entry;
    expect(entry.ownerIds).toEqual([maja.id]);
  });

  it("refuses an undo after 10 minutes", async () => {
    const rule = await createRule(admin, ruleBody("Too late", f1.id, "Too Late"));
    await db((write) =>
      write
        .update(rules)
        .set({ createdAt: Date.now() - 11 * MINUTE })
        .where(eq(rules.id, rule.id)),
    );
    const late = await admin.request("DELETE", `/api/rules/${rule.id}?undo=true`);
    expect(late.status).toBe(409);
    expect(late.json).toMatchObject({ code: "undoExpired" });
    expect((await admin.request("GET", `/api/rules/${rule.id}`)).status).toBe(200);
  });
});

/** The caller's guide repeats for the next three days. */
const repeatsFor = async (browser: Browser) => {
  const from = new Date().toISOString();
  const to = new Date(Date.now() + 3 * DAY).toISOString();
  const answer = await browser.request("GET", `/api/guide/repeats?from=${from}&to=${to}`);
  expect(answer.status).toBe(200);
  return answer.json as Array<{
    programmeId: string;
    ruleId?: string;
    of: { recordingId?: string; state: string };
  }>;
};

/** The programme sheet's record options for the caller. */
const recordOptions = async (browser: Browser, programmeId: string) =>
  (await browser.request("GET", `/api/programmes/${programmeId}/record-options`)).json as {
    status: { _tag: string; ruleId?: string; of?: { recordingId?: string } };
  };

describe("episodes people have", () => {
  let mara: Awaited<ReturnType<typeof profile>>;
  let kids: Awaited<ReturnType<typeof profile>>;
  let maraRule: Rule;
  /** The regional channel's late repeat of the series channel's prime-time episode. */
  let repeat: Programme;
  let maraCopy: string;

  beforeAll(async () => {
    mara = await profile("mara");
    kids = await profile("kids", { channelIds: [regional.id], mayRecord: false });
    const from = new Date();
    const to = new Date(from.getTime() + 3 * DAY);
    const guide = (
      await admin.request(
        "GET",
        `/api/guide?from=${from.toISOString()}&to=${to.toISOString()}&channels=${regional.id}`,
      )
    ).json as Array<Programme>;
    repeat = guide.find(
      (programme) =>
        programme.title === "Kommissar Brandt" && Date.parse(programme.start) > Date.now() + MINUTE,
    )!;
    expect(repeat).toBeDefined();
    // Mara recorded the episode when it first aired on the series channel.
    maraCopy = await seedRecording({
      channelId: serienwelt.id,
      title: repeat.title,
      programme: repeat,
      owners: [{ userId: mara.id }],
      startMs: Date.parse(repeat.start) - DAY - 3 * 3_600_000,
    });
    maraRule = await createRule(
      mara.browser,
      ruleBody("Kommissar Brandt", regional.id, "Kommissar Brandt", { enabled: true }),
    );
  });

  it("marks the repeat for everyone who may see the copy, and only for them", async () => {
    const forMara = (await repeatsFor(mara.browser)).find((item) => item.programmeId === repeat.id);
    expect(forMara).toMatchObject({ ruleId: maraRule.id, of: { recordingId: maraCopy } });
    const forAdmin = (await repeatsFor(admin)).find((item) => item.programmeId === repeat.id);
    expect(forAdmin?.of.recordingId).toBe(maraCopy);
    expect(forAdmin?.ruleId).toBeUndefined();
    // Kids sees the regional channel but not Mara's copy on the series channel.
    expect((await repeatsFor(kids.browser)).map((item) => item.programmeId)).not.toContain(
      repeat.id,
    );
  });

  it("answers Repeat to the rule's owner, Owned to others who see the copy", async () => {
    // A scheduler that does not leave repeats out yet schedules the airing for Mara's rule;
    // with the recording model's planner there is nothing to remove here.
    await db((write) =>
      write
        .delete(recordings)
        .where(and(eq(recordings.programmeId, repeat.id), eq(recordings.state, "scheduled"))),
    );
    expect((await recordOptions(mara.browser, repeat.id)).status).toMatchObject({
      _tag: "Repeat",
      ruleId: maraRule.id,
      of: { recordingId: maraCopy },
    });
    expect((await recordOptions(admin, repeat.id)).status).toMatchObject({
      _tag: "Owned",
      of: { recordingId: maraCopy },
    });
    expect((await recordOptions(kids.browser, repeat.id)).status).toEqual({
      _tag: "NotScheduled",
    });
  });

  const historyCount = async () =>
    (
      (await mara.browser.request("GET", `/api/rules/${maraRule.id}/history`)).json as {
        count: number;
      }
    ).count;

  it("remembers deleted good episodes, unless asked to record them again", async () => {
    const good = await seedRecording({
      channelId: regional.id,
      title: "Kommissar Brandt",
      programme: { ...repeat, subtitle: "Spurlos", description: "Kommissar Brandt, Folge 99." },
      owners: [{ userId: mara.id }],
      ruleId: maraRule.id,
    });
    expect(await historyCount()).toBe(0);
    expect((await mara.browser.request("DELETE", `/api/recordings/${good}`)).status).toBe(204);
    expect(await historyCount()).toBe(1);

    const again = await seedRecording({
      channelId: regional.id,
      title: "Kommissar Brandt",
      programme: { ...repeat, subtitle: "Blutsbande", description: "Kommissar Brandt, Folge 98." },
      owners: [{ userId: mara.id }],
      ruleId: maraRule.id,
    });
    expect(
      (await mara.browser.request("DELETE", `/api/recordings/${again}?history=skip`)).status,
    ).toBe(204);
    expect(await historyCount()).toBe(1);

    const forgotten = await mara.browser.request("DELETE", `/api/rules/${maraRule.id}/history`);
    expect(forgotten.json).toEqual({ count: 0 });
    expect(await historyCount()).toBe(0);
  });

  it("keeps looking for the repeat of a deleted damaged recording, without history", async () => {
    const until = Date.now() + 14 * DAY;
    const damaged = await seedRecording({
      channelId: regional.id,
      title: "Kommissar Brandt",
      programme: { ...repeat, subtitle: "Ebbe", description: "Kommissar Brandt, Folge 97." },
      owners: [{ userId: mara.id }],
      ruleId: maraRule.id,
      state: "failed",
      extra: { rerunUntil: until },
    });
    const before = (await mara.browser.request("GET", `/api/recordings/${damaged}`)).json as Entry;
    expect(before.rerun?.state).toBe("looking");
    expect((await mara.browser.request("DELETE", `/api/recordings/${damaged}`)).status).toBe(204);
    // Gone for people; the row stays as the anchor of the search.
    const listed = (await mara.browser.request("GET", "/api/recordings")).json as Array<Entry>;
    expect(listed.map((entry) => entry.id)).not.toContain(damaged);
    expect((await mara.browser.request("GET", `/api/recordings/${damaged}`)).status).toBe(404);
    const [anchor] = await rowOf(damaged);
    expect(anchor).toMatchObject({ hiddenReason: "deleted", rerunOutcome: null });
    expect(anchor?.hiddenAt).not.toBeNull();
    expect(await historyCount()).toBe(0);

    const stop = await seedRecording({
      channelId: regional.id,
      title: "Kommissar Brandt",
      programme: { ...repeat, subtitle: "Der Lotse", description: "Kommissar Brandt, Folge 96." },
      owners: [{ userId: mara.id }],
      ruleId: maraRule.id,
      state: "failed",
      extra: { rerunUntil: until },
    });
    expect(
      (await mara.browser.request("DELETE", `/api/recordings/${stop}?rerun=stop`)).status,
    ).toBe(204);
    expect((await mara.browser.request("GET", `/api/recordings/${stop}`)).status).toBe(404);
    expect(await historyCount()).toBe(0);
    const rows = await db((write) =>
      write.select().from(episodeHistory).where(eq(episodeHistory.userId, mara.id)),
    );
    expect(rows).toEqual([]);
  });

  it("ends the repeat searches of a deleted rule and removes its anchors", async () => {
    const gone = await createRule(
      mara.browser,
      ruleBody("Brandt (gone)", regional.id, "Kommissar Brandt", { enabled: true }),
    );
    const until = Date.now() + 14 * DAY;
    const looking = await seedRecording({
      channelId: regional.id,
      title: "Kommissar Brandt",
      programme: { ...repeat, subtitle: "Flut", description: "Kommissar Brandt, Folge 95." },
      owners: [{ userId: mara.id }],
      ruleId: gone.id,
      state: "failed",
      extra: { rerunUntil: until },
    });
    const anchor = await seedRecording({
      channelId: regional.id,
      title: "Kommissar Brandt",
      programme: { ...repeat, subtitle: "Sturm", description: "Kommissar Brandt, Folge 94." },
      owners: [{ userId: mara.id }],
      ruleId: gone.id,
      state: "failed",
      extra: { rerunUntil: until, hiddenAt: Date.now() - DAY, hiddenReason: "deleted" },
    });
    expect((await mara.browser.request("DELETE", `/api/rules/${gone.id}`)).status).toBe(204);
    // The damaged recording stays in the library without a search; the anchor only held one.
    expect(await rowOf(looking)).toMatchObject([{ ruleId: null, rerunOutcome: "declined" }]);
    expect(await rowOf(anchor)).toEqual([]);
  });

  /** A damaged original of Mara's rule and a good repeat pointing at it, as the recorder leaves them. */
  const seedChain = async (title: string, original: Partial<typeof recordings.$inferInsert>) => {
    const originalId = await seedRecording({
      channelId: serienwelt.id,
      title,
      owners: [{ userId: mara.id }],
      ruleId: maraRule.id,
      state: "failed",
      extra: { rerunUntil: Date.now() + 10 * DAY, ...original },
    });
    const repeatId = await seedRecording({
      channelId: regional.id,
      title,
      owners: [{ userId: mara.id }],
      ruleId: maraRule.id,
      startMs: Date.now() - DAY - 3 * 3_600_000,
      extra: { replacesId: originalId },
    });
    await db((write) =>
      write.update(recordings).set({ replacedById: repeatId }).where(eq(recordings.id, originalId)),
    );
    return { originalId, repeatId };
  };

  it("brings back a replaced original with Keep the original", async () => {
    const hiddenAt = Date.now() - DAY;
    const { originalId, repeatId } = await seedChain("Hotel am See", {
      hiddenAt,
      hiddenReason: "replaced",
    });
    const replaced = (await mara.browser.request("GET", `/api/recordings/${originalId}`))
      .json as Entry;
    expect(replaced.rerun).toMatchObject({ state: "replaced", repeat: { recordingId: repeatId } });
    // The repeat the original's entry names says when it replaced it and until when it can be
    // undone, so clients need not guess.
    const exposed = replaced.rerun?.repeat?.recordingId ?? "";
    const repeatEntry = (await mara.browser.request("GET", `/api/recordings/${exposed}`))
      .json as Entry;
    expect(repeatEntry.replaces).toEqual({
      recordingId: originalId,
      start: expect.any(String),
      channelId: serienwelt.id,
      replacedAt: new Date(hiddenAt).toISOString(),
      keepUntil: new Date(hiddenAt + 7 * DAY).toISOString(),
    });

    const kept = await mara.browser.request("POST", `/api/recordings/${exposed}/keep-original`);
    expect(kept.status).toBe(200);
    expect(kept.json).toMatchObject({ id: originalId, rerun: { state: "kept" } });
    expect((kept.json as Entry).hiddenAt).toBeUndefined();
    expect(await rowOf(originalId)).toMatchObject([
      { hiddenAt: null, hiddenReason: null, replacedById: null, rerunOutcome: "kept" },
    ]);
    const listed = (await mara.browser.request("GET", "/api/recordings")).json as Array<Entry>;
    expect(listed.map((entry) => entry.id)).toEqual(expect.arrayContaining([originalId, repeatId]));
    const after = (await mara.browser.request("GET", `/api/recordings/${repeatId}`)).json as Entry;
    expect(after.replaces?.replacedAt).toBeUndefined();
    expect(after.replaces?.keepUntil).toBeUndefined();
    const twice = await mara.browser.request("POST", `/api/recordings/${repeatId}/keep-original`);
    expect(twice.status).toBe(409);
    expect(twice.json).toMatchObject({ code: "notReplaced" });
  });

  it("never brings back an anchor a repeat replaced later", async () => {
    // Deleted by Mara while its chain looked; a repeat then replaced it.
    const { originalId, repeatId } = await seedChain("Hotel am Fluss", {
      hiddenAt: Date.now() - DAY,
      hiddenReason: "deleted",
    });
    const repeatEntry = (await mara.browser.request("GET", `/api/recordings/${repeatId}`))
      .json as Entry;
    expect(repeatEntry.replaces?.recordingId).toBe(originalId);
    expect(repeatEntry.replaces?.replacedAt).toBeUndefined();
    expect(repeatEntry.replaces?.keepUntil).toBeUndefined();
    const refused = await mara.browser.request("POST", `/api/recordings/${repeatId}/keep-original`);
    expect(refused.status).toBe(409);
    expect(refused.json).toMatchObject({ code: "notReplaced" });
    expect(await rowOf(originalId)).toMatchObject([
      { hiddenReason: "deleted", replacedById: repeatId, rerunOutcome: null },
    ]);
  });

  it("deletes the segments of a recording deleted while its repeat is looked for", async () => {
    // Twenty days back, so no other recording on the channel covers its stretch.
    const startMs = Date.now() - 20 * DAY;
    const damaged = await seedRecording({
      channelId: regional.id,
      title: "Kommissar Brandt",
      owners: [{ userId: mara.id }],
      ruleId: maraRule.id,
      state: "failed",
      startMs,
      extra: { rerunUntil: Date.now() + 5 * DAY },
    });
    const captureId = `capture-${damaged}`;
    const directory = join(server.root, "data", captureId);
    mkdirSync(directory, { recursive: true });
    const files = [0, 1].map((sequence) => {
      const path = `seg-${sequence}.ts`;
      writeFileSync(join(directory, path), Buffer.alloc(1000, sequence));
      return {
        captureId,
        sequence,
        runId: "run-1",
        startMs: startMs + 31 * MINUTE + sequence * 6000,
        durationMs: 6000,
        bytes: 1000,
        path,
      };
    });
    await db((write) =>
      Effect.gen(function* () {
        yield* write.insert(captures).values({
          id: captureId,
          channelId: regional.id,
          sourceStreamId: "stream-1",
          startedAt: startMs,
          endedAt: startMs + 45 * MINUTE,
          state: "stopped",
          stats: { bytes: 2000, segments: 2, reconnects: 0 },
          directory,
        });
        yield* write.insert(segments).values(files);
      }),
    );
    const before = await mara.browser.request("GET", `/api/recordings/${damaged}`);
    expect((before.json as Entry & { sizeBytes: number }).sizeBytes).toBe(2000);
    const played = await mara.browser.request("POST", "/api/playback/sessions", {
      source: { _tag: "Recording", recordingId: damaged },
      capabilities,
      quality: { _tag: "Auto" },
    });
    expect(played.status).toBe(200);
    const playlistUrl = new URL((played.json as { playlistUrl: string }).playlistUrl, server.url);
    expect((await fetch(playlistUrl)).status).toBe(200);

    expect((await mara.browser.request("DELETE", `/api/recordings/${damaged}`)).status).toBe(204);
    // The segments went at once; the row stays as the anchor of the search.
    const held = await db((write) =>
      write.select().from(segments).where(eq(segments.captureId, captureId)),
    );
    expect(held).toEqual([]);
    expect(files.some((file) => existsSync(join(directory, file.path)))).toBe(false);
    const [anchor] = await rowOf(damaged);
    expect(anchor?.hiddenReason).toBe("deleted");
    const hiddenAt = anchor?.hiddenAt;
    expect(hiddenAt).not.toBeNull();

    // Gone for people: no entry, no playback, no playlist, even with a token signed before.
    expect((await mara.browser.request("GET", `/api/recordings/${damaged}`)).status).toBe(404);
    const again = await mara.browser.request("POST", "/api/playback/sessions", {
      source: { _tag: "Recording", recordingId: damaged },
      capabilities,
      quality: { _tag: "Auto" },
    });
    expect(again.status).toBe(404);
    expect((await fetch(playlistUrl)).status).toBe(404);

    // Deleting it again changes nothing: it keeps the moment it was deleted.
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect((await mara.browser.request("DELETE", `/api/recordings/${damaged}`)).status).toBe(204);
    expect((await rowOf(damaged))[0]).toMatchObject({ hiddenAt, hiddenReason: "deleted" });
    // "Stop looking" ends its chain, and with it the anchor.
    expect(
      (await mara.browser.request("DELETE", `/api/recordings/${damaged}?rerun=stop`)).status,
    ).toBe(204);
    expect(await rowOf(damaged)).toEqual([]);
  });
});
