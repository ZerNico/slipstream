import type { ChannelUpdate } from "./channel.ts";
import type { ChannelId } from "./ids.ts";

/*
 * The channel list every client edits (web and phone): moving an item in a list (a channel's
 * streams), and what a channel edit sends.
 */

/** The list with the item at `from` moved to `to`. */
export const moveItem = <A>(items: readonly A[], from: number, to: number): A[] => {
  const next = [...items];
  const [item] = next.splice(from, 1);
  if (item === undefined) return [...items];
  next.splice(to, 0, item);
  return next;
};

/** What a channel edit changes; an absent field changes nothing. */
export type ChannelChange = {
  readonly name?: string;
  readonly number?: number;
  readonly hidden?: boolean;
  readonly logoUrl?: string | undefined;
};

/** A logo set back to automatic travels as `null`; an absent field changes nothing. */
export const channelChangePayload = (change: ChannelChange): ChannelUpdate => {
  const { logoUrl, ...rest } = change;
  return "logoUrl" in change ? { ...rest, logoUrl: logoUrl ?? null } : rest;
};

/*
 * Fixed channel numbers (channel management): a number belongs to its channel and the lineup is
 * ordered by it, gaps allowed. Taking a number another channel holds moves that one to the next
 * free number above; nothing else is renumbered.
 */

/** A channel as numbering sees it. */
export interface NumberedChannel {
  readonly id: ChannelId;
  readonly name: string;
  readonly number?: number | undefined;
}

/** One channel's new number. */
export interface NumberChange {
  readonly id: ChannelId;
  readonly number: number;
}

/** The smallest number above `above` that is not in `taken`. */
export const nextFreeNumber = (taken: ReadonlySet<number>, above: number): number => {
  let number = above + 1;
  while (taken.has(number)) number += 1;
  return number;
};

/**
 * The number an imported channel gets: the playlist's own (`tvg-chno`) when it is free, else
 * the one after the highest number in use (1 for an empty lineup).
 */
export const importNumber = (taken: ReadonlySet<number>, wanted: number | undefined): number =>
  wanted !== undefined && !taken.has(wanted) ? wanted : Math.max(0, ...taken) + 1;

/**
 * Gives `ids` the numbers `start`, `start + 1`, … in that order. A channel outside `ids` holding
 * one of those numbers moves to the next free number above it; no other channel changes. Only
 * channels whose number changes are returned. Ids not in the lineup are ignored.
 */
export const placeNumbers = (
  lineup: ReadonlyArray<NumberedChannel>,
  ids: ReadonlyArray<ChannelId>,
  start: number,
): Array<NumberChange> => {
  const known = new Set(lineup.map((channel) => channel.id));
  const moving = [...new Set(ids)].filter((id) => known.has(id));
  const movingSet = new Set<ChannelId>(moving);
  const next = new Map<ChannelId, number | undefined>(
    lineup.map((channel) => [channel.id, channel.number]),
  );
  const holders = new Map<number, ChannelId>();
  for (const channel of lineup) {
    if (channel.number !== undefined && !movingSet.has(channel.id)) {
      holders.set(channel.number, channel.id);
    }
  }
  const displaced: Array<{ id: ChannelId; from: number }> = [];
  moving.forEach((id, index) => {
    const number = start + index;
    const holder = holders.get(number);
    if (holder !== undefined) displaced.push({ id: holder, from: number });
    holders.set(number, id);
    next.set(id, number);
  });
  const taken = new Set(holders.keys());
  for (const { id, from } of displaced) {
    const number = nextFreeNumber(taken, from);
    taken.add(number);
    next.set(id, number);
  }
  return lineup.flatMap((channel) => {
    const number = next.get(channel.id);
    return number === undefined || number === channel.number ? [] : [{ id: channel.id, number }];
  });
};

/**
 * Makes numbers unique: of channels sharing a number the first in guide order (by name) keeps
 * it and each later one moves to the next free number above. For lineups from before numbers
 * were unique.
 */
export const dedupeNumbers = (lineup: ReadonlyArray<NumberedChannel>): Array<NumberChange> => {
  const ordered = lineup
    .filter((channel) => channel.number !== undefined)
    .toSorted((a, b) => (a.number ?? 0) - (b.number ?? 0) || a.name.localeCompare(b.name) || 0);
  const taken = new Set(ordered.map((channel) => channel.number ?? 0));
  const seen = new Set<number>();
  const changes: Array<NumberChange> = [];
  for (const channel of ordered) {
    const number = channel.number ?? 0;
    if (!seen.has(number)) {
      seen.add(number);
      continue;
    }
    const free = nextFreeNumber(taken, number);
    taken.add(free);
    changes.push({ id: channel.id, number: free });
  }
  return changes;
};
