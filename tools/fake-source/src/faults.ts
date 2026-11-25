import { Context, Effect, Layer, Ref, Schema } from "effect";

const HttpErrorStatus = Schema.Int.check(Schema.isBetween({ minimum: 400, maximum: 599 }));
const Seconds = Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0));

/**
 * How a stream request is refused: an HTTP error status (403, 429 and 509 are what IPTV panels send
 * at their connection limit) or `"eof"`, a 200 that closes before the first byte.
 */
export const Refusal = Schema.Union([Schema.Literal("eof"), HttpErrorStatus]);
export type Refusal = typeof Refusal.Type;

/** `reset` destroys the connection mid-stream; `eof` ends the body cleanly. */
export const DropMode = Schema.Literals(["reset", "eof"]);
export type DropMode = typeof DropMode.Type;

/**
 * Faults for one stream request, as query parameters on `/stream/<id>.ts` (or on `/playlist.m3u`,
 * which copies them onto every stream URL).
 */
export const StreamFaultsQuery = Schema.Struct({
  refuse: Schema.optional(
    Schema.Union([
      Schema.Literal("eof"),
      Schema.NumberFromString.pipe(Schema.decodeTo(HttpErrorStatus)),
    ]),
  ),
  dropAfter: Schema.optional(Schema.NumberFromString.pipe(Schema.decodeTo(Seconds))),
  dropMode: Schema.optional(DropMode),
  stallAfter: Schema.optional(Schema.NumberFromString.pipe(Schema.decodeTo(Seconds))),
});
export type StreamFaultsQuery = typeof StreamFaultsQuery.Type;

/** Source-wide fault settings, changed at runtime through `/control`. */
export const FaultState = Schema.Struct({
  /** Refuse every stream request this way. */
  refuse: Schema.NullOr(Refusal),
  /** With `refuse`: refuse only this many more requests, then go back to normal. */
  refuseCount: Schema.NullOr(Schema.Int.check(Schema.isGreaterThanOrEqualTo(1))),
  /** Drop every stream after this many seconds. */
  dropAfter: Schema.NullOr(Seconds),
  dropMode: DropMode,
  /** Stop sending (but keep the connection open) after this many seconds. */
  stallAfter: Schema.NullOr(Seconds),
  /** At most this many streams at once; null for unlimited. */
  maxStreams: Schema.NullOr(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
  /** The status a request past `maxStreams` gets. */
  limitStatus: HttpErrorStatus,
});
export type FaultState = typeof FaultState.Type;

/** A partial `FaultState` as the body of `POST /control`; `null` clears a setting. */
export const FaultUpdate = Schema.Struct({
  refuse: Schema.optional(FaultState.fields.refuse),
  refuseCount: Schema.optional(FaultState.fields.refuseCount),
  dropAfter: Schema.optional(FaultState.fields.dropAfter),
  dropMode: Schema.optional(FaultState.fields.dropMode),
  stallAfter: Schema.optional(FaultState.fields.stallAfter),
  maxStreams: Schema.optional(FaultState.fields.maxStreams),
  limitStatus: Schema.optional(FaultState.fields.limitStatus),
});
export type FaultUpdate = typeof FaultUpdate.Type;

/** What one stream request will go through once query and source-wide faults are combined. */
export interface StreamPlan {
  readonly refuse: Refusal | null;
  readonly dropAfter: number | null;
  readonly dropMode: DropMode;
  readonly stallAfter: number | null;
}

/** No faults, no limit, 509 at the limit (the status Xtream panels commonly send). */
export const noFaults: FaultState = {
  refuse: null,
  refuseCount: null,
  dropAfter: null,
  dropMode: "reset",
  stallAfter: null,
  maxStreams: null,
  limitStatus: 509,
};

/** Source-wide fault settings and the per-request plan derived from them. */
export class FaultControl extends Context.Service<
  FaultControl,
  {
    readonly state: Effect.Effect<FaultState>;
    update(update: FaultUpdate): Effect.Effect<FaultState>;
    readonly reset: Effect.Effect<FaultState>;
    /**
     * Combines a request's query faults with the source-wide ones (the query wins) and uses up one
     * counted refusal if `refuseCount` refuses the request.
     */
    plan(query: StreamFaultsQuery): Effect.Effect<StreamPlan>;
  }
>()("@slipstream/fake-source/FaultControl") {
  /** Starts from `initial`; `reset` returns to it. */
  static readonly layer = (initial: FaultState) =>
    Layer.effect(
      FaultControl,
      Effect.gen(function* () {
        const ref = yield* Ref.make(initial);
        const plan = (query: StreamFaultsQuery) =>
          Ref.modify(ref, (state): readonly [StreamPlan, FaultState] => {
            const base = {
              dropAfter: query.dropAfter ?? state.dropAfter,
              dropMode: query.dropMode ?? state.dropMode,
              stallAfter: query.stallAfter ?? state.stallAfter,
            };
            if (query.refuse !== undefined) return [{ ...base, refuse: query.refuse }, state];
            if (state.refuse === null) return [{ ...base, refuse: null }, state];
            if (state.refuseCount === null) return [{ ...base, refuse: state.refuse }, state];
            const remaining = state.refuseCount - 1;
            const next: FaultState =
              remaining > 0
                ? { ...state, refuseCount: remaining }
                : { ...state, refuse: null, refuseCount: null };
            return [{ ...base, refuse: state.refuse }, next];
          });
        const update = (changes: FaultUpdate) =>
          Ref.updateAndGet(ref, (state) => ({
            refuse: changes.refuse === undefined ? state.refuse : changes.refuse,
            refuseCount:
              changes.refuseCount === undefined ? state.refuseCount : changes.refuseCount,
            dropAfter: changes.dropAfter === undefined ? state.dropAfter : changes.dropAfter,
            dropMode: changes.dropMode ?? state.dropMode,
            stallAfter: changes.stallAfter === undefined ? state.stallAfter : changes.stallAfter,
            maxStreams: changes.maxStreams === undefined ? state.maxStreams : changes.maxStreams,
            limitStatus: changes.limitStatus ?? state.limitStatus,
          }));
        return FaultControl.of({
          state: Ref.get(ref),
          update,
          reset: Ref.updateAndGet(ref, () => initial),
          plan,
        });
      }),
    );
}
