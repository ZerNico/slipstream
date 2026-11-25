import type { ChannelId } from "@slipstream/domain";
import { createContext, use } from "react";

/**
 * What the lineup can do to channels. One object for every row and the detail, so a change to
 * one channel re-renders no other row.
 */
export interface LineupActions {
  readonly open: (id: ChannelId) => void;
  readonly select: (id: ChannelId, range: boolean) => void;
  readonly moveToTop: (ids: readonly ChannelId[]) => void;
  readonly moveToNumber: (ids: readonly ChannelId[]) => void;
  readonly setNumber: (id: ChannelId, number: number) => void;
  readonly setHidden: (ids: readonly ChannelId[], hidden: boolean) => void;
  readonly setFavourite: (ids: readonly ChannelId[], favourite: boolean) => void;
  readonly rename: (id: ChannelId, name: string) => void;
  readonly remove: (ids: readonly ChannelId[]) => void;
}

/** Provides the lineup's actions to its rows and detail. */
export const LineupActionsContext = createContext<LineupActions | null>(null);

/** The lineup's actions. */
export const useLineupActions = (): LineupActions => {
  const actions = use(LineupActionsContext);
  if (actions === null) throw new Error("useLineupActions outside the lineup");
  return actions;
};
