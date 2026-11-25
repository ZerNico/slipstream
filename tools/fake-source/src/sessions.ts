import { Context, Effect, Layer, Ref, Schema, type Scope } from "effect";

/** One stream a client is receiving right now. */
export interface StreamSession {
  readonly id: number;
  readonly channelId: string;
  readonly startedAt: string;
  /** The ffmpeg process producing it, once spawned. */
  readonly pid: number | null;
}

/** A stream request past the source's concurrent-stream limit. */
export class SourceLimitReached extends Schema.TaggedError<SourceLimitReached>()(
  "SourceLimitReached",
  { limit: Schema.Number },
) {}

interface Registry {
  readonly nextId: number;
  readonly sessions: ReadonlyMap<number, StreamSession>;
}

/** The streams currently being served, with the concurrent-stream limit enforced on open. */
export class StreamSessions extends Context.Service<
  StreamSessions,
  {
    /**
     * Claims a stream slot for the life of the current scope. Fails when `limit` streams are
     * already open; the check and the claim are one atomic step.
     */
    open(
      channelId: string,
      limit: number | null,
    ): Effect.Effect<number, SourceLimitReached, Scope.Scope>;
    attachProcess(id: number, pid: number): Effect.Effect<void>;
    readonly list: Effect.Effect<ReadonlyArray<StreamSession>>;
  }
>()("@slipstream/fake-source/StreamSessions") {
  static readonly layer = Layer.effect(
    StreamSessions,
    Effect.gen(function* () {
      const ref = yield* Ref.make<Registry>({ nextId: 1, sessions: new Map() });

      const claim = (channelId: string, limit: number | null) =>
        Ref.modify(ref, (registry): readonly [number | null, Registry] => {
          if (limit !== null && registry.sessions.size >= limit) return [null, registry];
          const id = registry.nextId;
          const sessions = new Map(registry.sessions);
          sessions.set(id, { id, channelId, startedAt: new Date().toISOString(), pid: null });
          return [id, { nextId: id + 1, sessions }];
        });

      const release = (id: number) =>
        Ref.update(ref, (registry) => {
          const sessions = new Map(registry.sessions);
          sessions.delete(id);
          return { ...registry, sessions };
        });

      const open = (channelId: string, limit: number | null) =>
        Effect.acquireRelease(
          Effect.flatMap(claim(channelId, limit), (id) =>
            id === null
              ? Effect.fail(new SourceLimitReached({ limit: limit ?? 0 }))
              : Effect.succeed(id),
          ),
          release,
        );

      const attachProcess = (id: number, pid: number) =>
        Ref.update(ref, (registry) => {
          const session = registry.sessions.get(id);
          if (!session) return registry;
          const sessions = new Map(registry.sessions);
          sessions.set(id, { ...session, pid });
          return { ...registry, sessions };
        });

      return StreamSessions.of({
        open,
        attachProcess,
        list: Effect.map(Ref.get(ref), (registry) => [...registry.sessions.values()]),
      });
    }),
  );
}
