import { m } from "./runtime.ts";

/**
 * How much room a conflict's copy may claim (`ConflictRoom` in @slipstream/domain): every
 * stream the sources allow, fewer streams free then, or no number at all.
 */
export type ConflictRoomWords =
  | { readonly kind: "limit"; readonly streams: number }
  | { readonly kind: "free"; readonly streams: number }
  | { readonly kind: "unknown" };

/** What the resolution's first line reads (`Resolution` in @slipstream/domain). */
export interface ResolveIntroWords {
  /** How many recordings overlap. */
  readonly count: number;
  /** The overlap, epoch ms. */
  readonly from: number;
  readonly to: number;
  readonly room: ConflictRoomWords;
}

/**
 * The resolution's first line, on every client: what overlaps and how much room there is then,
 * in the words the server's free-stream count allows ("3 recordings overlap 20:00–21:00, but
 * only 2 can record at once").
 */
export const resolveIntro = (resolution: ResolveIntroWords): string => {
  const copy = {
    count: resolution.count,
    from: new Date(resolution.from),
    to: new Date(resolution.to),
  };
  const { room } = resolution;
  switch (room.kind) {
    case "limit":
      return m.library_resolve_intro({ ...copy, capacity: room.streams });
    case "free":
      return m.library_resolve_intro_free({ ...copy, free: room.streams });
    case "unknown":
      return m.library_resolve_intro_plain(copy);
  }
};

/** What a conflict card says: how many overlap, when, how much room there is and which ones. */
export interface ConflictWords {
  /** How many recordings overlap. */
  readonly count: number;
  /** The overlap, epoch ms. */
  readonly from: number;
  readonly to: number;
  readonly room: ConflictRoomWords;
  /** The overlapping recordings' titles. */
  readonly titles: readonly string[];
}

/**
 * A conflict in one sentence, on every client, phrased with the room the server reports ("3
 * recordings overlap 20:15–22:00, but only 2 can record at once: Tatort, Terra X and Rennen.").
 */
export const conflictText = (conflict: ConflictWords): string => {
  const copy = {
    count: conflict.count,
    start: new Date(conflict.from),
    end: new Date(conflict.to),
    titles: conflict.titles,
  };
  const { room } = conflict;
  switch (room.kind) {
    case "limit":
      return m.home_issue_conflict_text({ ...copy, limit: room.streams });
    case "free":
      return m.home_issue_conflict_text_free({ ...copy, free: room.streams });
    case "unknown":
      return m.home_issue_conflict_text_plain(copy);
  }
};
