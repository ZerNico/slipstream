/**
 * Guide queries (PLAN 6.4): programmes by time window, now/next per channel, full-text search
 * (FTS5) and single programmes. Programmes are stored per XMLTV channel and reach curated
 * channels through `channels.guide_channel_id`. What a person asks for is filtered to the
 * channels their profile sees (SPEC 7.8); `between` and `programme` are the unfiltered view the
 * recorder and other services use.
 */
import { and, asc, desc, eq, gt, inArray, lt, sql, type SQL } from "drizzle-orm";
import { Clock, Context, DateTime, Effect, Layer } from "effect";
import { type GuideExtent, InvalidInput, NotFound, type NowNext } from "@slipstream/api";
import {
  ChannelId,
  type GuideEntry,
  guideWindowMaxMillis,
  type Instant,
  type Programme,
  ProgrammeId,
  type User,
} from "@slipstream/domain";
import { Db } from "../db/client.ts";
import { opt, toInstant } from "../db/codec.ts";
import { channels, programmes } from "../db/schema.ts";
import { loadViewer, seesChannel, type Viewer } from "../household/viewer.ts";
import { liveChannel, onLiveChannel } from "../channels/lineup.ts";

type ProgrammeRow = typeof programmes.$inferSelect;

/** A stored programme as the API shows it on one channel. */
export const toProgramme = (row: ProgrammeRow, channelId: string): Programme => ({
  id: ProgrammeId.make(row.id),
  channelId: ChannelId.make(channelId),
  start: toInstant(row.start),
  end: toInstant(row.end),
  title: row.title,
  ...opt("subtitle", row.subtitle),
  ...opt("description", row.description),
  categories: row.categories,
  ...opt("episode", row.episode),
  ...opt("originalAirDate", row.originalAirDate),
  repeat: row.repeat,
  live: row.live,
  ...opt("imageUrl", row.imageUrl),
  ...opt("onlineImageUrl", row.onlineImageUrl),
});

/** The columns a guide entry reads: none of the details (description, pictures, air date). */
const entryColumns = {
  id: programmes.id,
  start: programmes.start,
  end: programmes.end,
  title: programmes.title,
  subtitle: programmes.subtitle,
  categories: programmes.categories,
  episode: programmes.episode,
  repeat: programmes.repeat,
  live: programmes.live,
};
type EntryRow = { readonly [K in keyof typeof entryColumns]: ProgrammeRow[K] };

/** A stored programme as the guide grid shows it on one channel. */
const toEntry = (row: EntryRow, channelId: string): GuideEntry => ({
  id: ProgrammeId.make(row.id),
  channelId: ChannelId.make(channelId),
  start: toInstant(row.start),
  end: toInstant(row.end),
  title: row.title,
  ...opt("subtitle", row.subtitle),
  categories: row.categories,
  ...opt("episode", row.episode),
  repeat: row.repeat,
  live: row.live,
});

/**
 * The columns planning reads: an entry's plus what identifies an episode and matches a rule
 * (description, original air date); no pictures.
 */
const airingColumns = {
  ...entryColumns,
  description: programmes.description,
  originalAirDate: programmes.originalAirDate,
};
type AiringRow = { readonly [K in keyof typeof airingColumns]: ProgrammeRow[K] };

/** A stored programme as planning sees it: everything but its pictures. */
const toAiring = (row: AiringRow, channelId: string): Programme => ({
  ...toEntry(row, channelId),
  ...opt("description", row.description),
  ...opt("originalAirDate", row.originalAirDate),
});

const SEARCH_LIMIT = 100;

/** How far ahead now/next looks for what comes next. */
const NOW_NEXT_MILLIS = 86_400_000;

/**
 * Builds an FTS5 query from what someone typed: every word must appear, as a prefix, so
 * "qual f1" finds "F1: Qualifying". FTS5 syntax characters become spaces inside the quoted word,
 * so the index's tokenizer splits it as it split the title: "16:04" is the phrase "16 04" and
 * finds "Kurzsendung 16:04".
 */
