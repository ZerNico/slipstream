/**
 * The live playlist of a channel across its captures (PLAN section 4): the segments of the DVR
 * window, from whichever captures wrote them, with `#EXT-X-DISCONTINUITY` where a capture or run
 * changes. Players match segments between reloads by media sequence number, so a segment keeps
 * its number for as long as it is listed and the numbers only grow, also when the channel's
 * capture is restarted: each capture gets a stored `sequenceBase` (and `discontinuityBase`) that
 * continues where the capture before it ended, the first time it shows in a live playlist.
 */
import { and, asc, desc, eq, gte, isNull, lt, lte, sql } from "drizzle-orm";
import { Effect } from "effect";
import { discontinuities, GAP_TOLERANCE_MS, type Segment } from "@slipstream/recorder";
import { toSegment } from "../captures/segments.ts";
import type { Database } from "../db/client.ts";
import { captures, segments } from "../db/schema.ts";

/** Where a capture's numbering starts on its channel. */
interface Numbering {
  readonly sequenceBase: number;
  readonly discontinuityBase: number;
}

/**
 * Breaks among a capture's segments (a run change, or a hole beyond the tolerance, against the
 * segment before) up to and including `throughSequence`, counted in SQL.
 */
const breaksIn = (db: Database, captureId: string, throughSequence?: number) => {
  const flagged = db
    .select({
      flag: sql<number>`CASE
        WHEN lag(${segments.runId}) OVER (ORDER BY ${segments.sequence}) IS NULL THEN 0
        WHEN lag(${segments.runId}) OVER (ORDER BY ${segments.sequence}) <> ${segments.runId} THEN 1
        WHEN abs(${segments.startMs} - lag(${segments.startMs} + ${segments.durationMs}) OVER (ORDER BY ${segments.sequence})) > ${GAP_TOLERANCE_MS} THEN 1
        ELSE 0 END`.as("flag"),
    })
    .from(segments)
    .where(
      and(
        eq(segments.captureId, captureId),
        throughSequence === undefined ? undefined : lte(segments.sequence, throughSequence),
      ),
    )
    .as("flagged");
  return db
    .select({ count: sql<number>`coalesce(sum(${flagged.flag}), 0)`.mapWith(Number) })
    .from(flagged)
    .pipe(
      Effect.map((rows) => rows[0]?.count ?? 0),
      Effect.orDie,
    );
};

/** The highest sequence a capture wrote, or -1 without segments. */
const lastSequence = (db: Database, captureId: string) =>
  db
    .select({ last: sql<number>`coalesce(max(${segments.sequence}), -1)`.mapWith(Number) })
    .from(segments)
    .where(eq(segments.captureId, captureId))
    .pipe(
      Effect.map((rows) => rows[0]?.last ?? -1),
      Effect.orDie,
    );

/**
 * The numbering of `captureId`, assigning it (and any capture between it and the last numbered
 * one) on first use. A capture whose predecessor was never numbered starts the channel at 0:
 * nobody can have seen that predecessor in a live playlist, and the window never moves back.
 */
