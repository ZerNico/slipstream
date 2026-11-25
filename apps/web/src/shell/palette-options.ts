import { filterSearchOptions, type SearchOption } from "@slipstream/domain";
import type { IconSvgElement } from "~/ui/icon.tsx";

/** One result: what it says, where it leads. */
export interface PaletteOption extends SearchOption<
  "actions" | "channels" | "guide" | "recordings" | "collections" | "series"
> {
  readonly id: string;
  readonly icon: IconSvgElement;
  readonly run: () => void;
}

/** The order groups appear in (SPEC §4 Command palette). */
export const groupOrder: readonly PaletteOption["group"][] = [
  "actions",
  "channels",
  "guide",
  "recordings",
  "collections",
  "series",
];

/** How many results a group shows at most. */
const perGroup = 6;

/**
 * Filters and orders options for a query (the domain's `filterSearchOptions`): title and meta
 * match case-insensitively, options the server matched pass as they are, groups in a fixed
 * order, at most `perGroup` per group. An empty query shows actions.
 */
export const filterOptions = (options: readonly PaletteOption[], query: string): PaletteOption[] =>
  filterSearchOptions(options, query, groupOrder, { perGroup, whenEmpty: "actions" });
