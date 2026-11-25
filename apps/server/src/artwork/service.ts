/**
 * Artwork (SPEC 7.4): the one resolver (`resolveArtwork` in the domain) over the guide snapshot
 * and grabbed frames, with the household's artwork order, and the frame bytes. Ids the caller
 * cannot see or that do not exist are left out of a batch rather than failing it.
 */
import { existsSync, readFileSync } from "node:fs";
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";
import { NotFound, type ArtworkEntry } from "@slipstream/api";
import {
  type ArtworkOrder,
  ChannelId,
  ProgrammeId,
  resolveArtwork,
  type User,
} from "@slipstream/domain";
import { ServerConfig } from "../config.ts";
import { Db } from "../db/client.ts";
import { toInstant } from "../db/codec.ts";
import { channels, programmes, recordings } from "../db/schema.ts";
import { loadViewer, seesChannel, type Viewer, visibleRecordings } from "../household/viewer.ts";
import { loadRecordings, type StoredRecording } from "../recordings/store.ts";
import { Settings } from "../settings/service.ts";
import { framePath } from "./frames.ts";
import { onLiveChannel } from "../channels/lineup.ts";

/** The most ids one resolve request answers. */
export const MAX_ARTWORK_IDS = 200;

/** Splits a comma-separated id list, dropping blanks. */
export const idList = (value: string | undefined): Array<string> =>
  (value ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter((id) => id !== "");

/** The artwork of a stored recording: its guide image, its frame, else generated. */
export const recordingArtwork = (stored: StoredRecording, order: ArtworkOrder) =>
  resolveArtwork(
    {
      channelId: stored.recording.channelId,
      title: stored.recording.title,
      categories: stored.recording.categories,
      imageUrl: stored.recording.imageUrl,
      onlineImageUrl: stored.recording.onlineImageUrl,
      frame:
        stored.frameAt === undefined
          ? undefined
          : { recordingId: stored.recording.id, grabbedAt: toInstant(stored.frameAt) },
    },
    order,
  );

const makeArtwork = Effect.gen(function* () {
  const { read } = yield* Db;
  const config = yield* ServerConfig;
  const settings = yield* Settings;

  /** The stored recordings among `list` the viewer may see. */
  const visible = (viewer: Viewer, list: ReadonlyArray<StoredRecording>) =>
    visibleRecordings(read, viewer, list, config.timeZone);

  const resolve = (actor: User, query: { programmeIds?: string; recordingIds?: string }) =>
    Effect.gen(function* () {
      const programmeIds = idList(query.programmeIds);
      const recordingIds = idList(query.recordingIds).slice(
        0,
        Math.max(0, MAX_ARTWORK_IDS - programmeIds.length),
      );
      const wantedProgrammes = programmeIds.slice(0, MAX_ARTWORK_IDS);
      const viewer = yield* loadViewer(read, actor);
      const { artworkOrder } = yield* settings.recording;
      const entries: Array<ArtworkEntry> = [];

      if (wantedProgrammes.length > 0) {
        const rows = yield* read
          .select({ programme: programmes, channelId: channels.id, hidden: channels.hidden })
          .from(programmes)
          .innerJoin(channels, onLiveChannel(programmes.guideChannelId))
          .where(inArray(programmes.id, wantedProgrammes))
          .orderBy(channels.hidden, channels.id)
          .pipe(Effect.orDie);
        // A programme with a recording uses that recording's frame (running ones included).
        const framed = yield* loadRecordings(
          read,
          and(inArray(recordings.programmeId, wantedProgrammes), isNotNull(recordings.frameAt)),
        );
        const frames = new Map(
          (yield* visible(viewer, framed)).flatMap((stored) =>
            stored.recording.programmeId === undefined || stored.frameAt === undefined
              ? []
              : [
                  [
                    stored.recording.programmeId,
                    { recordingId: stored.recording.id, grabbedAt: toInstant(stored.frameAt) },
                  ] as const,
                ],
          ),
        );
        const seen = new Set<string>();
        for (const row of rows) {
          if (seen.has(row.programme.id) || !seesChannel(viewer, row.channelId)) continue;
          seen.add(row.programme.id);
          const programmeId = ProgrammeId.make(row.programme.id);
          entries.push({
            target: { _tag: "Programme", programmeId },
            artwork: resolveArtwork(
              {
                channelId: ChannelId.make(row.channelId),
                title: row.programme.title,
                categories: row.programme.categories,
                imageUrl: row.programme.imageUrl ?? undefined,
                onlineImageUrl: row.programme.onlineImageUrl ?? undefined,
                frame: frames.get(programmeId),
              },
              artworkOrder,
            ),
          });
        }
      }

      if (recordingIds.length > 0) {
        const stored = yield* visible(
          viewer,
          yield* loadRecordings(read, inArray(recordings.id, recordingIds)),
        );
        for (const item of stored) {
          entries.push({
            target: { _tag: "Recording", recordingId: item.recording.id },
            artwork: recordingArtwork(item, artworkOrder),
          });
        }
      }
      return entries;
    });

  /** The JPEG of a recording's frame. */
  const frame = (actor: User, recordingId: string) =>
    Effect.gen(function* () {
      const viewer = yield* loadViewer(read, actor);
      const [stored] = yield* visible(
        viewer,
        yield* loadRecordings(read, eq(recordings.id, recordingId)),
      );
      if (stored === undefined)
        return yield* new NotFound({ entity: "recording", id: recordingId });
      const file = framePath(config.dataDir, stored.recording.id);
      if (stored.frameAt === undefined || !existsSync(file)) {
        return yield* new NotFound({ entity: "frame", id: recordingId });
      }
      return new Uint8Array(readFileSync(file));
    });

  return { resolve, frame };
});

/** Artwork resolution and frame bytes. */
export class Artwork extends Context.Service<Artwork, Effect.Success<typeof makeArtwork>>()(
  "@slipstream/server/Artwork",
) {
  static readonly layer = Layer.effect(Artwork, makeArtwork);
}
