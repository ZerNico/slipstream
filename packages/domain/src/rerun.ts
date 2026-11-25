import { Schema } from "effect";
import { needsRepeat, rerunAttemptsMax } from "./episode.ts";
import { ChannelId, RecordingId } from "./ids.ts";
import type { Recording } from "./recording.ts";
import { epochMs, Instant } from "./time.ts";

/*
 * The state of a damaged recording's search for its repeat (recording model §3.7). Only the
 * terminal outcomes are stored; looking and scheduled are derived on every plan, so a replan is
 * idempotent and a guide change never leaves a pointer to nothing.
 */

/** Where a damaged recording's repeat stands. */
export const RerunState = Schema.Literals([
  "looking",
  "scheduled",
  "replaced",
  "kept",
  "declined",
  "exhausted",
]);
export type RerunState = typeof RerunState.Type;

/** A recording named by when and where it airs, for "Replaces the recording from Sun 22". */
export const RecordingRef = Schema.Struct({
  recordingId: RecordingId,
  start: Instant,
  channelId: ChannelId,
}).annotate({ identifier: "RecordingRef" });
export type RecordingRef = typeof RecordingRef.Type;

/** A damaged recording's search for its repeat, as the library shows it. */
export const RerunView = Schema.Struct({
  state: RerunState,
  /** The repeat that is scheduled, or that replaced it or was kept beside it. */
  repeat: Schema.optionalKey(RecordingRef),
  /** Until when Slipstream keeps looking. */
  until: Schema.optionalKey(Instant),
}).annotate({ identifier: "RerunView" });
export type RerunView = typeof RerunView.Type;

/** What the rerun state reads from the original. */
export type RerunOriginal = Pick<
  Recording,
  "id" | "state" | "problems" | "start" | "end" | "padding"
> & {
  readonly replacedById?: Recording["replacedById"] | undefined;
  readonly rerunOutcome?: Recording["rerunOutcome"] | undefined;
  readonly rerunUntil?: Recording["rerunUntil"] | undefined;
  readonly rerunAttempts?: Recording["rerunAttempts"] | undefined;
};

/** A repeat in the chain, stored or only planned. */
export type ChainMember = Pick<Recording, "start" | "channelId"> & {
  readonly id?: RecordingId | undefined;
  readonly state?: Recording["state"] | undefined;
  readonly replacesId?: RecordingId | undefined;
};

const refOf = (member: ChainMember | undefined): RecordingRef | undefined =>
  member?.id === undefined
    ? undefined
    : { recordingId: member.id, start: member.start, channelId: member.channelId };

const view = (
  state: RerunState,
  member: ChainMember | undefined,
  until: Recording["rerunUntil"],
): RerunView => {
  const repeat = refOf(member);
  return {
    state,
    ...(repeat === undefined ? {} : { repeat }),
    ...(until === undefined ? {} : { until }),
  };
};

/**
 * The state of `original`'s search for a repeat (§3.7): `replaced` once a repeat replaced it; a
 * stored `kept`, `declined` or `exhausted`; `scheduled` while the plan (or the chain) holds a
 * repeat of it; `looking` while it needs one, the deadline has not passed and fewer than two
 * repeats failed; otherwise `exhausted`. `undefined` when there is no search: it needs no repeat,
 * or it has no deadline (not made by a series recording). `chain` holds the stored repeats
 * (`replacesId = original.id`), `plannedReplaces` what the current plan schedules with `replaces`;
 * `now` is epoch ms.
 */
export const rerunState = (
  original: RerunOriginal,
  chain: ReadonlyArray<ChainMember>,
  plannedReplaces: ReadonlyArray<ChainMember>,
  now: number,
): RerunView | undefined => {
  const ofOriginal = (member: ChainMember) =>
    member.replacesId === undefined || member.replacesId === original.id;
  const until = original.rerunUntil;
  if (original.replacedById !== undefined) {
    return view(
      "replaced",
      chain.find((member) => member.id === original.replacedById),
      until,
    );
  }
  if (original.rerunOutcome !== undefined) {
    const [latest] = chain
      .filter(ofOriginal)
      .toSorted((a, b) => epochMs(b.start) - epochMs(a.start));
    return view(original.rerunOutcome, latest, until);
  }
  const planned =
    plannedReplaces.find(ofOriginal) ??
    chain.find(
      (member) =>
        ofOriginal(member) && (member.state === "scheduled" || member.state === "recording"),
    );
  if (planned !== undefined) return view("scheduled", planned, until);
  if (until === undefined || !needsRepeat(original)) return undefined;
  const attempts = original.rerunAttempts ?? 0;
  return now < epochMs(until) && attempts < rerunAttemptsMax
    ? view("looking", undefined, until)
    : view("exhausted", undefined, until);
};
