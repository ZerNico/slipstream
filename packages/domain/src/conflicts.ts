import { DateTime } from "effect";
import type { ChannelId, SourceId } from "./ids.ts";
import { epochMs, type TimeRange } from "./time.ts";

/** Something that needs a channel's capture for a while: a recording or a live viewer. */
export interface StreamDemand {
  readonly id: string;
  readonly channelId: ChannelId;
  readonly range: TimeRange;
  /** Recordings win over live viewing when a source runs out of streams (PLAN 6.3). */
  readonly kind: "recording" | "live";
}

/** Which sources a channel can be captured from, best first. */
export interface ChannelSources {
  readonly channelId: ChannelId;
  readonly sourceIds: ReadonlyArray<SourceId>;
}

/** A source and its stream limit; `maxStreams` absent means unlimited. */
export interface SourceLimit {
  readonly id: SourceId;
  readonly maxStreams?: number | undefined;
}

/** A stretch of time in which some demands cannot get a stream. */
export interface StreamConflict {
  readonly range: TimeRange;
  /** Channels that get no stream in this range. */
  readonly channelIds: ReadonlyArray<ChannelId>;
  /** The demands on those channels. */
  readonly demandIds: ReadonlyArray<string>;
  /** The sources those channels could have used, all full (empty when a channel has no stream). */
  readonly sourceIds: ReadonlyArray<SourceId>;
  /**
   * How many recordings those sources can carry at once in this range ("only 2 can record at
   * once"): their streams minus the ones live viewers keep, which recordings cannot take. The
   * smallest value over the range when merged.
   */
  readonly capacity: number;
}

/**
 * Assigns channels to sources within the limits, keeping earlier channels assigned (augmenting
 * paths never unassign a channel). Returns the channels left without a stream and which channels
 * each source carries.
 */
const assignChannels = (
  channels: ReadonlyArray<ChannelId>,
  sourcesOf: ReadonlyMap<ChannelId, ReadonlyArray<SourceId>>,
  capacity: ReadonlyMap<SourceId, number>,
): {
  readonly unserved: Array<ChannelId>;
  readonly assigned: ReadonlyMap<SourceId, ReadonlyArray<ChannelId>>;
} => {
  const assigned = new Map<SourceId, Array<ChannelId>>();
  const tryAssign = (channel: ChannelId, visited: Set<SourceId>): boolean => {
    for (const source of sourcesOf.get(channel) ?? []) {
      if (visited.has(source)) continue;
      visited.add(source);
      const holders = assigned.get(source) ?? [];
      if (holders.length < (capacity.get(source) ?? Number.POSITIVE_INFINITY)) {
        assigned.set(source, [...holders, channel]);
        return true;
      }
      for (const holder of holders) {
        if (tryAssign(holder, visited)) {
          assigned.set(
            source,
            holders.map((current) => (current === holder ? channel : current)),
          );
          return true;
        }
      }
    }
    return false;
  };
  const unserved = channels.filter((channel) => !tryAssign(channel, new Set()));
  return { unserved, assigned };
};

/**
 * Finds the time ranges in which the demands need more upstream streams than the sources allow.
 * Demands on the same channel share one capture, so they count once. Channels are served in
 * order: recordings before live viewers, then earlier-starting demands first, then input order.
 * Adjacent ranges with the same unserved channels are merged.
 */
export const detectConflicts = (
  demands: ReadonlyArray<StreamDemand>,
  channels: ReadonlyArray<ChannelSources>,
  sources: ReadonlyArray<SourceLimit>,
): Array<StreamConflict> => {
  const sourcesOf = new Map(channels.map((channel) => [channel.channelId, channel.sourceIds]));
  const capacity = new Map<SourceId, number>();
  for (const source of sources) {
    if (source.maxStreams !== undefined) capacity.set(source.id, source.maxStreams);
  }
  const ordered = demands
    .map((demand, index) => ({ demand, index }))
    .toSorted(
      (a, b) =>
        (a.demand.kind === b.demand.kind ? 0 : a.demand.kind === "recording" ? -1 : 1) ||
        epochMs(a.demand.range.start) - epochMs(b.demand.range.start) ||
        a.index - b.index,
    )
    .map(({ demand }) => demand);

  const breakpoints = [
    ...new Set(
      demands.flatMap((demand) => [epochMs(demand.range.start), epochMs(demand.range.end)]),
    ),
  ].toSorted((a, b) => a - b);

  const conflicts: Array<StreamConflict> = [];
  for (let index = 0; index + 1 < breakpoints.length; index += 1) {
    const start = breakpoints[index] ?? 0;
    const end = breakpoints[index + 1] ?? 0;
    const active = ordered.filter(
      (demand) => epochMs(demand.range.start) <= start && end <= epochMs(demand.range.end),
    );
    const activeChannels = [...new Set(active.map((demand) => demand.channelId))];
    const { unserved, assigned } = assignChannels(activeChannels, sourcesOf, capacity);
    if (unserved.length === 0) continue;

    const unservedSet = new Set(unserved);
    const demandIds = active
      .filter((demand) => unservedSet.has(demand.channelId))
      .map((demand) => demand.id);
    const sourceIds = [...new Set(unserved.flatMap((channel) => sourcesOf.get(channel) ?? []))];
    const recordingChannels = new Set(
      active.filter((demand) => demand.kind === "recording").map((demand) => demand.channelId),
    );
    const free = sourceIds.reduce(
      (sum, source) =>
        sum +
        (assigned.get(source) ?? []).filter((channel) => recordingChannels.has(channel)).length,
      0,
    );
    const previous = conflicts.at(-1);
    if (
      previous !== undefined &&
      epochMs(previous.range.end) === start &&
      previous.channelIds.length === unserved.length &&
      previous.channelIds.every((channel) => unservedSet.has(channel))
    ) {
      conflicts[conflicts.length - 1] = {
        ...previous,
        range: { start: previous.range.start, end: DateTime.makeUnsafe(end) },
        demandIds: [...new Set([...previous.demandIds, ...demandIds])],
        capacity: Math.min(previous.capacity, free),
      };
    } else {
      conflicts.push({
        range: { start: DateTime.makeUnsafe(start), end: DateTime.makeUnsafe(end) },
        channelIds: unserved,
        demandIds,
        sourceIds,
        capacity: free,
      });
    }
  }
  return conflicts;
};