const numberingOf = (db: Database, channelId: string, captureId: string) =>
  Effect.gen(function* () {
    const [target] = yield* db
      .select({
        startedAt: captures.startedAt,
        sequenceBase: captures.sequenceBase,
        discontinuityBase: captures.discontinuityBase,
      })
      .from(captures)
      .where(eq(captures.id, captureId))
      .pipe(Effect.orDie);
    if (target === undefined) return { sequenceBase: 0, discontinuityBase: 0 };
    if (target.sequenceBase !== null) {
      return {
        sequenceBase: target.sequenceBase,
        discontinuityBase: target.discontinuityBase ?? 0,
      } satisfies Numbering;
    }
    // The newest numbered capture before this one, and the unnumbered ones after it.
    const [anchor] = yield* db
      .select({
        id: captures.id,
        sequenceBase: captures.sequenceBase,
        discontinuityBase: captures.discontinuityBase,
        startedAt: captures.startedAt,
      })
      .from(captures)
      .where(
        and(
          eq(captures.channelId, channelId),
          lt(captures.startedAt, target.startedAt),
          sql`${captures.sequenceBase} IS NOT NULL`,
        ),
      )
      .orderBy(desc(captures.startedAt))
      .limit(1)
      .pipe(Effect.orDie);
    const pending = yield* db
      .select({ id: captures.id })
      .from(captures)
      .where(
        and(
          eq(captures.channelId, channelId),
          isNull(captures.sequenceBase),
          anchor === undefined ? undefined : gte(captures.startedAt, anchor.startedAt),
          lte(captures.startedAt, target.startedAt),
        ),
      )
      .orderBy(asc(captures.startedAt), asc(captures.id))
      .pipe(Effect.orDie);
    // Captures before the target that never showed anywhere do not count when nothing anchors.
    const chain = anchor === undefined ? pending.filter((row) => row.id === captureId) : pending;
    /** What the capture after `id` (numbered `numbering`) starts at. */
    const after = (id: string, numbering: Numbering) =>
      Effect.gen(function* () {
        const last = yield* lastSequence(db, id);
        // A capture that never wrote a segment leaves no trace in any playlist.
        if (last < 0) return numbering;
        return {
          sequenceBase: numbering.sequenceBase + last + 1,
          // Its own breaks, plus the one where the next capture begins.
          discontinuityBase: numbering.discontinuityBase + (yield* breaksIn(db, id)) + 1,
        } satisfies Numbering;
      });
    let numbering: Numbering =
      anchor === undefined
        ? { sequenceBase: 0, discontinuityBase: 0 }
        : yield* after(anchor.id, {
            sequenceBase: anchor.sequenceBase ?? 0,
            discontinuityBase: anchor.discontinuityBase ?? 0,
          });
    for (const [index, row] of chain.entries()) {
      yield* db
        .update(captures)
        .set(numbering)
        .where(and(eq(captures.id, row.id), isNull(captures.sequenceBase)))
        .pipe(Effect.orDie);
      if (index < chain.length - 1) numbering = yield* after(row.id, numbering);
    }
    // Another request may have numbered it first; the stored value is the one that counts.
    const [stored] = yield* db
      .select({
        sequenceBase: captures.sequenceBase,
        discontinuityBase: captures.discontinuityBase,
      })
      .from(captures)
      .where(eq(captures.id, captureId))
      .pipe(Effect.orDie);
    return {
      sequenceBase: stored?.sequenceBase ?? numbering.sequenceBase,
      discontinuityBase: stored?.discontinuityBase ?? numbering.discontinuityBase,
    } satisfies Numbering;
  });

const seconds = (ms: number) => (ms / 1000).toFixed(3);

/**
 * The live playlist of a channel: every segment that started within `dvrWindowMs` of `now`,
 * across captures; `undefined` while there is none. `segmentUri` makes the segment linker for
 * the playlist's target duration (in seconds; segment grants reach a few of them ahead).
 */
export const channelLivePlaylist = (
  db: Database,
  input: {
    readonly channelId: string;
    readonly now: number;
    readonly dvrWindowMs: number;
    readonly segmentUri: (targetSeconds: number) => (segment: Segment) => string;
  },
) =>
  Effect.gen(function* () {
    const rows = yield* db
      .select({ segment: segments })
      .from(segments)
      .innerJoin(captures, eq(captures.id, segments.captureId))
      .where(
        and(
          eq(captures.channelId, input.channelId),
          gte(segments.startMs, input.now - input.dvrWindowMs),
        ),
      )
      .orderBy(asc(segments.startMs), asc(captures.startedAt), asc(segments.sequence))
      .pipe(Effect.orDie);
    const window = rows.map((row) => toSegment(row.segment));
    const first = window[0];
    if (first === undefined) return undefined;
    const numbering = new Map<string, Numbering>();
    for (const segment of window) {
      if (!numbering.has(segment.captureId)) {
        numbering.set(
          segment.captureId,
          yield* numberingOf(db, input.channelId, segment.captureId),
        );
      }
    }
    const numberOf = (segment: Segment) =>
      (numbering.get(segment.captureId)?.sequenceBase ?? 0) + segment.sequence;
    const firstNumbering = numbering.get(first.captureId);
    const discontinuitySequence =
      (firstNumbering?.discontinuityBase ?? 0) +
      (yield* breaksIn(db, first.captureId, first.sequence));
    const breaks = discontinuities(window, GAP_TOLERANCE_MS);
    const target = Math.max(1, Math.ceil(Math.max(...window.map((s) => s.durationMs)) / 1000));
    const link = input.segmentUri(target);
    const lines = [
      "#EXTM3U",
      "#EXT-X-VERSION:3",
      `#EXT-X-TARGETDURATION:${target}`,
      `#EXT-X-MEDIA-SEQUENCE:${numberOf(first)}`,
      `#EXT-X-DISCONTINUITY-SEQUENCE:${discontinuitySequence}`,
    ];
    window.forEach((segment, index) => {
      // The first segment's break is already counted in the discontinuity sequence.
      if (index > 0 && breaks[index] === true) lines.push("#EXT-X-DISCONTINUITY");
      lines.push(`#EXT-X-PROGRAM-DATE-TIME:${new Date(segment.startMs).toISOString()}`);
      lines.push(`#EXTINF:${seconds(segment.durationMs)},`);
      lines.push(link(segment));
    });
    return `${lines.join("\n")}\n`;
  });
