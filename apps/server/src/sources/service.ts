/**
 * Sources (PLAN 6.1): CRUD with write-only secrets, and the refresh that fetches a playlist and
 * guide with `@slipstream/sources` and stores streams, guide channels and the cleaned guide.
 * A background loop refreshes every enabled source when its interval is up.
 */
import { and, asc, eq, inArray, notInArray, sql } from "drizzle-orm";
import { Clock, Context, Duration, Effect, Layer, Schedule, Semaphore } from "effect";
import {
  InvalidInput,
  NotFound,
  SourceFailed,
  type InputProblem,
  type SourceCheck,
  type SourceStreamEntry,
  type SourceStreamFilter,
} from "@slipstream/api";
import {
  ChannelId,
  type ChannelMatch,
  qualityRank,
  streamMatcher,
  streamQuality,
  applySecretHeadersPatch,
  applySourceConfigPatch,
  type Source,
  SourceId,
  type SourceInput,
  type SourceUpdate,
  SourceStreamId,
  sensitivePlainHeaders,
  type SourceStreamView,
  type User,
  viewSource,
  viewSourceStream,
} from "@slipstream/domain";
import {
  compileRewrites,
  M3uXmltvSource,
  type SourceError,
  type SourceSnapshot,
} from "@slipstream/sources";
import { requireAdmin } from "../auth/service.ts";
import { ServerConfig } from "../config.ts";
import { Db } from "../db/client.ts";
import { chunks, opt, toInstant } from "../db/codec.ts";
import {
  channels,
  channelStreams,
  guideChannels,
  programmes,
  sources,
  sourceStreams,
} from "../db/schema.ts";
import { EventBus } from "../events.ts";
import {
  addStreamsAsChannels,
  attachByGuide,
  loadGuideIcons,
  matchableChannels,
  toChannel,
} from "../channels/lineup.ts";
import { newId } from "../ids.ts";
import { adapterConfig, programmeRow, streamCandidates } from "./mapping.ts";
import { SecretBox } from "./secret-box.ts";
import { sealedColumns, sealStreamUrl, sourceFromRow, type SourceRow } from "./store.ts";

const toStreamView = (row: typeof sourceStreams.$inferSelect): SourceStreamView =>
  viewSourceStream({
    id: SourceStreamId.make(row.id),
    sourceId: SourceId.make(row.sourceId),
    upstreamId: row.upstreamId,
    name: row.name,
    url: row.url,
    ...opt("tvgId", row.tvgId),
    ...opt("logoUrl", row.logoUrl),
    ...opt("group", row.group),
    lastSeenAt: toInstant(row.lastSeenAt),
  });

/** Maps an adapter failure onto the API error and the health shown for the source. */
const toFailure = (error: SourceError) => {
  switch (error.reason) {
    case "http-status":
      return {
        error: new SourceFailed({ reason: "httpError", ...opt("httpStatus", error.status) }),
        health:
          error.status === 429 || error.status === 509 || error.status === 403
            ? ("limitReached" as const)
            : ("unreachable" as const),
      };
    case "invalid-playlist":
      return {
        error: new SourceFailed({ reason: "invalidPlaylist" }),
        health: "unreachable" as const,
      };
    case "invalid-guide":
    case "no-guide-url":
      return {
        error: new SourceFailed({ reason: "invalidGuide" }),
        health: "unreachable" as const,
      };
    case "too-large":
      return { error: new SourceFailed({ reason: "tooLarge" }), health: "unreachable" as const };
    case "invalid-config":
      return {
        error: new SourceFailed({ reason: "invalidPlaylist" }),
        health: "unreachable" as const,
      };
    case "unreachable":
    case "timeout":
      return { error: new SourceFailed({ reason: "unreachable" }), health: "unreachable" as const };
  }
};

