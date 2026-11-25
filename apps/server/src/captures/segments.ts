/**
 * The segment index as the server reads it: segments belong to captures, captures to channels,
 * and what plays back, takes up space or gets a frame grabbed is "the segments of a channel
 * overlapping a window", across every capture that wrote them. Queries that select something of
 * their own join `captures` and filter with {@link overlapping}.
 */
import { and, asc, eq, gt, lt, type SQL, sql, type SQLWrapper } from "drizzle-orm";
import { Effect } from "effect";
import type { Segment } from "@slipstream/recorder";
import type { Database, Transaction } from "../db/client.ts";
import { captures, segments } from "../db/schema.ts";

/** A segment row as the recorder's playlist functions take it. */
export const toSegment = (row: typeof segments.$inferSelect): Segment => ({
  captureId: row.captureId,
  runId: row.runId,
  sequence: row.sequence,
  startMs: row.startMs,
  durationMs: row.durationMs,
  bytes: row.bytes,
  path: row.path,
});

/**
 * Segments (joined with their `captures`) of `channelId` that overlap `[fromMs, toMs)`. The
 * channel and bounds may be SQL, to compare with a joined recording's channel and range.
 */
export const overlapping = (
  channelId: string | SQLWrapper,
  fromMs: number | SQLWrapper,
  toMs: number | SQLWrapper,
): SQL | undefined =>
  and(
    eq(captures.channelId, channelId),
    lt(segments.startMs, toMs),
    gt(sql`${segments.startMs} + ${segments.durationMs}`, fromMs),
  );

/** The segments of a channel's captures overlapping `[fromMs, toMs)`, in time order. */
export const channelSegments = (
  db: Database | Transaction,
  channelId: string,
  fromMs: number,
  toMs: number,
) =>
  db
    .select({ segment: segments })
    .from(segments)
    .innerJoin(captures, eq(captures.id, segments.captureId))
    .where(overlapping(channelId, fromMs, toMs))
    .orderBy(asc(segments.startMs), asc(segments.sequence))
    .pipe(
      Effect.map((rows) => rows.map((row) => toSegment(row.segment))),
      Effect.orDie,
    );
