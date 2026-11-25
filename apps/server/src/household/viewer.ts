/**
 * Who is asking, in household terms (SPEC 7.8): the signed-in user plus whether they are a
 * household profile or a guest, and what their access policy lets them see and do. Services
 * filter and refuse with it; admins always have full access.
 */
import { eq } from "drizzle-orm";
import { Effect } from "effect";
import { Forbidden, NotFound } from "@slipstream/api";
import {
  type AccessPolicy,
  type AccountKind,
  canSeeChannel,
  canSeeDestination,
  type ChannelId,
  type CollectionId,
  type CollectionSubject,
  type Destination,
  fullAccess,
  placeInCollection,
  type Recording,
  type User,
} from "@slipstream/domain";
import type { Database, Transaction } from "../db/client.ts";
import { users } from "../db/schema.ts";
import { loadCollections, loadRuleCollections } from "../recordings/store.ts";

/** The caller with their account kind and effective access policy. */
export interface Viewer {
  readonly user: User;
  readonly kind: AccountKind;
  /** Effective policy: always {@link fullAccess} for admins. */
  readonly access: AccessPolicy;
}

/** The effective policy of an account row: admins are never restricted. */
export const effectiveAccess = (
  role: User["role"],
  stored: AccessPolicy | null | undefined,
): AccessPolicy => (role === "admin" ? fullAccess : (stored ?? fullAccess));

/** Loads the caller's kind and access. A user deleted mid-request counts as a guest without access. */
export const loadViewer = (db: Database, user: User): Effect.Effect<Viewer> =>
  db
    .select({ kind: users.kind, access: users.access })
    .from(users)
    .where(eq(users.id, user.id))
    .pipe(
      Effect.map(([row]) =>
        row === undefined
          ? {
              user,
              kind: "guest" as const,
              access: { channelIds: [], collectionIds: [], mayRecord: false },
            }
          : { user, kind: row.kind, access: effectiveAccess(user.role, row.access) },
      ),
      Effect.orDie,
    );

/** Whether the viewer sees the channel. */
export const seesChannel = (viewer: Viewer, channelId: string): boolean =>
  canSeeChannel(viewer.access, channelId as ChannelId);

/** Whether the viewer sees something that lands at `destination`. */
export const seesDestination = (viewer: Viewer, destination: Destination): boolean =>
  canSeeDestination(viewer.access, destination);

/** Whether the viewer sees the collection in the library. */
export const seesCollection = (viewer: Viewer, collectionId: string): boolean =>
  viewer.access.collectionIds === undefined ||
  viewer.access.collectionIds.includes(collectionId as CollectionId);

/** Whether the viewer sees everything without looking at a recording: admins and full access. */
const seesAllRecordings = (viewer: Viewer): boolean =>
  viewer.user.role === "admin" ||
  (viewer.access.channelIds === undefined && viewer.access.collectionIds === undefined);

/**
 * The collection each recording sits in today (pinned, its rule's, or the best matcher), by
 * recording id; absent for automatic groups. Access checks go by it, and only here.
 */
const placedCollections = (db: Database, list: ReadonlyArray<Recording>, timeZone: string) =>
  Effect.gen(function* () {
    const result = new Map<string, CollectionId>();
    if (list.length === 0) return result;
    const all = yield* loadCollections(db);
    const byRule = yield* loadRuleCollections(db);
    for (const recording of list) {
      const placed = placeInCollection(all, recording, {
        timeZone,
        ruleCollectionId: recording.ruleId === undefined ? undefined : byRule.get(recording.ruleId),
      });
      if (placed !== undefined) result.set(recording.id, placed.collection.id);
    }
    return result;
  });

/** A recording, or anything that carries one (the store's `StoredRecording`). */
type HasRecording = Recording | { readonly recording: Recording };

const recordingOf = (item: HasRecording): Recording =>
  "recording" in item ? item.recording : item;

/**
 * The recordings among `list` the viewer sees (SPEC 7.8): those on a channel they see and, for a
 * collection-limited profile, placed today in one of their collections. Admins and profiles
 * without limits see all without a query; a channel-limited profile needs no placement; the
 * placement of the rest is worked out in one batch. Order is kept.
 */
