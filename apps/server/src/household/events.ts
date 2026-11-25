/**
 * What each SSE connection may hear (SPEC 7.8): channel events for channels the viewer sees,
 * recording events for recordings they see, and source events only for admins.
 *
 * A connection belongs to a sign-in, not to the user it started as: for every event the
 * session is read again, so a household device that switched profile hears the new profile's
 * events and a changed role takes effect at once. The viewer (kind and access) is kept per
 * connection until a `HouseholdChanged` or until the session signs in someone else. When the
 * session is gone (signed out, expired, a revoked device, a deleted account) the stream ends, on
 * the next event or at the latest after {@link SESSION_RECHECK_MILLIS}.
 */
import { Deferred, Effect, Stream } from "effect";
import type { ServerEvent } from "@slipstream/api";
import type { User } from "@slipstream/domain";
import type { Database } from "../db/client.ts";
import type { HouseholdChanged } from "../events.ts";
import { loadRecording } from "../recordings/store.ts";
import { loadViewer, seesChannel, seesRecording, type Viewer } from "./viewer.ts";

/** How often a quiet event stream checks that its sign-in still holds. */
const SESSION_RECHECK_MILLIS = 5_000;

/** Whether `viewer` may hear `event`. */
const allowsEvent = (
  db: Database,
  timeZone: string,
  viewer: Viewer,
  event: ServerEvent,
): Effect.Effect<boolean> =>
  Effect.gen(function* () {
    switch (event._tag) {
      case "Connected":
        return true;
      case "SourceHealthChanged":
      case "GuideRefreshed":
        return viewer.user.role === "admin";
      case "CaptureChanged":
        return seesChannel(viewer, event.channelId);
      case "RecordingChanged":
      case "RecordingReplaced": {
        // Admins hear about every recording, deleted ones included.
        if (viewer.user.role === "admin") return true;
        const id = event._tag === "RecordingChanged" ? event.recordingId : event.id;
        const stored = yield* loadRecording(db, id);
        return stored !== undefined && (yield* seesRecording(db, viewer, stored, timeZone));
      }
      case "RecordingRemoved":
        // The row is gone, so its owners at removal decide: admins and those owners hear it.
        return viewer.user.role === "admin" || event.ownerIds.includes(viewer.user.id);
    }
  });

/**
 * The events one SSE connection receives: `connect` (the bus) filtered by what the session's
 * user may hear, ending once `sessionUser` says the sign-in is gone.
 */
export const sessionEvents = (options: {
  readonly connect: (
    allows: (event: ServerEvent) => Effect.Effect<boolean>,
  ) => Stream.Stream<ServerEvent>;
  /** When access may have changed: the cached viewer is read again. */
  readonly householdChanges: Stream.Stream<HouseholdChanged>;
  readonly db: Database;
  readonly timeZone: string;
  /** Who the connection's session signs in now; `undefined` once it is gone. */
  readonly sessionUser: Effect.Effect<User | undefined>;
  readonly recheckMillis?: number;
}): Stream.Stream<ServerEvent> =>
  Stream.unwrap(
    Effect.gen(function* () {
      const ended = yield* Deferred.make<void>();
      let cached: Viewer | undefined;
      /** The session's user now; completes `ended` when there is none. */
      const current = Effect.tap(options.sessionUser, (user) =>
        user === undefined ? Deferred.succeed(ended, undefined) : Effect.void,
      );
      /** The viewer the session signs in now, from the cache while it still fits. */
      const viewerNow = Effect.gen(function* () {
        const user = yield* current;
        if (user === undefined) return undefined;
        if (cached?.user.id !== user.id || cached.user.role !== user.role) {
          cached = yield* loadViewer(options.db, user);
        }
        return cached;
      });
      const watch = Effect.gen(function* () {
        for (;;) {
          yield* Effect.sleep(options.recheckMillis ?? SESSION_RECHECK_MILLIS);
          if ((yield* current) === undefined) return;
        }
      });
      const forget = options.householdChanges.pipe(
        Stream.mapEffect(() =>
          Effect.sync(() => {
            cached = undefined;
          }),
        ),
        Stream.drain,
      );
      return options
        .connect((event) =>
          Effect.flatMap(viewerNow, (viewer) =>
            viewer === undefined
              ? Effect.succeed(false)
              : allowsEvent(options.db, options.timeZone, viewer, event),
          ),
        )
        .pipe(
          Stream.merge(forget),
          Stream.interruptWhen(Effect.race(Deferred.await(ended), watch)),
        );
    }),
  );
