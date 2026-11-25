/**
 * Which recordings a viewer sees (SPEC 7.8), through the one helper every service uses: admins
 * and unrestricted profiles see all, a channel-limited profile sees its channels, and a
 * collection-limited one sees what is placed today in its collections.
 */
import { assert, describe, it } from "@effect/vitest";
import { Context, DateTime, Effect, Layer } from "effect";
import {
  type AccessPolicy,
  ChannelId,
  CollectionId,
  emptyMatcher,
  fullAccess,
  type Recording,
  RecordingId,
  type User,
  UserId,
} from "@slipstream/domain";
import { ServerConfig } from "../src/config.ts";
import { Db } from "../src/db/client.ts";
import { collections } from "../src/db/schema.ts";
import { seesRecording, type Viewer, visibleRecordings } from "../src/household/viewer.ts";
import { tempDir, testSettings } from "./support.ts";

const timeZone = "Europe/Berlin";
const kika = ChannelId.make("kika");
const sky = ChannelId.make("sky-sport-f1");
const kids = CollectionId.make("kids");

const openDb = (root: string) =>
  Layer.build(Db.layer.pipe(Layer.provide(ServerConfig.layerWith(testSettings(root))))).pipe(
    Effect.map((context) => Context.get(context, Db)),
  );

const recording = (id: string, channelId: ChannelId, title: string): Recording => ({
  id: RecordingId.make(id),
  channelId,
  start: DateTime.makeUnsafe("2026-11-22T17:00:00Z"),
  end: DateTime.makeUnsafe("2026-11-22T18:00:00Z"),
  title,
  categories: [],
  repeat: false,
  live: false,
  padding: { beforeMinutes: 0, afterMinutes: 0 },
  state: "completed",
  problems: [],
  ownerIds: [UserId.make("alex")],
  protected: false,
  labels: [],
  exportStatus: "none",
  createdAt: DateTime.makeUnsafe("2026-11-20T00:00:00Z"),
});

const viewer = (role: User["role"], access: AccessPolicy): Viewer => ({
  user: {
    id: UserId.make(role),
    username: role,
    displayName: role,
    role,
    createdAt: DateTime.makeUnsafe("2026-11-01T00:00:00Z"),
  },
  kind: "household",
  access,
});

const sandmann = recording("sandmann", kika, "Unser Sandmännchen");
const kikaNews = recording("kika-news", kika, "logo!");
const race = recording("race", sky, "Live F1: Rennen");
const all = [sandmann, kikaNews, race];
const ids = (list: ReadonlyArray<Recording>) => list.map((item) => item.id);

/** A database with one collection, "Kids", which takes the Sandmännchen. */
const withKidsCollection = Effect.gen(function* () {
  const db = yield* openDb(yield* tempDir);
  yield* db.write.insert(collections).values({
    id: kids,
    name: "Kids",
    rank: 1,
    matcher: {
      ...emptyMatcher,
      title: [{ _tag: "StartsWith", values: ["Unser Sandmännchen"] }],
    },
    labels: [],
    layout: { parts: [], path: [] },
  });
  return db;
});

describe("visibleRecordings", () => {
  it.effect("lets admins and unrestricted profiles see every recording", () =>
    Effect.gen(function* () {
      const db = yield* withKidsCollection;
      // The stored policy of an admin is ignored: admins always see everything.
      const admin = viewer("admin", { channelIds: [], collectionIds: [], mayRecord: false });
      assert.deepStrictEqual(
        ids(yield* visibleRecordings(db.read, admin, all, timeZone)),
        ids(all),
      );
      const open = viewer("user", fullAccess);
      assert.deepStrictEqual(ids(yield* visibleRecordings(db.read, open, all, timeZone)), ids(all));
      assert.isTrue(yield* seesRecording(db.read, open, race, timeZone));
    }).pipe(Effect.scoped),
  );

  it.effect("shows a channel-limited profile only its channels", () =>
    Effect.gen(function* () {
      const db = yield* withKidsCollection;
      const limited = viewer("user", { channelIds: [kika], mayRecord: true });
      assert.deepStrictEqual(ids(yield* visibleRecordings(db.read, limited, all, timeZone)), [
        sandmann.id,
        kikaNews.id,
      ]);
      assert.isFalse(yield* seesRecording(db.read, limited, race, timeZone));
      // A stored recording (with its server-side fields) works the same.
      const stored = { recording: race, stoppedAt: undefined, frameAt: undefined };
      assert.isFalse(yield* seesRecording(db.read, limited, stored, timeZone));
    }).pipe(Effect.scoped),
  );

  it.effect("shows a collection-limited profile only what is placed in its collections", () =>
    Effect.gen(function* () {
      const db = yield* withKidsCollection;
      const child = viewer("user", { collectionIds: [kids], mayRecord: false });
      assert.deepStrictEqual(ids(yield* visibleRecordings(db.read, child, all, timeZone)), [
        sandmann.id,
      ]);
      assert.isTrue(yield* seesRecording(db.read, child, sandmann, timeZone));
      assert.isFalse(yield* seesRecording(db.read, child, kikaNews, timeZone));
      // Channel and collection limits both apply.
      const both = viewer("user", { channelIds: [sky], collectionIds: [kids], mayRecord: false });
      assert.deepStrictEqual(ids(yield* visibleRecordings(db.read, both, all, timeZone)), []);
      assert.deepStrictEqual(yield* visibleRecordings(db.read, child, [], timeZone), []);
    }).pipe(Effect.scoped),
  );
});
