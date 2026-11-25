/**
 * Held-key acceleration. A remote repeats a held arrow key many times a second; after a while
 * each repeat should move further so long lists are quick to cross.
 */

/** Which key is being held, how many repeats it has produced and when the last one came. */
export interface KeyHold {
  readonly key: string | undefined;
  readonly repeats: number;
  readonly lastAt: number;
}

/** From `after` repeats on, each press moves `steps`. */
export interface AccelerationStage {
  readonly after: number;
  readonly steps: number;
}

/** How presses are grouped into a hold and how fast a hold speeds up. */
export interface AccelerationConfig {
  /** Presses of the same key closer together than this (ms) count as one hold. */
  readonly repeatGap: number;
  /** Ascending by `after`; the first stage should start at 0 with 1 step. */
  readonly stages: readonly AccelerationStage[];
}

/** About half a second of holding at Android's repeat rate before speeding up. */
export const defaultAcceleration: AccelerationConfig = {
  repeatGap: 600,
  stages: [
    { after: 0, steps: 1 },
    { after: 10, steps: 2 },
    { after: 30, steps: 3 },
  ],
};

/** No key held. */
export const idleHold: KeyHold = { key: undefined, repeats: 0, lastAt: Number.NEGATIVE_INFINITY };

/** Steps per press after `repeats` repeats under `config`. */
export const stepsFor = (repeats: number, config: AccelerationConfig): number => {
  let steps = 1;
  for (const stage of config.stages) {
    if (repeats >= stage.after) steps = stage.steps;
  }
  return steps;
};

/**
 * Registers a key press at time `at` (ms) and says how many steps it should move. A different
 * key, or a pause longer than `repeatGap`, starts a new hold.
 */
export const pressKey = (
  hold: KeyHold,
  key: string,
  at: number,
  config: AccelerationConfig = defaultAcceleration,
): { readonly hold: KeyHold; readonly steps: number } => {
  const continues = hold.key === key && at - hold.lastAt <= config.repeatGap;
  const repeats = continues ? hold.repeats + 1 : 0;
  return { hold: { key, repeats, lastAt: at }, steps: stepsFor(repeats, config) };
};
