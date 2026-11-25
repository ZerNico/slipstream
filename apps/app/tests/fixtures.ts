/**
 * Test data built by decoding wire JSON through the real schemas, so fixtures always match
 * what the server sends.
 */
import { RecordingEntry, ScheduleConflict } from "@slipstream/api";
import { Channel, Programme } from "@slipstream/domain";
import { Schema } from "effect";

const iso = (ms: number) => new Date(ms).toISOString();

/** A channel; `number` may be left out. */
export const channel = (id: string, name: string, number?: number, hidden = false): Channel =>
  Schema.decodeUnknownSync(Channel)({
    id,
    name,
    ...(number === undefined ? {} : { number }),
    favourite: false,
    hidden,
  });

/** A programme on `channelId` from `start` to `end` (epoch ms). */
export const programme = (
  id: string,
  channelId: string,
  start: number,
  end: number,
  title = id,
): Programme =>
  Schema.decodeUnknownSync(Programme)({
    id,
    channelId,
    start: iso(start),
    end: iso(end),
    title,
    categories: [],
    repeat: false,
    live: false,
  });

/** Options for {@link recording}. */
export interface RecordingFixture {
  readonly id: string;
  readonly channelId: string;
  readonly start: number;
  readonly end: number;
  readonly state?: string;
  readonly programmeId?: string;
  readonly title?: string;
  readonly beforeMinutes?: number;
  readonly afterMinutes?: number;
  readonly watched?: boolean;
  readonly positionMillis?: number;
  /** Folder names of the group path, as plain text segments. */
  readonly folders?: readonly string[];
  /** Missing stretches `[start, end)` in epoch ms, reported as plain gaps. */
  readonly gaps?: readonly (readonly [number, number])[];
  /** Nothing arrived at all. */
  readonly noData?: boolean;
  readonly ownerIds?: readonly string[];
  readonly protected?: boolean;
  readonly sizeBytes?: number;
  /** The search for a repeat, as wire JSON (`RerunView`). */
  readonly rerun?: unknown;
  /** The damaged recording this repeat replaces. */
  readonly replaces?: string;
}

/** A library entry as `GET /recordings` returns it. */
export const recording = (options: RecordingFixture): RecordingEntry =>
  Schema.decodeUnknownSync(RecordingEntry)({
    id: options.id,
    ...(options.programmeId === undefined ? {} : { programmeId: options.programmeId }),
    channelId: options.channelId,
    start: iso(options.start),
    end: iso(options.end),
    title: options.title ?? options.id,
    categories: [],
    repeat: false,
    live: false,
    padding: {
      beforeMinutes: options.beforeMinutes ?? 0,
      afterMinutes: options.afterMinutes ?? 0,
    },
    state: options.state ?? "scheduled",
    problems: [
      ...(options.gaps ?? []).map(([start, end]) => ({
        _tag: "Gap",
        range: { start: iso(start), end: iso(end) },
      })),
      ...(options.noData === true ? [{ _tag: "NoData" }] : []),
    ],
    ownerIds: options.ownerIds ?? ["u1"],
    protected: options.protected ?? false,
    labels: [],
    exportStatus: "none",
    createdAt: iso(0),
    group: {
      source: "title",
      folders: (options.folders ?? []).map((text) => ({ _tag: "Text", text })),
      item: { _tag: "Text", text: options.title ?? options.id },
    },
    sizeBytes: options.sizeBytes ?? 0,
    watched: options.watched ?? false,
    positionMillis: options.positionMillis ?? 0,
    ...(options.rerun === undefined ? {} : { rerun: options.rerun }),
    ...(options.replaces === undefined
      ? {}
      : {
          replacesId: options.replaces,
          replaces: {
            recordingId: options.replaces,
            start: iso(options.start),
            channelId: options.channelId,
          },
        }),
  });

/** A conflict between recordings over `[start, end)`. */
export const conflict = (
  recordingIds: readonly string[],
  start: number,
  end: number,
): ScheduleConflict =>
  Schema.decodeUnknownSync(ScheduleConflict)({
    range: { start: iso(start), end: iso(end) },
    channelIds: [],
    recordingIds,
    sourceIds: [],
    capacity: 0,
  });
