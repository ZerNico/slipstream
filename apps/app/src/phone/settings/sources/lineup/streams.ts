import type { SourceStreamEntry } from "@slipstream/api";
import type {
  ChannelId,
  ChannelOrigin,
  ChannelStream,
  SourceId,
  SourceStreamId,
  StreamQuality,
} from "@slipstream/domain";

/*
 * The lineup's streams on the phone: each source's added streams (its catalogue) grouped by the
 * channel they belong to, for the rows' "Deutschland · 3 streams" line, the source and group
 * filters, and the names and qualities of a channel's streams in fallback order.
 */

/** One stream of a channel as the lineup shows it. */
export interface LineupStream {
  readonly id: SourceStreamId;
  readonly sourceId: SourceId;
  readonly sourceName: string;
  readonly name: string;
  readonly group: string | undefined;
  readonly quality: StreamQuality;
  readonly gone: boolean;
}

/** One source's added streams, as its catalogue lists them. */
export interface SourcePage {
  readonly sourceId: SourceId;
  readonly sourceName: string;
  readonly streams: ReadonlyArray<SourceStreamEntry>;
}

/** Every channel's streams across the sources (in source, then catalogue order). */
export const streamsByChannel = (
  pages: ReadonlyArray<SourcePage>,
): ReadonlyMap<ChannelId, ReadonlyArray<LineupStream>> => {
  const byChannel = new Map<ChannelId, Array<LineupStream>>();
  for (const page of pages) {
    for (const entry of page.streams) {
      if (entry.channel === undefined) continue;
      const list = byChannel.get(entry.channel.id) ?? [];
      list.push({
        id: entry.id,
        sourceId: page.sourceId,
        sourceName: page.sourceName,
        name: entry.name,
        group: entry.group,
        quality: entry.quality,
        gone: entry.gone,
      });
      byChannel.set(entry.channel.id, list);
    }
  }
  return byChannel;
};

/** Where a channel's streams come from, for the source and group filters. */
export const originOf = (streams: ReadonlyArray<LineupStream> | undefined): ChannelOrigin => ({
  sourceIds: new Set((streams ?? []).map((stream) => stream.sourceId)),
  groups: new Set((streams ?? []).map((stream) => stream.group ?? "")),
});

/** The group a channel's row names: its first stream's that has one. */
export const groupOf = (streams: ReadonlyArray<LineupStream> | undefined): string | undefined =>
  (streams ?? []).find((stream) => stream.group !== undefined)?.group;

/**
 * A channel's links in fallback order with what the catalogue knows of each stream; a link whose
 * stream is not in any catalogue (yet) is left out.
 */
export const orderedStreams = (
  links: ReadonlyArray<ChannelStream>,
  known: ReadonlyArray<LineupStream> | undefined,
): Array<LineupStream> => {
  const byId = new Map((known ?? []).map((stream) => [stream.id, stream]));
  return links
    .toSorted((a, b) => a.priority - b.priority)
    .flatMap((link) => byId.get(link.sourceStreamId) ?? []);
};

/** The list with the item at `index` swapped with its neighbour in `direction`. */
export const moveBy = <A>(items: ReadonlyArray<A>, index: number, direction: -1 | 1): Array<A> => {
  const target = index + direction;
  const next = [...items];
  const a = next[index];
  const b = next[target];
  if (a === undefined || b === undefined) return next;
  next[index] = b;
  next[target] = a;
  return next;
};