export const ftsQuery = (input: string): string | undefined => {
  const terms = input
    .split(/\s+/u)
    .map((term) => term.replaceAll(/["*^:(){}[\]]/gu, " ").trim())
    .filter((term) => term !== "");
  return terms.length === 0 ? undefined : terms.map((term) => `"${term}"*`).join(" ");
};

/**
 * Keeps the first programme per channel and start (two sources may carry the same guide), as
 * `toApi` shows it.
 */
const dedupeWith = <Row extends { readonly start: number }, A>(
  rows: ReadonlyArray<{ readonly p: Row; readonly channelId: string }>,
  toApi: (row: Row, channelId: string) => A,
): Array<A> => {
  const seen = new Set<string>();
  return rows.flatMap((row) => {
    const key = `${row.channelId}\u0000${row.p.start}`;
    if (seen.has(key)) return [];
    seen.add(key);
    return [toApi(row.p, row.channelId)];
  });
};
const dedupe = (rows: ReadonlyArray<{ readonly p: ProgrammeRow; readonly channelId: string }>) =>
  dedupeWith(rows, toProgramme);

/** The SQL condition for "a channel the viewer sees"; `undefined` when they see them all. */
const viewerChannels = (viewer: Viewer) =>
  viewer.access.channelIds === undefined
    ? undefined
    : viewer.access.channelIds.length === 0
      ? sql`0`
      : inArray(channels.id, [...viewer.access.channelIds]);

const makeGuide = Effect.gen(function* () {
  const { read } = yield* Db;

  const select = (where: SQL | undefined) =>
    read
      .select({ p: programmes, channelId: channels.id })
      .from(programmes)
      .innerJoin(channels, onLiveChannel(programmes.guideChannelId))
      .where(where);

  /** Programmes overlapping `[fromMs, toMs)` on the given channels, or all visible ones. */
  const between = (fromMs: number, toMs: number, channelIds?: ReadonlyArray<string>) =>
    select(
      and(
        lt(programmes.start, toMs),
        gt(programmes.end, fromMs),
        channelIds === undefined
          ? eq(channels.hidden, false)
          : inArray(channels.id, [...channelIds]),
      ),
    )
      .orderBy(asc(channels.id), asc(programmes.start))
      .pipe(Effect.map(dedupe), Effect.orDie);

  /**
   * Programmes on visible channels overlapping `[fromMs, toMs)` without their pictures: what
   * planning reads for its whole horizon.
   */
  const airings = (fromMs: number, toMs: number) =>
    read
      .select({ p: airingColumns, channelId: channels.id })
      .from(programmes)
      .innerJoin(channels, onLiveChannel(programmes.guideChannelId))
      .where(
        and(lt(programmes.start, toMs), gt(programmes.end, fromMs), eq(channels.hidden, false)),
      )
      .orderBy(asc(channels.id), asc(programmes.start))
      .pipe(
        Effect.map((rows) => dedupeWith(rows, toAiring)),
        Effect.orDie,
      );

  /** Guide entries matching `where`, by channel and start. */
  const entries = (where: SQL | undefined) =>
    read
      .select({ p: entryColumns, channelId: channels.id })
      .from(programmes)
      .innerJoin(channels, onLiveChannel(programmes.guideChannelId))
      .where(where)
      .orderBy(asc(channels.id), asc(programmes.start))
      .pipe(
        Effect.map((rows) => dedupeWith(rows, toEntry)),
        Effect.orDie,
      );

  /**
   * The guide window for a viewer, as guide entries. Asking for channels by id reaches hidden
   * channels only for admins; everyone else gets the visible channels their profile sees.
   */
  const window = (viewer: Viewer, from: Instant, to: Instant, channelList: string | undefined) => {
    const fromMs = DateTime.toEpochMillis(from);
    const toMs = DateTime.toEpochMillis(to);
    if (toMs <= fromMs) {
      return Effect.fail(new InvalidInput({ problems: [{ path: "to", code: "beforeFrom" }] }));
    }
    if (toMs - fromMs > guideWindowMaxMillis) {
      return Effect.fail(new InvalidInput({ problems: [{ path: "to", code: "windowTooLong" }] }));
    }
    const ids = channelList
      ?.split(",")
      .map((id) => id.trim())
      .filter((id) => id !== "");
    if (ids !== undefined && ids.length === 0) return Effect.succeed([]);
    const overlapping = and(lt(programmes.start, toMs), gt(programmes.end, fromMs));
    if (viewer.user.role === "admin") {
      return entries(
        and(
          overlapping,
          ids === undefined ? eq(channels.hidden, false) : inArray(channels.id, ids),
        ),
      );
    }
    return entries(
      and(
        overlapping,
        eq(channels.hidden, false),
        ids === undefined ? undefined : inArray(channels.id, ids),
        viewerChannels(viewer),
      ),
    );
  };

  /** Where the viewer's guide data ends: the last programme on a visible channel they see. */
  const extent = (viewer: Viewer) =>
    read
      .select({ end: programmes.end })
      .from(programmes)
      .innerJoin(channels, onLiveChannel(programmes.guideChannelId))
      .where(and(eq(channels.hidden, false), viewerChannels(viewer)))
      // The end index finds the last one without reading the rest.
      .orderBy(desc(programmes.end))
      .limit(1)
      .pipe(
        Effect.map(([row]): GuideExtent => (row === undefined ? {} : { end: toInstant(row.end) })),
        Effect.orDie,
      );

  /**
   * What is on now and next on every visible channel the viewer sees, from the next day of
   * guide. Full programmes: the home hero shows their descriptions and pictures.
   */
  const nowNext = (viewer: Viewer) =>
    Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis;
      const seen = and(eq(channels.hidden, false), liveChannel, viewerChannels(viewer));
      const visible = yield* read
        .select({ id: channels.id })
        .from(channels)
        .where(seen)
        .pipe(Effect.orDie);
      const upcoming = yield* select(
        and(lt(programmes.start, now + NOW_NEXT_MILLIS), gt(programmes.end, now), seen),
      )
        .orderBy(asc(channels.id), asc(programmes.start))
        .pipe(Effect.map(dedupe), Effect.orDie);
      // In start order per channel: the first that began is on now, the first to come is next.
      const slots = new Map<string, { now?: Programme; next?: Programme }>();
      for (const programme of upcoming) {
        const slot = slots.get(programme.channelId) ?? {};
        if (DateTime.toEpochMillis(programme.start) <= now) slot.now ??= programme;
        else slot.next ??= programme;
        slots.set(programme.channelId, slot);
      }
      return visible.map(({ id }) => {
        const slot = slots.get(id);
        return {
          channelId: ChannelId.make(id),
          ...opt("now", slot?.now),
          ...opt("next", slot?.next),
        } satisfies typeof NowNext.Type;
      });
    });

  /** Search, limited to the viewer's channels in SQL so the limit counts only what they see. */
  const search = (viewer: Viewer, q: string, from: Instant | undefined) =>
    Effect.gen(function* () {
      const match = ftsQuery(q);
      if (match === undefined) return [];
      const fromMs =
        from === undefined ? yield* Clock.currentTimeMillis : DateTime.toEpochMillis(from);
      const rows = yield* select(
        and(
          sql`${programmes.rowid} IN (SELECT rowid FROM programmes_fts WHERE programmes_fts MATCH ${match})`,
          gt(programmes.end, fromMs),
          eq(channels.hidden, false),
          viewerChannels(viewer),
        ),
      )
        .orderBy(asc(programmes.start))
        .limit(SEARCH_LIMIT)
        .pipe(Effect.orDie);
      return dedupe(rows);
    });

  const programme = (programmeId: string) =>
    Effect.gen(function* () {
      const [row] = yield* select(eq(programmes.id, programmeId))
        .orderBy(asc(channels.hidden), asc(channels.id))
        .limit(1)
        .pipe(Effect.orDie);
      if (row === undefined) return yield* new NotFound({ entity: "programme", id: programmeId });
      return toProgramme(row.p, row.channelId);
    });

  return {
    window: (actor: User, from: Instant, to: Instant, channelList: string | undefined) =>
      Effect.flatMap(loadViewer(read, actor), (viewer) => window(viewer, from, to, channelList)),
    extent: (actor: User) => Effect.flatMap(loadViewer(read, actor), extent),
    nowNext: (actor: User) => Effect.flatMap(loadViewer(read, actor), nowNext),
    search: (actor: User, q: string, from: Instant | undefined) =>
      Effect.flatMap(loadViewer(read, actor), (viewer) => search(viewer, q, from)),
    /** One programme as the actor sees it; `NotFound` on a channel they may not see. */
    programmeFor: (actor: User, programmeId: string) =>
      Effect.gen(function* () {
        const found = yield* programme(programmeId);
        const viewer = yield* loadViewer(read, actor);
        if (!seesChannel(viewer, found.channelId)) {
          return yield* new NotFound({ entity: "programme", id: programmeId });
        }
        return found;
      }),
    programme,
    between,
    airings,
  };
});

/** Guide queries. */
export class Guide extends Context.Service<Guide, Effect.Success<typeof makeGuide>>()(
  "@slipstream/server/Guide",
) {
  static readonly layer = Layer.effect(Guide, makeGuide);
}