export const visibleRecordings = <A extends HasRecording>(
  db: Database,
  viewer: Viewer,
  list: ReadonlyArray<A>,
  timeZone: string,
): Effect.Effect<Array<A>> =>
  Effect.gen(function* () {
    if (seesAllRecordings(viewer)) return [...list];
    const onSeenChannels = list.filter((item) => seesChannel(viewer, recordingOf(item).channelId));
    if (viewer.access.collectionIds === undefined) return onSeenChannels;
    const placed = yield* placedCollections(db, onSeenChannels.map(recordingOf), timeZone);
    return onSeenChannels.filter((item) => {
      const recording = recordingOf(item);
      return seesDestination(viewer, {
        channelId: recording.channelId,
        collectionId: placed.get(recording.id),
      });
    });
  }).pipe(Effect.orDie);

/** What deciding whether someone sees a recording reads from it; planned airings fit too. */
export type SeenSubject = Omit<CollectionSubject, "labels"> & {
  readonly labels?: ReadonlyArray<string> | undefined;
};

/**
 * `seesRecording` for everyone at once, without a query per question: what planning needs to
 * ask "may this person see that copy?" for every owner and every candidate (recording model
 * §3.6). The same rule as {@link visibleRecordings}: admins and profiles without limits see all;
 * otherwise the channel must be theirs and, for a collection-limited profile, the placement too.
 * Unknown people see nothing.
 */
export const loadRecordingSeer = (db: Database | Transaction, timeZone: string) =>
  Effect.gen(function* () {
    const rows = yield* db
      .select({ id: users.id, role: users.role, access: users.access })
      .from(users);
    const accessOf = new Map(rows.map((row) => [row.id, effectiveAccess(row.role, row.access)]));
    const all = yield* loadCollections(db);
    const byRule = yield* loadRuleCollections(db);
    const seesChannelOf = (userId: string, channelId: ChannelId): boolean => {
      const access = accessOf.get(userId);
      return access !== undefined && canSeeChannel(access, channelId);
    };
    const sees = (userId: string, recording: SeenSubject): boolean => {
      const access = accessOf.get(userId);
      if (access === undefined) return false;
      if (!canSeeChannel(access, recording.channelId)) return false;
      if (access.collectionIds === undefined) return true;
      const placed = placeInCollection(
        all,
        { ...recording, labels: recording.labels ?? [] },
        {
          timeZone,
          ruleCollectionId:
            recording.ruleId === undefined ? undefined : byRule.get(recording.ruleId),
        },
      );
      return canSeeDestination(access, {
        channelId: recording.channelId,
        collectionId: placed?.collection.id,
      });
    };
    return { sees, seesChannel: seesChannelOf };
  }).pipe(Effect.orDie);

/** Whether the viewer sees one recording; see {@link visibleRecordings}. */
export const seesRecording = (
  db: Database,
  viewer: Viewer,
  recording: HasRecording,
  timeZone: string,
): Effect.Effect<boolean> =>
  Effect.map(visibleRecordings(db, viewer, [recording], timeZone), (seen) => seen.length > 0);

/** Fails with `NotFound` (entity `channel`) when the viewer may not see the channel. */
export const requireChannel = (viewer: Viewer, channelId: string): Effect.Effect<void, NotFound> =>
  seesChannel(viewer, channelId)
    ? Effect.void
    : Effect.fail(new NotFound({ entity: "channel", id: channelId }));

/** Fails with `Forbidden` unless the viewer may schedule recordings and create rules. */
export const requireMayRecord = (viewer: Viewer): Effect.Effect<void, Forbidden> =>
  viewer.access.mayRecord ? Effect.void : Effect.fail(new Forbidden());

/**
 * Checks the collection a recording or rule of the viewer goes to: a collection-limited profile
 * must name one of its own collections, because anything else would vanish from its library.
 */
export const requireOwnDestination = (
  viewer: Viewer,
  collectionId: string | undefined,
): Effect.Effect<void, Forbidden> =>
  viewer.access.collectionIds === undefined ||
  (collectionId !== undefined && seesCollection(viewer, collectionId))
    ? Effect.void
    : Effect.fail(new Forbidden());