/** Domain checks the schema cannot express. */
const validate = (input: typeof SourceInput.Type) =>
  Effect.gen(function* () {
    const problems: Array<InputProblem> = [];
    if (input.config._tag !== "M3u") {
      problems.push({ path: "config._tag", code: "unsupportedSourceType" });
    }
    // Credentials in plain headers would show in every admin view; they belong in secretHeaders.
    for (const name of sensitivePlainHeaders(input.headers)) {
      problems.push({ path: `headers.${name}`, code: "secretHeader" });
    }
    // Streams kept for recordings come out of the limit; more than it has makes no sense.
    if (
      input.keptForRecordings !== undefined &&
      input.maxStreams !== undefined &&
      input.keptForRecordings > input.maxStreams
    ) {
      problems.push({ path: "keptForRecordings", code: "aboveMaxStreams" });
    }
    const compiled = yield* Effect.result(
      compileRewrites(
        input.guideCleanup.rewrites.map((rewrite) => ({
          field: rewrite.field === "subtitle" ? ("subTitle" as const) : ("title" as const),
          pattern: rewrite.pattern,
          set: {},
        })),
      ),
    );
    if (compiled._tag === "Failure") {
      problems.push({
        path: `guideCleanup.rewrites.${compiled.failure.index}.pattern`,
        code: "invalidRegex",
      });
    }
    if (problems.length > 0) return yield* new InvalidInput({ problems });
  });

const summarise = (snapshot: SourceSnapshot, checkedAt: number): typeof SourceCheck.Type => {
  const guideIds = new Set(snapshot.guide.channels.map((channel) => channel.id));
  const streams = streamCandidates(snapshot.playlist.entries);
  return {
    streams: streams.length,
    guideChannels: guideIds.size,
    programmes: snapshot.guide.programmes.length,
    unmappedStreams: streams.filter(
      (stream) => stream.tvgId === undefined || !guideIds.has(stream.tvgId),
    ).length,
    checkedAt: toInstant(checkedAt),
  };
};

/** One stream of a source as the picker's listing reads it. */
interface StreamListRow {
  readonly id: string;
  readonly name: string;
  readonly group: string | null;
  readonly tvgId: string | null;
  readonly logoUrl: string | null;
  readonly channelNumber: string | null;
  readonly firstSeenAt: number;
  readonly lastSeenAt: number;
  readonly ignoredAt: number | null;
  readonly hasGuide: boolean;
  readonly channelId: string | null;
  readonly channelName: string | null;
}

/** How the picker asks for streams. */
export interface CatalogueQuery {
  readonly search?: string | undefined;
  readonly group?: string | undefined;
  readonly filter?: SourceStreamFilter | undefined;
  readonly offset?: number | undefined;
  readonly limit?: number | undefined;
}

interface SourceGroupCounts {
  readonly group: string | null;
  streams: number;
  withGuide: number;
  added: number;
  new: number;
  ignored: number;
}

const DEFAULT_PAGE = 500;
const MAX_PAGE = 5000;

/** First seen since the source was last reviewed, neither added nor ignored. */
const isNew = (row: StreamListRow, source: SourceRow) =>
  row.channelId === null &&
  row.ignoredAt === null &&
  (source.reviewedAt === null || row.firstSeenAt > source.reviewedAt);

/** Kept by a channel although the last refresh no longer listed it. */
const isGone = (row: StreamListRow, source: SourceRow) =>
  source.lastRefreshAt !== null && row.lastSeenAt < source.lastRefreshAt;

const keepFor = (filter: SourceStreamFilter, row: StreamListRow, source: SourceRow) => {
  switch (filter) {
    case "all":
      return true;
    case "added":
      return row.channelId !== null;
    case "notAdded":
      return row.channelId === null && row.ignoredAt === null;
    case "new":
      return isNew(row, source);
    case "ignored":
      return row.ignoredAt !== null;
  }
};

/** Groups by name, the streams without a group last. */
const groupOrder = (a: string | null, b: string | null) =>
  a === b ? 0 : a === null ? 1 : b === null ? -1 : a.localeCompare(b);

