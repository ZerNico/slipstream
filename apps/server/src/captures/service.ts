/**
 * Captures (PLAN 6.3, 6.8): upstream connections as the recorder recorded them in the database,
 * their logs, and the admin "stop" that goes to the recorder.
 */
import { and, asc, desc, eq, gt, notInArray } from "drizzle-orm";
import { Context, DateTime, Effect, Layer } from "effect";
import { NotFound, type LogLine } from "@slipstream/api";
import {
  type Capture,
  CaptureId,
  ChannelId,
  SourceStreamId,
  type Instant,
  type User,
} from "@slipstream/domain";
import { requireAdmin } from "../auth/service.ts";
import { Db } from "../db/client.ts";
import { opt, readStreamInfo, toInstant } from "../db/codec.ts";
import { captureLogs, captures } from "../db/schema.ts";
import { loadViewer, requireChannel, seesChannel } from "../household/viewer.ts";
import { CAPTURE_LOG_LIMIT, Recorder } from "../recorder/engine.ts";

const toCapture = (row: typeof captures.$inferSelect): Capture => ({
  id: CaptureId.make(row.id),
  channelId: ChannelId.make(row.channelId),
  sourceStreamId: SourceStreamId.make(row.sourceStreamId),
  startedAt: toInstant(row.startedAt),
  ...opt("endedAt", row.endedAt === null ? null : toInstant(row.endedAt)),
  state: row.state,
  ...opt("error", row.error),
  stats: row.stats,
  ...opt("streamInfo", row.streamInfo === null ? null : readStreamInfo(row.streamInfo)),
});

const makeCaptures = Effect.gen(function* () {
  const { read } = yield* Db;
  const recorder = yield* Recorder;

  const findRow = (captureId: string) =>
    Effect.gen(function* () {
      const [row] = yield* read
        .select()
        .from(captures)
        .where(eq(captures.id, captureId))
        .pipe(Effect.orDie);
      if (row === undefined) return yield* new NotFound({ entity: "capture", id: captureId });
      return row;
    });

  return {
    list: (actor: User, active: boolean | undefined) =>
      Effect.gen(function* () {
        const viewer = yield* loadViewer(read, actor);
        const rows = yield* read
          .select()
          .from(captures)
          .where(active === true ? notInArray(captures.state, ["stopped", "failed"]) : undefined)
          .orderBy(desc(captures.startedAt))
          .limit(200)
          .pipe(Effect.orDie);
        return rows.filter((row) => seesChannel(viewer, row.channelId)).map(toCapture);
      }),
    get: (actor: User, captureId: string) =>
      Effect.gen(function* () {
        const row = yield* findRow(captureId);
        yield* requireChannel(yield* loadViewer(read, actor), row.channelId).pipe(
          Effect.mapError(() => new NotFound({ entity: "capture", id: captureId })),
        );
        return toCapture(row);
      }),
    log: (actor: User, captureId: string, after: Instant | undefined) =>
      Effect.gen(function* () {
        yield* requireAdmin(actor);
        yield* findRow(captureId);
        const rows = yield* read
          .select()
          .from(captureLogs)
          .where(
            and(
              eq(captureLogs.captureId, captureId),
              after === undefined ? undefined : gt(captureLogs.at, DateTime.toEpochMillis(after)),
            ),
          )
          .orderBy(asc(captureLogs.at), asc(captureLogs.id))
          .limit(CAPTURE_LOG_LIMIT)
          .pipe(Effect.orDie);
        return rows.map(
          (row) =>
            ({
              at: toInstant(row.at),
              level: row.level,
              message: row.message,
            }) satisfies typeof LogLine.Type,
        );
      }),
    stop: (actor: User, captureId: string) =>
      Effect.gen(function* () {
        yield* requireAdmin(actor);
        yield* findRow(captureId);
        yield* recorder.stopCapture(captureId);
        return toCapture(yield* findRow(captureId));
      }),
  };
});

/** Capture status and logs. */
export class Captures extends Context.Service<Captures, Effect.Success<typeof makeCaptures>>()(
  "@slipstream/server/Captures",
) {
  static readonly layer = Layer.effect(Captures, makeCaptures);
}
