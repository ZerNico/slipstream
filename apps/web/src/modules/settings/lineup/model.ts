import type { SourceStreamPage } from "@slipstream/api";
import type {
  ChannelId,
  ChannelOrigin,
  ChannelStream,
  NumberMove,
  SourceId,
  SourceStreamId,
  StreamQuality,
} from "@slipstream/domain";
import { m } from "@slipstream/i18n";

/** "Move to 6 · VOX HD moves to 7", or "Move to 30–32 · 2 channels move to the next free number". */
export const numberMoveText = (move: NumberMove): string => {
  const target =
    move.first === move.last
      ? m.lineup_move_to({ number: move.first })
      : m.lineup_move_to_range({ first: move.first, last: move.last });
  const [only] = move.displaced;
  const others =
    move.displaced.length === 0
      ? m.lineup_nothing_moves()
      : move.displaced.length === 1 && only !== undefined
        ? m.lineup_holder_moves({ name: only.name, number: only.number })
        : m.lineup_holders_move({ count: move.displaced.length });
  return `${target} · ${others}`;
};

/*
 * What the lineup knows about streams: every source's streams that belong to a channel, joined
 * with the source's name, so a row can say "Deutschland · 3 streams", the filters can ask for a
 * source or a group, and the detail can name each stream of a channel.
 */

/** One stream of a channel as the lineup shows it. */
export interface LineupStream {
  readonly id: SourceStreamId;
  readonly sourceId: SourceId;
  readonly sourceName: string;
  readonly name: string;
  readonly group?: string;
  readonly quality: StreamQuality;
  /** The playlist no longer lists it. */
  readonly gone: boolean;
}

/** The lineup's streams by channel and by id, and the groups they come in. */
export interface LineupStreams {
  readonly byChannel: ReadonlyMap<ChannelId, readonly LineupStream[]>;
  readonly byId: ReadonlyMap<SourceStreamId, LineupStream>;
  /** Playlist groups in name order; `""` stands for streams without one. */
  readonly groups: readonly string[];
}

/** Joins each source's added streams (one catalogue page per source) into the lineup's view. */
export const lineupStreams = (
  sources: ReadonlyArray<{ readonly id: SourceId; readonly name: string }>,
  pages: ReadonlyArray<SourceStreamPage | undefined>,
): LineupStreams => {
  const byChannel = new Map<ChannelId, LineupStream[]>();
  const byId = new Map<SourceStreamId, LineupStream>();
  const groups = new Set<string>();
  sources.forEach((source, index) => {
    for (const entry of pages[index]?.streams ?? []) {
      if (entry.channel === undefined) continue;
      const stream: LineupStream = {
        id: entry.id,
        sourceId: source.id,
        sourceName: source.name,
        name: entry.name,
        ...(entry.group === undefined ? {} : { group: entry.group }),
        quality: entry.quality,
        gone: entry.gone,
      };
      byId.set(stream.id, stream);
      groups.add(entry.group ?? "");
      const list = byChannel.get(entry.channel.id);
      if (list === undefined) byChannel.set(entry.channel.id, [stream]);
      else list.push(stream);
    }
  });
  return { byChannel, byId, groups: [...groups].toSorted((a, b) => a.localeCompare(b)) };
};

/** A channel's sources and groups, for the lineup filter. */
export const originOf = (streams: readonly LineupStream[] | undefined): ChannelOrigin => ({
  sourceIds: new Set(streams?.map((stream) => stream.sourceId)),
  groups: new Set(streams?.map((stream) => stream.group ?? "")),
});

/** The line under a channel's name: its group and how many streams it has. */
export const channelLine = (streams: readonly LineupStream[] | undefined): string => {
  const group = streams?.find((stream) => stream.group !== undefined)?.group;
  return [group, m.lineup_streams_count({ count: streams?.length ?? 0 })]
    .filter((part) => part !== undefined)
    .join(" · ");
};

/** A channel's streams in fallback order, named; links to streams the lineup lacks are kept bare. */
export const orderedStreams = (
  links: readonly ChannelStream[],
  known: LineupStreams,
): ReadonlyArray<{ readonly id: SourceStreamId; readonly stream: LineupStream | undefined }> =>
  links
    .toSorted((a, b) => a.priority - b.priority)
    .map((link) => ({ id: link.sourceStreamId, stream: known.byId.get(link.sourceStreamId) }));

/** A stream's quality as a short tag; nothing when the name does not say. */
export const qualityTag = (quality: StreamQuality): string | undefined => {
  switch (quality) {
    case "uhd":
      return m.lineup_quality_uhd();
    case "fhd":
      return m.lineup_quality_fhd();
    case "hd":
      return m.lineup_quality_hd();
    case "sd":
      return m.lineup_quality_sd();
    case "unknown":
      return undefined;
  }
};
