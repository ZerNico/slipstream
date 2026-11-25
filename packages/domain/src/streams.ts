import { Schema } from "effect";

const Count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));

/**
 * One source's streams in the stream model of SPEC 7.9: "tvproxy allows 4 streams: 2 are kept
 * for recordings, 2 for watching." Recordings may use every stream (and stop live viewers when
 * they need one); watching may use what neither the kept streams nor running recordings take.
 */
export const StreamCounts = Schema.Struct({
  /** The source's limit; absent means unlimited. */
  maxStreams: Schema.optionalKey(Schema.Int.check(Schema.isGreaterThanOrEqualTo(1))),
  /** Streams watching may never take. */
  keptForRecordings: Count,
  /** Streams running recordings use now. */
  recording: Count,
  /** Streams live viewers use now. */
  watching: Count,
}).annotate({ identifier: "StreamCounts" });
export type StreamCounts = typeof StreamCounts.Type;

/** How many streams are left, `undefined` meaning unlimited. */
export interface StreamHeadroom {
  /** Streams watching may use in total right now. */
  readonly watchingCapacity: number | undefined;
  readonly freeForWatching: number | undefined;
  readonly freeForRecording: number | undefined;
  /** Every stream is in use ("4 of 4 streams", shown in orange). */
  readonly atLimit: boolean;
}

/**
 * Applies the stream model to current counts. Watching may use `max - max(kept, recording)`
 * streams; a recording may take any stream not used by another recording, preempting viewers.
 * The kept count is capped at the limit, so a misconfigured source never yields negative space.
 */
export const streamHeadroom = (counts: StreamCounts): StreamHeadroom => {
  const max = counts.maxStreams;
  if (max === undefined) {
    return {
      watchingCapacity: undefined,
      freeForWatching: undefined,
      freeForRecording: undefined,
      atLimit: false,
    };
  }
  const kept = Math.min(counts.keptForRecordings, max);
  const watchingCapacity = Math.max(0, max - Math.max(kept, counts.recording));
  return {
    watchingCapacity,
    freeForWatching: Math.max(0, watchingCapacity - counts.watching),
    freeForRecording: Math.max(0, max - counts.recording),
    atLimit: counts.recording + counts.watching >= max,
  };
};

/**
 * Whether one more live viewer fits: the source has a free watching stream and the profile is
 * under its own limit (`profileLimit` from its access policy, `profileWatching` its streams in
 * use). Answers which limit stops it, for the player error.
 */
export const watchingVerdict = (
  counts: StreamCounts,
  profile: { readonly limit?: number | undefined; readonly watching: number },
): "ok" | "sourceFull" | "profileLimit" => {
  if (profile.limit !== undefined && profile.watching >= profile.limit) return "profileLimit";
  const { freeForWatching } = streamHeadroom(counts);
  return freeForWatching === undefined || freeForWatching > 0 ? "ok" : "sourceFull";
};