const streamEntry = (
  row: StreamListRow,
  source: SourceRow,
  match: ((stream: { name: string; tvgId?: string }) => ChannelMatch | undefined) | undefined,
  names: ReadonlyMap<string, string>,
): SourceStreamEntry => {
  const quality = streamQuality(row.name);
  const found =
    row.channelId === null && row.ignoredAt === null && match !== undefined
      ? match({ name: row.name, ...opt("tvgId", row.tvgId) })
      : undefined;
  return {
    id: SourceStreamId.make(row.id),
    name: row.name,
    ...opt("group", row.group),
    ...opt("tvgId", row.tvgId),
    ...opt("logoUrl", row.logoUrl),
    ...opt("channelNumber", row.channelNumber),
    quality,
    qualityRank: qualityRank(quality),
    hasGuide: row.hasGuide,
    ...(row.channelId === null
      ? {}
      : { channel: { id: ChannelId.make(row.channelId), name: row.channelName ?? "" } }),
    ...(found === undefined
      ? {}
      : {
          match: {
            channelId: ChannelId.make(found.channelId),
            name: names.get(found.channelId) ?? "",
            reason: found.reason,
          },
        }),
    new: isNew(row, source),
    ignored: row.ignoredAt !== null,
    gone: isGone(row, source),
  };
};

const ROWS_PER_INSERT = 200;

/** Playlists up to this many streams become channels on their first refresh. */
const SMALL_PLAYLIST = 100;

