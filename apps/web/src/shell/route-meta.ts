import { useMatches } from "@tanstack/react-router";

/**
 * What a route tells the shell, as TanStack Router `staticData` (set in the route file):
 *
 * ```ts
 * export const Route = createFileRoute("/_app/")({ staticData: { under: true }, component })
 * ```
 */
export interface ShellMeta {
  /** No chrome at all: the player, setup, sign-in, TV approval. */
  readonly full?: boolean;
  /** The page starts under a transparent top bar (Home's hero). */
  readonly under?: boolean;
  /**
   * No mini player here: `true` always (editors), `"short"` only in short landscape (the guide,
   * whose grid owns the whole screen there, SPEC §2.2).
   */
  readonly noMini?: boolean | "short";
  /** The skip link's words on this route ("Skip to the guide"). */
  readonly skipLabel?: () => string;
}

declare module "@tanstack/react-router" {
  interface StaticDataRouteOption extends ShellMeta {}
}

/** The shell settings of the current route: the deepest match wins, per setting. */
export function useShellMeta(): ShellMeta {
  const matches = useMatches();
  return matches.reduce<ShellMeta>((merged, match) => ({ ...merged, ...match.staticData }), {});
}
