/**
 * The in-process event bus behind `GET /api/events`: services publish `ServerEvent`s, every SSE
 * connection gets its own subscription, filtered to what its viewer may know about.
 */
import { Context, DateTime, Effect, Layer, PubSub, type Scope, Stream } from "effect";
import type { ServerEvent } from "@slipstream/api";

/**
 * Something that affects what people may see or what gets planned changed: a profile, its
 * access, a rule, a collection or the household settings. Server-internal, never sent over SSE:
 * services that cache visibility or a plan listen for it and recompute.
 */
export interface HouseholdChanged {
  readonly _tag: "HouseholdChanged";
}

const householdChanged: HouseholdChanged = { _tag: "HouseholdChanged" };

/** Publishes state changes to every connected client. */
export class EventBus extends Context.Service<
  EventBus,
  {
    readonly publish: (event: ServerEvent) => Effect.Effect<void>;
    /** Events published after subscribing, until the stream is interrupted. */
    readonly events: Stream.Stream<ServerEvent>;
    /**
     * What an SSE client receives: `Connected` first, then every event published after it that
     * `allows` lets through (see `household/events.ts`). The subscription starts before
     * `Connected` goes out, so nothing falls in between.
     */
    readonly connect: (
      allows: (event: ServerEvent) => Effect.Effect<boolean>,
    ) => Stream.Stream<ServerEvent>;
    /** Announces a `HouseholdChanged` to every in-process listener. */
    readonly publishHouseholdChanged: Effect.Effect<void>;
    /** `HouseholdChanged` events published after subscribing, until interrupted. */
    readonly householdChanges: Stream.Stream<HouseholdChanged>;
    /** Server-internal: the segment index stored a segment of `channelId`. */
    readonly publishSegmentIndexed: (channelId: string) => Effect.Effect<void>;
    /**
     * Listens for segments of `channelId` from now on, for as long as the scope lasts, and
     * returns what waits for the next one: subscribe first, then look, then wait, and no segment
     * falls in between.
     */
    readonly nextSegment: (
      channelId: string,
    ) => Effect.Effect<Effect.Effect<void>, never, Scope.Scope>;
    /** The channels of segments indexed after subscribing, one per segment, until interrupted. */
    readonly segmentsIndexed: Stream.Stream<string>;
  }
>()("@slipstream/server/EventBus") {
  static readonly layer = Layer.effect(
    EventBus,
    Effect.gen(function* () {
      // A slow client drops old events instead of holding up publishers.
      const pubsub = yield* Effect.acquireRelease(
        PubSub.sliding<ServerEvent>(256),
        PubSub.shutdown,
      );
      // Listeners recompute from scratch, so a burst collapses to its latest event.
      const household = yield* Effect.acquireRelease(
        PubSub.sliding<HouseholdChanged>(1),
        PubSub.shutdown,
      );
      // Waiting live playlists listen for their channel's next segment, and live conversions
      // for every new segment of a channel someone watches converted.
      const segments = yield* Effect.acquireRelease(PubSub.sliding<string>(64), PubSub.shutdown);
      return EventBus.of({
        publish: (event) => PubSub.publish(pubsub, event).pipe(Effect.asVoid),
        events: Stream.fromPubSub(pubsub),
        connect: (allows) =>
          Stream.unwrap(
            Effect.gen(function* () {
              const subscription = yield* PubSub.subscribe(pubsub);
              const at = yield* DateTime.now;
              return Stream.concat(
                Stream.succeed<ServerEvent>({ _tag: "Connected", at }),
                Stream.fromSubscription(subscription).pipe(Stream.filterEffect(allows)),
              );
            }),
          ),
        publishHouseholdChanged: PubSub.publish(household, householdChanged).pipe(Effect.asVoid),
        householdChanges: Stream.fromPubSub(household),
        publishSegmentIndexed: (channelId) =>
          PubSub.publish(segments, channelId).pipe(Effect.asVoid),
        nextSegment: (channelId) =>
          Effect.map(PubSub.subscribe(segments), (subscription) =>
            Effect.gen(function* () {
              while ((yield* PubSub.take(subscription)) !== channelId) {
                // Another channel's segment.
              }
            }),
          ),
        segmentsIndexed: Stream.fromPubSub(segments),
      });
    }),
  );
}
