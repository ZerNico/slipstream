import { describe, expect, it } from "vitest";
import { defaultAcceleration, idleHold, pressKey, stepsFor, type KeyHold } from "./hold.ts";

/** Presses `key` `count` times, `every` ms apart from `from`, collecting the steps. */
const hold = (count: number, every: number, key = "down", from = 0) => {
  let state: KeyHold = idleHold;
  const steps: number[] = [];
  for (let index = 0; index < count; index++) {
    const result = pressKey(state, key, from + index * every);
    state = result.hold;
    steps.push(result.steps);
  }
  return { state, steps };
};

describe("pressKey", () => {
  it("moves one step per press at first", () => {
    expect(hold(10, 50).steps).toEqual(Array.from({ length: 10 }, () => 1));
  });

  it("speeds up the longer a key is held", () => {
    const { steps, state } = hold(40, 50);
    expect(steps[9]).toBe(1);
    expect(steps[10]).toBe(2);
    expect(steps[29]).toBe(2);
    expect(steps[30]).toBe(3);
    expect(state.repeats).toBe(39);
  });

  it("starts over after a pause longer than the repeat gap", () => {
    const { state } = hold(20, 50);
    const after = pressKey(state, "down", state.lastAt + defaultAcceleration.repeatGap + 1);
    expect(after).toEqual({
      hold: { key: "down", repeats: 0, lastAt: after.hold.lastAt },
      steps: 1,
    });
  });

  it("starts over when a different key is pressed", () => {
    const { state } = hold(20, 50);
    expect(pressKey(state, "up", state.lastAt + 10).steps).toBe(1);
  });

  it("counts the initial key repeat delay as part of the hold", () => {
    const first = pressKey(idleHold, "right", 0);
    const second = pressKey(first.hold, "right", 500);
    expect(second.hold.repeats).toBe(1);
  });
});

describe("stepsFor", () => {
  it("uses the last stage reached", () => {
    const config = {
      repeatGap: 100,
      stages: [
        { after: 0, steps: 1 },
        { after: 2, steps: 5 },
      ],
    };
    expect([0, 1, 2, 3].map((repeats) => stepsFor(repeats, config))).toEqual([1, 1, 5, 5]);
  });
});
