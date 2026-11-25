/**
 * The system page (PLAN 6.8): version, household time zone, the ffmpeg self-check, hardware
 * encoders, storage and source health.
 */
import { mkdirSync, readFileSync } from "node:fs";
import { statfs } from "node:fs/promises";
import { sql } from "drizzle-orm";
import { Context, Effect, Layer, Ref, Schema } from "effect";
import type { SystemInfo } from "@slipstream/api";
import { FfmpegConfig, ffmpegVersion, selfCheck } from "@slipstream/recorder";
import { SourceId } from "@slipstream/domain";
import { ServerConfig } from "../config.ts";
import { overlapping } from "../captures/segments.ts";
import { Db } from "../db/client.ts";
import { captures, recordings, segments, sources } from "../db/schema.ts";
import { retainedEndSql, retainedStartSql } from "../recordings/store.ts";
import { Hardware } from "./hardware.ts";

const PackageJson = Schema.Struct({ version: Schema.String });

const serverVersion = (): string => {
  try {
    const raw = readFileSync(new URL("../../package.json", import.meta.url), "utf8");
    return Schema.decodeUnknownSync(Schema.fromJsonString(PackageJson))(raw).version;
  } catch {
    return "unknown";
  }
};

type SelfCheckState = SystemInfo["ffmpeg"]["selfCheck"];

/** Segment bytes inside a recording's retained range (recordings) and the rest (DVR buffer). */
const usedBytes = sql`
  SELECT
    coalesce(sum(${segments.bytes}), 0) AS total,
    coalesce(sum(CASE WHEN EXISTS (
      SELECT 1 FROM ${recordings}
      WHERE ${recordings.state} <> 'cancelled'
        AND ${overlapping(recordings.channelId, retainedStartSql, retainedEndSql)}
    ) THEN ${segments.bytes} ELSE 0 END), 0) AS recorded
  FROM ${segments} JOIN ${captures} ON ${captures.id} = ${segments.captureId}`;

const makeSystem = Effect.gen(function* () {
  const { read } = yield* Db;
  const config = yield* ServerConfig;
  const hardware = yield* Hardware;
  const version = serverVersion();
  const binaries = yield* FfmpegConfig;
  // The version from `ffmpeg -version`, e.g. "9.0.2"; "missing" when it cannot run.
  const ffmpeg = yield* Effect.cached(
    ffmpegVersion().pipe(
      Effect.orElseSucceed(() => "missing"),
      Effect.provideService(FfmpegConfig, binaries),
    ),
  );
  const check = yield* Ref.make<{ readonly state: SelfCheckState; readonly detail?: string }>({
    state: "pending",
  });

  if (config.startupChecks) {
    yield* selfCheck().pipe(
      Effect.matchEffect({
        onSuccess: () => Ref.set(check, { state: "ok" }),
        onFailure: (error) =>
          Ref.set(check, { state: "failed", detail: error.message }).pipe(
            Effect.andThen(Effect.logError("ffmpeg self-check failed", error)),
          ),
      }),
      Effect.forkScoped,
    );
  }

  const info = Effect.gen(function* () {
    mkdirSync(config.dataDir, { recursive: true });
    const disk = yield* Effect.promise(() => statfs(config.dataDir));
    const [used] = yield* read
      .all<{ total: number; recorded: number }>(usedBytes)
      .pipe(Effect.orDie);
    const health = yield* read
      .select({ id: sources.id, health: sources.health })
      .from(sources)
      .pipe(Effect.orDie);
    const selfChecked = yield* Ref.get(check);
    const found = yield* hardware.caps;
    return {
      version,
      timeZone: config.timeZone,
      ffmpeg: {
        version: yield* ffmpeg,
        selfCheck: selfChecked.state,
        ...(selfChecked.detail === undefined ? {} : { detail: selfChecked.detail }),
      },
      ...(found === undefined ? {} : { hardware: found }),
      storage: [
        {
          path: config.dataDir,
          totalBytes: disk.blocks * disk.bsize,
          freeBytes: disk.bavail * disk.bsize,
          recordingsBytes: used?.recorded ?? 0,
          bufferBytes: (used?.total ?? 0) - (used?.recorded ?? 0),
          freeSpaceFloorBytes: config.freeSpaceFloorBytes,
        },
      ],
      sources: health.map((row) => ({ sourceId: SourceId.make(row.id), health: row.health })),
    } satisfies SystemInfo;
  });

  return { info };
});

/** System information. */
export class SystemInfoService extends Context.Service<
  SystemInfoService,
  Effect.Success<typeof makeSystem>
>()("@slipstream/server/SystemInfo") {
  static readonly layer = Layer.effect(SystemInfoService, makeSystem);
}
