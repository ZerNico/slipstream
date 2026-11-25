/**
 * The one keyboard of every list that moves a highlight or focus by key (menus in a sheet, the
 * watch choice, the command palette): ↓/↑ move and wrap, Home and End jump to the ends.
 * `current` is -1 when nothing in the list has it yet; ↓ then goes to the first, ↑ to the last.
 * Returns the index to move to, or undefined for any other key (or an empty list).
 */
export const rovingIndex = (current: number, count: number, key: string): number | undefined => {
  if (count === 0) return undefined;
  if (key === "ArrowDown") return (current + 1) % count;
  if (key === "ArrowUp") return current < 0 ? count - 1 : (current - 1 + count) % count;
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  return undefined;
};
