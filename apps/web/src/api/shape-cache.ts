import { matchQuery, type Query, type QueryCache, type QueryKey } from "@tanstack/react-query";
import { useState } from "react";
import { Schema } from "effect";
import { PlaybackSettings, RecordingEntry, ScheduleConflict, SystemInfo } from "@slipstream/api";
import { Channel, Collection, Profile, Rule, SourceView, User } from "@slipstream/domain";
import { storageKeys } from "~/storage-keys.ts";
import { keys } from "./queries.ts";

/** Bigger answers are not kept: the skeleton then falls back to its defaults. */
const maxChars = 1_500_000;

/** A last answer kept in this browser, read back as the skeleton's shape. */
export interface ShapeCache<A> {
  /** The last answer, or undefined when none is kept or it no longer decodes. */
  readonly read: () => A | undefined;
  /** Keeps an answer for the next load. */
  readonly write: (value: A) => void;
}

/**
 * The skeleton contract's "expected shape from the previous response" (SPEC §6.2) across page
 * loads: the last answer of a read, encoded with its schema in `localStorage`. While the route
 * loads, the screen renders this answer under the skeleton, so the loaded screen lands in the
 * very same boxes. A per-viewer convenience only: every read and write may fail and is ignored,
 * and the screen renders its defaults without it. Screens with a shape of their own (Home's
 * layout) keep it with this too.
 */
export const shapeCache = <A, I>(key: string, schema: Schema.Codec<A, I>): ShapeCache<A> => {
  const storageKey = storageKeys.shape(key);
  const decode = Schema.decodeUnknownSync(schema);
  const encode = Schema.encodeSync(schema);
  return {
    read: () => {
      try {
        const raw = localStorage.getItem(storageKey);
        return raw === null ? undefined : decode(JSON.parse(raw));
      } catch {
        return undefined;
      }
    },
    write: (value) => {
      try {
        const json = JSON.stringify(encode(value));
        if (json.length <= maxChars) localStorage.setItem(storageKey, json);
      } catch {
        // Private windows and full storage keep nothing; the skeleton uses its defaults.
      }
    },
  };
};

/**
 * The last answers of the shared reads, so any screen's skeleton can be drawn from them while
 * the read loads (the "previous response" of SPEC §6.2). {@link persistShapes} keeps them.
 */
export const shapes = {
  recordings: shapeCache("recordings", Schema.Array(RecordingEntry)),
  channels: shapeCache("channels", Schema.Array(Channel)),
  collections: shapeCache("collections", Schema.Array(Collection)),
  rules: shapeCache("rules", Schema.Array(Rule)),
  profiles: shapeCache("profiles", Schema.Array(Profile)),
  me: shapeCache("me", User),
  system: shapeCache("system", SystemInfo),
  conflicts: shapeCache("conflicts", Schema.Array(ScheduleConflict)),
  sources: shapeCache("sources", Schema.Array(SourceView)),
  playbackSettings: shapeCache("settings.playback", PlaybackSettings),
};

/** Which read fills which cache; `exact: false` keeps any window of a read (conflicts). */
const kept = <A>(queryKey: QueryKey, cache: ShapeCache<A>, exact = true) => ({
  matches: (query: Query) => matchQuery({ queryKey, exact }, query),
  // The cache under this key holds exactly this read's answer.
  write: (data: unknown) => cache.write(data as A),
});

const persisted = [
  kept(keys.recordingList, shapes.recordings),
  kept(keys.channels, shapes.channels),
  kept(keys.collections, shapes.collections),
  kept(keys.ruleList, shapes.rules),
  kept(keys.profiles, shapes.profiles),
  kept(keys.me, shapes.me),
  kept(keys.system, shapes.system),
  kept(["recordings", "conflicts"], shapes.conflicts, false),
  kept(keys.sources, shapes.sources),
  kept(keys.playbackSettings, shapes.playbackSettings),
];

/**
 * Keeps every fresh answer of the reads in {@link shapes} for the next page load, wherever it
 * was read. Placeholder answers never reach the query's state, so only the server's are kept.
 * Returns the unsubscribe.
 */
export const persistShapes = (queryCache: QueryCache): (() => void) =>
  queryCache.subscribe((event) => {
    if (event.type !== "updated" || event.action.type !== "success") return;
    const { data } = event.query.state;
    if (data === undefined) return;
    for (const entry of persisted) if (entry.matches(event.query)) entry.write(data);
  });

/**
 * A kept answer read once per mount, for a read's `placeholderData`. Decoding the cache on every
 * render would hand the query a new placeholder each time (its dates are never deeply equal),
 * and a read that stays pending would then re-render without end.
 */
export const useKept = <A>(cache: ShapeCache<A>): A | undefined => useState(cache.read)[0];