const makeSources = Effect.gen(function* () {
  const { write, read } = yield* Db;
  const adapter = yield* M3uXmltvSource;
  const bus = yield* EventBus;
  const box = yield* SecretBox;
  // Imports are writer-bound anyway; one at a time keeps scheduled and manual refreshes apart.
  const refreshLock = yield* Semaphore.make(1);

  const findRow = (sourceId: string) =>
    Effect.gen(function* () {
      const [row] = yield* read
        .select()
        .from(sources)
        .where(eq(sources.id, sourceId))
        .pipe(Effect.orDie);
      if (row === undefined) return yield* new NotFound({ entity: "source", id: sourceId });
      return row;
    });

  const fetchSnapshot = (source: Source) =>
    source.config._tag === "M3u"
      ? adapter
          .refresh(adapterConfig(source.config, source))
          .pipe(Effect.mapError((error) => toFailure(error)))
      : Effect.fail({
          error: new SourceFailed({ reason: "invalidPlaylist" }),
          health: "unreachable" as const,
        });

  /**
   * Stores one refresh: streams upserted, guide replaced. The first refresh of a small playlist
   * adds its streams as channels; afterwards new streams with an existing channel's guide id
   * join that channel, and with `autoAddNew` new streams of groups already added are added.
   */
  const store = (source: SourceRow, snapshot: SourceSnapshot, now: number) =>
    write.transaction((tx) =>
      Effect.gen(function* () {
        const sourceId = source.id;
        const stored = yield* tx
          .select()
          .from(sourceStreams)
          .where(eq(sourceStreams.sourceId, sourceId));
        const byUpstream = new Map(stored.map((row) => [row.upstreamId, row]));
        const candidates = streamCandidates(snapshot.playlist.entries);
        const created: Array<typeof sourceStreams.$inferInsert> = [];
        for (const candidate of candidates) {
          const values = {
            name: candidate.name,
            url: sealStreamUrl(box, candidate.url),
            tvgId: candidate.tvgId ?? null,
            logoUrl: candidate.logoUrl ?? null,
            group: candidate.group ?? null,
            channelNumber: candidate.channelNumber ?? null,
            userAgent: candidate.userAgent ?? null,
            referrer: candidate.referrer ?? null,
            lastSeenAt: now,
          };
          const known = byUpstream.get(candidate.upstreamId);
          if (known === undefined) {
            created.push({
              id: newId(),
              sourceId,
              upstreamId: candidate.upstreamId,
              firstSeenAt: now,
              ...values,
            });
          } else {
            yield* tx.update(sourceStreams).set(values).where(eq(sourceStreams.id, known.id));
          }
        }
        for (const batch of chunks(created, ROWS_PER_INSERT)) {
          yield* tx.insert(sourceStreams).values([...batch]);
        }
        // Streams the playlist dropped go, unless a channel still points at them.
        const seen = candidates.map((candidate) => candidate.upstreamId);
        const linked = tx.select({ id: channelStreams.sourceStreamId }).from(channelStreams);
        yield* tx
          .delete(sourceStreams)
          .where(
            and(
              eq(sourceStreams.sourceId, sourceId),
              seen.length === 0 ? sql`1 = 1` : notInArray(sourceStreams.upstreamId, seen),
              notInArray(sourceStreams.id, linked),
            ),
          );

        yield* tx.delete(guideChannels).where(eq(guideChannels.sourceId, sourceId));
        const guideRows = snapshot.guide.channels.map((channel) => ({
          sourceId,
          xmltvId: channel.id,
          displayName: channel.displayNames[0] ?? channel.id,
          iconUrl: channel.icon ?? null,
        }));
        for (const batch of chunks(guideRows, ROWS_PER_INSERT)) {
          yield* tx
            .insert(guideChannels)
            .values([...batch])
            .onConflictDoNothing();
        }

        yield* tx.delete(programmes).where(eq(programmes.sourceId, sourceId));
        const rows = snapshot.guide.programmes.flatMap(
          (programme) => programmeRow(sourceId, programme) ?? [],
        );
        for (const batch of chunks(rows, ROWS_PER_INSERT)) {
          yield* tx
            .insert(programmes)
            .values([...batch])
            .onConflictDoNothing();
        }

        const newStreams = created.map((stream) => ({
          id: stream.id ?? "",
          name: stream.name,
          tvgId: stream.tvgId ?? null,
          logoUrl: stream.logoUrl ?? null,
          channelNumber: stream.channelNumber ?? null,
          group: stream.group ?? null,
        }));
        let reviewedAt = source.reviewedAt;
        if (stored.length === 0 && created.length > 0 && created.length <= SMALL_PLAYLIST) {
          // Works with defaults: a small playlist's streams all become channels the first time.
          yield* addStreamsAsChannels(tx, newStreams);
          reviewedAt = now;
        } else if (newStreams.length > 0) {
          yield* attachByGuide(tx, newStreams);
          if (source.autoAddNew) {
            const addedGroups = new Set(
              (yield* tx
                .selectDistinct({ group: sourceStreams.group })
                .from(sourceStreams)
                .innerJoin(channelStreams, eq(channelStreams.sourceStreamId, sourceStreams.id))
                .where(eq(sourceStreams.sourceId, sourceId))).map((row) => row.group),
            );
            yield* addStreamsAsChannels(
              tx,
              newStreams.filter((stream) => addedGroups.has(stream.group)),
            );
          }
        }
        yield* tx
          .update(sources)
          .set({ health: "ok", lastRefreshAt: now, reviewedAt })
          .where(eq(sources.id, sourceId));
      }),
    );

  const refreshRow = (row: SourceRow) =>
    Effect.gen(function* () {
      const source = yield* sourceFromRow(box, row);
      const snapshot = yield* fetchSnapshot(source).pipe(
        Effect.tapError((failure) =>
          Effect.gen(function* () {
            yield* write
              .update(sources)
              .set({ health: failure.health })
              .where(eq(sources.id, row.id))
              .pipe(Effect.orDie);
            if (row.health !== failure.health) {
              yield* bus.publish({
                _tag: "SourceHealthChanged",
                sourceId: source.id,
                health: failure.health,
              });
            }
            yield* Effect.logWarning("Source refresh failed").pipe(
              Effect.annotateLogs({ source: row.name, reason: failure.error.reason }),
            );
          }),
        ),
        Effect.mapError((failure) => failure.error),
      );
      const now = yield* Clock.currentTimeMillis;
      yield* store(row, snapshot, now).pipe(Effect.orDie);
      if (row.health !== "ok") {
        yield* bus.publish({ _tag: "SourceHealthChanged", sourceId: source.id, health: "ok" });
      }
      yield* bus.publish({ _tag: "GuideRefreshed", sourceId: source.id });
      const check = summarise(snapshot, now);
      yield* Effect.logInfo("Source refreshed").pipe(
        Effect.annotateLogs({
          source: row.name,
          streams: check.streams,
          programmes: check.programmes,
        }),
      );
      return check;
    }).pipe(refreshLock.withPermits(1));

  const create = Effect.fn("Sources.create")(function* (
    actor: User,
    input: typeof SourceInput.Type,
  ) {
    yield* requireAdmin(actor);
    yield* validate(input);
    const row: SourceRow = {
      id: newId(),
      name: input.name,
      ...sealedColumns(box, input),
      refreshIntervalMinutes: input.refreshIntervalMinutes,
      maxStreams: input.maxStreams ?? null,
      keptForRecordings: input.keptForRecordings ?? null,
      userAgent: input.userAgent ?? null,
      headers: { ...input.headers },
      guideCleanup: input.guideCleanup,
      enabled: input.enabled,
      health: "unknown",
      lastRefreshAt: null,
      reviewedAt: null,
      autoAddNew: input.autoAddNew ?? false,
    };
    yield* write.insert(sources).values(row).pipe(Effect.orDie);
    return viewSource(yield* sourceFromRow(box, row));
  });

  const update = Effect.fn("Sources.update")(function* (
    actor: User,
    sourceId: string,
    patch: typeof SourceUpdate.Type,
  ) {
    yield* requireAdmin(actor);
    const row = yield* findRow(sourceId);
    const current = yield* sourceFromRow(box, row);
    const config =
      patch.config === undefined
        ? current.config
        : applySourceConfigPatch(current.config, patch.config);
    if (config._tag === "MissingSecret") {
      return yield* new InvalidInput({
        problems: [{ path: `config.${config.field}`, code: "required" }],
      });
    }
    const secretHeaders =
      patch.secretHeaders === undefined
        ? current.secretHeaders
        : applySecretHeadersPatch(current.secretHeaders, patch.secretHeaders);
    const { secretHeaders: _stored, ...base } = current;
    const next: Source = {
      ...base,
      name: patch.name ?? current.name,
      config,
      refreshIntervalMinutes: patch.refreshIntervalMinutes ?? current.refreshIntervalMinutes,
      headers: patch.headers ?? current.headers,
      guideCleanup: patch.guideCleanup ?? current.guideCleanup,
      enabled: patch.enabled ?? current.enabled,
      autoAddNew: patch.autoAddNew ?? current.autoAddNew ?? false,
      ...opt("maxStreams", patch.maxStreams),
      ...opt("keptForRecordings", patch.keptForRecordings),
      ...opt("userAgent", patch.userAgent),
      ...(secretHeaders === undefined || Object.keys(secretHeaders).length === 0
        ? {}
        : { secretHeaders }),
    };
    yield* validate(next);
    yield* write
      .update(sources)
      .set({
        name: next.name,
        ...sealedColumns(box, next),
        refreshIntervalMinutes: next.refreshIntervalMinutes,
        maxStreams: next.maxStreams ?? null,
        keptForRecordings: next.keptForRecordings ?? null,
        userAgent: next.userAgent ?? null,
        headers: next.headers,
        guideCleanup: next.guideCleanup,
        enabled: next.enabled,
        autoAddNew: next.autoAddNew ?? false,
      })
      .where(eq(sources.id, sourceId))
      .pipe(Effect.orDie);
    return viewSource(next);
  });

  /** Refreshes every enabled source whose interval is up (or that never refreshed). */
  const refreshDue = Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis;
    const rows = yield* read
      .select()
      .from(sources)
      .where(eq(sources.enabled, true))
      .pipe(Effect.orDie);
    const due = rows.filter(
      (row) =>
        row.lastRefreshAt === null ||
        now - row.lastRefreshAt >= row.refreshIntervalMinutes * 60_000,
    );
    yield* Effect.forEach(due, (row) => Effect.ignore(refreshRow(row)), { discard: true });
  });

  /**
   * Every stream of a source with the channel it is added to and whether a guide has its tvg-id,
   * in group then name order: one query however many streams the playlist has.
   */
  const sourceStreamRows = (actor: User, sourceId: string) =>
    Effect.gen(function* () {
      yield* requireAdmin(actor).pipe(
        Effect.mapError(() => new NotFound({ entity: "source", id: sourceId })),
      );
      const source = yield* findRow(sourceId);
      const joined = yield* read
        .select({
          id: sourceStreams.id,
          name: sourceStreams.name,
          group: sourceStreams.group,
          tvgId: sourceStreams.tvgId,
          logoUrl: sourceStreams.logoUrl,
          channelNumber: sourceStreams.channelNumber,
          firstSeenAt: sourceStreams.firstSeenAt,
          lastSeenAt: sourceStreams.lastSeenAt,
          ignoredAt: sourceStreams.ignoredAt,
          hasGuide: sql<
            number | bigint | null
          >`${sourceStreams.tvgId} IN (SELECT ${guideChannels.xmltvId} FROM ${guideChannels})`,
          channelId: channels.id,
          channelName: channels.name,
        })
        .from(sourceStreams)
        .leftJoin(channelStreams, eq(channelStreams.sourceStreamId, sourceStreams.id))
        .leftJoin(channels, eq(channels.id, channelStreams.channelId))
        .where(eq(sourceStreams.sourceId, sourceId))
        .orderBy(
          sql`${sourceStreams.group} IS NULL`,
          asc(sourceStreams.group),
          asc(sourceStreams.name),
          asc(sourceStreams.id),
        )
        .pipe(Effect.orDie);
      // A stream two channels use shows once, with the first.
      const seen = new Set<string>();
      const rows: Array<StreamListRow> = [];
      for (const row of joined) {
        if (seen.has(row.id)) continue;
        seen.add(row.id);
        rows.push({ ...row, hasGuide: Number(row.hasGuide) === 1 });
      }
      return { source, rows };
    });

  /** The source's rows for `streamIds`; `InvalidInput` names any that are not its streams. */
  const ownStreams = (sourceId: string, streamIds: ReadonlyArray<string>) =>
    Effect.gen(function* () {
      const rows: Array<typeof sourceStreams.$inferSelect> = [];
      for (const ids of chunks(streamIds, 500)) {
        rows.push(
          ...(yield* read
            .select()
            .from(sourceStreams)
            .where(and(eq(sourceStreams.sourceId, sourceId), inArray(sourceStreams.id, [...ids])))
            .pipe(Effect.orDie)),
        );
      }
      const known = new Set(rows.map((row) => row.id));
      const problems = streamIds.flatMap((id, index) =>
        known.has(id) ? [] : [{ path: `streamIds.${index}`, code: "unknownSourceStream" }],
      );
      if (problems.length > 0) return yield* new InvalidInput({ problems });
      // In the order asked for, so variants group and number as the admin listed them.
      const byId = new Map(rows.map((row) => [row.id, row]));
      return [...new Set(streamIds)].flatMap((id) => byId.get(id) ?? []);
    });

  return {
    list: (actor: User) =>
      Effect.gen(function* () {
        yield* requireAdmin(actor);
        const rows = yield* read.select().from(sources).pipe(Effect.orDie);
        return yield* Effect.forEach(rows, (row) =>
          Effect.map(sourceFromRow(box, row), viewSource),
        );
      }),
    get: (actor: User, sourceId: string) =>
      Effect.gen(function* () {
        yield* requireAdmin(actor).pipe(
          Effect.mapError(() => new NotFound({ entity: "source", id: sourceId })),
        );
        return viewSource(yield* sourceFromRow(box, yield* findRow(sourceId)));
      }),
    create,
    update,
    remove: (actor: User, sourceId: string) =>
      Effect.gen(function* () {
        yield* requireAdmin(actor);
        yield* findRow(sourceId);
        yield* write.delete(sources).where(eq(sources.id, sourceId)).pipe(Effect.orDie);
      }),
    refresh: (actor: User, sourceId: string) =>
      Effect.gen(function* () {
        yield* requireAdmin(actor);
        return yield* refreshRow(yield* findRow(sourceId));
      }),
    test: (actor: User, input: typeof SourceInput.Type) =>
      Effect.gen(function* () {
        yield* requireAdmin(actor);
        yield* validate(input);
        const snapshot = yield* fetchSnapshot({
          ...input,
          id: SourceId.make("test"),
          health: "unknown",
        }).pipe(Effect.mapError((failure) => failure.error));
        return summarise(snapshot, yield* Clock.currentTimeMillis);
      }),
    streams: (actor: User, sourceId: string, search: string | undefined) =>
      Effect.gen(function* () {
        yield* requireAdmin(actor).pipe(
          Effect.mapError(() => new NotFound({ entity: "source", id: sourceId })),
        );
        yield* findRow(sourceId);
        const term = search?.trim().toLowerCase();
        const rows = yield* read
          .select()
          .from(sourceStreams)
          .where(
            term === undefined || term === ""
              ? eq(sourceStreams.sourceId, sourceId)
              : and(
                  eq(sourceStreams.sourceId, sourceId),
                  sql`lower(${sourceStreams.name}) LIKE ${`%${term.replaceAll(/[%_\\]/g, (c) => `\\${c}`)}%`} ESCAPE '\\'`,
                ),
          )
          .orderBy(sourceStreams.name)
          .pipe(Effect.orDie);
        return rows.map(toStreamView);
      }),
    refreshDue,
    catalogue: (actor: User, sourceId: string, query: CatalogueQuery) =>
      Effect.gen(function* () {
        const { source, rows } = yield* sourceStreamRows(actor, sourceId);
        const term = query.search?.trim().toLowerCase() ?? "";
        const filtered = rows.filter(
          (row) =>
            (query.group === undefined || (row.group ?? "") === query.group) &&
            (term === "" || row.name.toLowerCase().includes(term)) &&
            keepFor(query.filter ?? "all", row, source),
        );
        const offset = query.offset ?? 0;
        const limit = Math.min(query.limit ?? DEFAULT_PAGE, MAX_PAGE);
        const page = filtered.slice(offset, offset + limit);
        // The second and last query: the live channels to match streams not added yet against.
        const needsMatch = page.some((row) => row.channelId === null && row.ignoredAt === null);
        const lineup = needsMatch ? yield* matchableChannels(read) : [];
        const match = needsMatch ? streamMatcher(lineup) : undefined;
        const names = new Map(lineup.map((channel) => [channel.id, channel.name]));
        return {
          total: filtered.length,
          streams: page.map((row) => streamEntry(row, source, match, names)),
        };
      }),
    groups: (actor: User, sourceId: string) =>
      Effect.gen(function* () {
        const { source, rows } = yield* sourceStreamRows(actor, sourceId);
        const groups = new Map<string, SourceGroupCounts>();
        for (const row of rows) {
          const key = row.group ?? "";
          const counts = groups.get(key) ?? {
            group: row.group,
            streams: 0,
            withGuide: 0,
            added: 0,
            new: 0,
            ignored: 0,
          };
          counts.streams += 1;
          if (row.hasGuide) counts.withGuide += 1;
          if (row.channelId !== null) counts.added += 1;
          if (isNew(row, source)) counts.new += 1;
          if (row.ignoredAt !== null) counts.ignored += 1;
          groups.set(key, counts);
        }
        return [...groups.values()]
          .toSorted((a, b) => groupOrder(a.group, b.group))
          .map(({ group, ...counts }) => ({
            ...opt("name", group),
            ...counts,
            guideCoverage: Math.round((counts.withGuide / counts.streams) * 100),
          }));
      }),
    addStreams: (actor: User, sourceId: string, streamIds: ReadonlyArray<string>) =>
      Effect.gen(function* () {
        yield* requireAdmin(actor);
        yield* findRow(sourceId);
        const rows = yield* ownStreams(sourceId, streamIds);
        const result = yield* write
          .transaction((tx) =>
            Effect.gen(function* () {
              // Adding a stream someone set aside takes it back.
              yield* tx
                .update(sourceStreams)
                .set({ ignoredAt: null })
                .where(inArray(sourceStreams.id, [...streamIds]));
              return yield* addStreamsAsChannels(tx, rows);
            }),
          )
          .pipe(Effect.orDie);
        const icons = yield* loadGuideIcons(read);
        return {
          created: result.created.map((row) => toChannel(row, icons)),
          joined: result.joined.map((entry) => ({
            sourceStreamId: SourceStreamId.make(entry.sourceStreamId),
            channel: { id: entry.channelId, name: entry.name },
          })),
        };
      }),
    ignoreStreams: (
      actor: User,
      sourceId: string,
      streamIds: ReadonlyArray<string>,
      ignored: boolean,
    ) =>
      Effect.gen(function* () {
        yield* requireAdmin(actor);
        yield* findRow(sourceId);
        yield* ownStreams(sourceId, streamIds);
        const now = yield* Clock.currentTimeMillis;
        yield* write
          .update(sourceStreams)
          .set({ ignoredAt: ignored ? now : null })
          .where(inArray(sourceStreams.id, [...streamIds]))
          .pipe(Effect.orDie);
      }),
    markReviewed: (actor: User, sourceId: string) =>
      Effect.gen(function* () {
        yield* requireAdmin(actor);
        yield* findRow(sourceId);
        const now = yield* Clock.currentTimeMillis;
        yield* write
          .update(sources)
          .set({ reviewedAt: now })
          .where(eq(sources.id, sourceId))
          .pipe(Effect.orDie);
        return viewSource(yield* sourceFromRow(box, yield* findRow(sourceId)));
      }),
    /** Stream ids that exist, for validating channel stream lists. */
    existingStreamIds: (ids: ReadonlyArray<string>) =>
      ids.length === 0
        ? Effect.succeed(new Set<string>())
        : read
            .select({ id: sourceStreams.id })
            .from(sourceStreams)
            .where(inArray(sourceStreams.id, [...ids]))
            .pipe(
              Effect.map((rows) => new Set(rows.map((row) => row.id))),
              Effect.orDie,
            ),
  };
});

/** Source management and guide refresh. */
export class Sources extends Context.Service<Sources, Effect.Success<typeof makeSources>>()(
  "@slipstream/server/Sources",
) {
  static readonly layer = Layer.effect(Sources, makeSources);
}

/** Refreshes due sources on startup and then every `sourceCheckIntervalMillis`, for the server's lifetime. */
export const SourceScheduler = Layer.effectDiscard(
  Effect.gen(function* () {
    const sourcesService = yield* Sources;
    const config = yield* ServerConfig;
    yield* sourcesService.refreshDue.pipe(
      Effect.catchCause((cause) => Effect.logError("Scheduled source refresh failed", cause)),
      Effect.repeat(Schedule.spaced(Duration.millis(config.sourceCheckIntervalMillis))),
      Effect.forkScoped,
    );
  }),
);
