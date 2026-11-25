/**
 * The disk-space guard (PLAN 6.3): keeps free space above a floor. Live DVR windows shrink first,
 * then retention runs; running recordings are never cut. While space stays low it warns once,
 * and again after it recovered and dropped again.
 */
import { Context, Effect, Layer, Ref, Schedule } from "effect";
import { CaptureManager } from "./capture-manager.ts";
import { RecorderEvents } from "./events.ts";
import { Storage, type StorageFailed } from "./ports.ts";
import { RetentionSweeper } from "./retention.ts";

/** Tuning for the disk guard. */
export interface DiskGuardOptions {
  /** Free space to keep, in bytes. */
  readonly floorBytes: number;
  /** DVR windows never shrink below this. Default 5 minutes. */
  readonly minDvrWindowMs?: number;
  /** How often to sweep and check. Default 1 minute. */
  readonly intervalMs?: number;
}

/** Where free space stands after a check. */
export type DiskStatus =
  | { readonly _tag: "Ok"; readonly freeBytes: number }
  | { readonly _tag: "Low"; readonly freeBytes: number; readonly floorBytes: number };

/** Watches free space and makes room. */
export class DiskGuard extends Context.Service<
  DiskGuard,
  {
    /** Checks free space now and makes room if it is below the floor. */
    readonly check: Effect.Effect<DiskStatus, StorageFailed>;
    readonly status: Effect.Effect<DiskStatus>;
  }
>()("@slipstream/recorder/DiskGuard") {
  /** The guard, sweeping and checking every `intervalMs` in the background. */
  static readonly layer = (options: DiskGuardOptions) =>
    Layer.effect(
      DiskGuard,
      Effect.gen(function* () {
        const storage = yield* Storage;
        const manager = yield* CaptureManager;
        const sweeper = yield* RetentionSweeper;
        const bus = yield* RecorderEvents;
        const minWindow = options.minDvrWindowMs ?? 5 * 60_000;
        const fullWindow = yield* manager.dvrWindowMs;
        const floor = options.floorBytes;
        const status = yield* Ref.make<DiskStatus>({
          _tag: "Ok",
          freeBytes: yield* storage.freeBytes,
        });

        const makeRoom = Effect.gen(function* () {
          let free = yield* storage.freeBytes;
          let window = yield* manager.dvrWindowMs;
          while (free < floor && window > minWindow) {
            window = Math.max(minWindow, Math.floor(window / 2));
            yield* manager.setDvrWindow(window);
            yield* sweeper.sweep;
            free = yield* storage.freeBytes;
          }
          if (free < floor) {
            yield* sweeper.sweep;
            free = yield* storage.freeBytes;
          }
          return free;
        });

        const check = Effect.gen(function* () {
          const before = yield* Ref.get(status);
          let free = yield* storage.freeBytes;
          if (free < floor) free = yield* makeRoom;
          if (free < floor) {
            const low: DiskStatus = { _tag: "Low", freeBytes: free, floorBytes: floor };
            if (before._tag === "Ok") {
              yield* bus.publish({
                _tag: "DiskSpaceLow",
                freeBytes: free,
                floorBytes: floor,
              });
            }
            yield* Ref.set(status, low);
            return low;
          }
          if (before._tag === "Low")
            yield* bus.publish({ _tag: "DiskSpaceRecovered", freeBytes: free });
          // Give viewers their full rewind back once there is comfortable room again.
          if (free >= 2 * floor && (yield* manager.dvrWindowMs) < fullWindow) {
            yield* manager.setDvrWindow(fullWindow);
          }
          const ok: DiskStatus = { _tag: "Ok", freeBytes: free };
          yield* Ref.set(status, ok);
          return ok;
        });

        // A disk that cannot be read this time is logged and asked again at the next interval;
        // the guard keeps its last status meanwhile.
        yield* sweeper.sweep.pipe(
          Effect.andThen(check),
          Effect.catchTag("StorageFailed", (error) =>
            Effect.logWarning("Could not read the free space of the segment store").pipe(
              Effect.annotateLogs({ path: error.path, error: error.message }),
            ),
          ),
          Effect.repeat(Schedule.spaced(options.intervalMs ?? 60_000)),
          Effect.forkScoped,
        );
        return DiskGuard.of({ check, status: Ref.get(status) });
      }),
    );
}
