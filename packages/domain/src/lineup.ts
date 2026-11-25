import type { Channel } from "./channel.ts";
import { type NumberedChannel, placeNumbers } from "./channel-order.ts";
import type { ChannelId } from "./ids.ts";

/*
 * The channel lineup as Settings shows it (web and phone): which channels a filter keeps, the
 * counts on its chips, and what typing a number does before it is saved.
 */

/** Which channels the lineup lists by visibility. */
export type LineupView = "all" | "visible" | "hidden";

/** The lineup's filters; absent `sourceId` or `group` means any. */
export interface LineupFilter {
  readonly view: LineupView;
  readonly search: string;
  readonly noGuide: boolean;
  readonly favourites: boolean;
  readonly sourceId?: string | undefined;
  /** A playlist group; `""` is streams without one. */
  readonly group?: string | undefined;
}

/** Where a channel's streams come from: their sources and playlist groups (`""` for none). */
export interface ChannelOrigin {
  readonly sourceIds: ReadonlySet<string>;
  readonly groups: ReadonlySet<string>;
}

type LineupChannel = Pick<
  Channel,
  "id" | "name" | "number" | "hidden" | "favourite" | "guideChannelId"
>;

/**
 * Whether a channel passes the filter. The search matches the name, the number (as typed, from
 * its start) and the guide id, ignoring case.
 */
export const matchesLineup = (
  channel: LineupChannel,
  filter: LineupFilter,
  origin: ChannelOrigin | undefined,
): boolean => {
  if (filter.view === "visible" && channel.hidden) return false;
  if (filter.view === "hidden" && !channel.hidden) return false;
  if (filter.noGuide && channel.guideChannelId !== undefined) return false;
  if (filter.favourites && !channel.favourite) return false;
  if (filter.sourceId !== undefined && origin?.sourceIds.has(filter.sourceId) !== true) {
    return false;
  }
  if (filter.group !== undefined && origin?.groups.has(filter.group) !== true) return false;
  const term = filter.search.trim().toLowerCase();
  if (term === "") return true;
  return (
    channel.name.toLowerCase().includes(term) ||
    (channel.number !== undefined && String(channel.number).startsWith(term)) ||
    (channel.guideChannelId?.toLowerCase().includes(term) ?? false)
  );
};

/** The counts the lineup's chips show, over the whole lineup. */
export interface LineupCounts {
  readonly all: number;
  readonly visible: number;
  readonly hidden: number;
  readonly noGuide: number;
  readonly favourites: number;
}

/** Counts every channel once per chip it would match on its own. */
export const lineupCounts = (channels: ReadonlyArray<LineupChannel>): LineupCounts => {
  let hidden = 0;
  let noGuide = 0;
  let favourites = 0;
  for (const channel of channels) {
    if (channel.hidden) hidden += 1;
    if (channel.guideChannelId === undefined) noGuide += 1;
    if (channel.favourite) favourites += 1;
  }
  return { all: channels.length, visible: channels.length - hidden, hidden, noGuide, favourites };
};

/** A channel that makes room when another takes its number, and the number it moves to. */
export interface DisplacedChannel {
  readonly id: ChannelId;
  readonly name: string;
  readonly number: number;
}

/** What moving channels to a number would do: their new numbers and who makes room. */
export interface NumberMove {
  /** The first and last number the moved channels get, in their order. */
  readonly first: number;
  readonly last: number;
  readonly displaced: ReadonlyArray<DisplacedChannel>;
  /** Whether anything changes at all. */
  readonly changes: boolean;
}

/**
 * Moving `ids` to `start`, `start + 1`, … as the server will do it (`placeNumbers`): the
 * holder of a taken number moves to the next free number above, nothing else is renumbered.
 * For the sentence a number field shows before it saves ("Move to 6 · VOX HD moves to 7").
 */
export const previewNumberMove = (
  lineup: ReadonlyArray<NumberedChannel>,
  ids: ReadonlyArray<ChannelId>,
  start: number,
): NumberMove => {
  const moving = new Set(ids);
  const changes = placeNumbers(lineup, ids, start);
  const names = new Map(lineup.map((channel) => [channel.id, channel.name]));
  const count = new Set(ids.filter((id) => names.has(id))).size;
  return {
    first: start,
    last: start + Math.max(0, count - 1),
    displaced: changes.flatMap((change) =>
      moving.has(change.id)
        ? []
        : [{ id: change.id, name: names.get(change.id) ?? "", number: change.number }],
    ),
    changes: changes.length > 0,
  };
};

/** The lowest number in the lineup (1 when none has one): where "Move to top" goes. */
export const topNumber = (lineup: ReadonlyArray<NumberedChannel>): number => {
  const numbers = lineup.flatMap((channel) =>
    channel.number === undefined ? [] : [channel.number],
  );
  return numbers.length === 0 ? 1 : Math.min(...numbers);
};

/** Parses a typed channel number: a whole number from 0, or `undefined`. */
export const parseLineupNumber = (text: string): number | undefined => {
  const trimmed = text.trim();
  if (!/^\d{1,6}$/u.test(trimmed)) return undefined;
  return Number(trimmed);
};

/**
 * The ids from `anchor` to `target` in list order, both included: what shift-click selects.
 * Either missing from the list selects `target` alone.
 */
export const rangeBetween = (
  order: ReadonlyArray<ChannelId>,
  anchor: ChannelId,
  target: ChannelId,
): Array<ChannelId> => {
  const from = order.indexOf(anchor);
  const to = order.indexOf(target);
  if (from === -1 || to === -1) return [target];
  return order.slice(Math.min(from, to), Math.max(from, to) + 1);
};
