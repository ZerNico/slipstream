import { idleHold, type KeyHold } from "./core/index.ts";
import { describe, expect, it } from "vitest";
import { guideActionForKey, readPress, remoteToAction } from "./remote.ts";

describe("readPress", () => {
  it("reads Android's numeric key actions", () => {
    expect(readPress({ eventType: "down", eventKeyAction: 0 })).toEqual({
      key: "down",
      phase: "down",
    });
    expect(readPress({ eventType: "down", eventKeyAction: 1 })).toEqual({
      key: "down",
      phase: "up",
    });
  });

  it("reads a held arrow's long press as the arrow, held", () => {
    expect(readPress({ eventType: "longRight", eventKeyAction: 0 })).toEqual({
      key: "right",
      phase: "down",
      held: true,
    });
    expect(readPress({ eventType: "longUp", eventKeyAction: 1 })).toEqual({
      key: "up",
      phase: "up",
      held: true,
    });
    expect(readPress({ eventType: "longSelect", eventKeyAction: 0 })).toEqual({
      key: "longSelect",
      phase: "down",
    });
  });

  it("treats events without a key action as presses and ignores focus events", () => {
    expect(readPress({ eventType: "select" })).toEqual({ key: "select", phase: "down" });
    expect(readPress({ eventType: "focus" })).toBeUndefined();
    expect(readPress({ eventType: "blur", eventKeyAction: 0 })).toBeUndefined();
  });
});

describe("guideActionForKey", () => {
  it("maps the remote's keys onto guide actions", () => {
    expect(guideActionForKey("left", 2, 0)).toEqual({ _tag: "Left", steps: 2 });
    expect(guideActionForKey("channelUp", 1, 0)).toEqual({ _tag: "PageUp" });
    expect(guideActionForKey("channelDown", 1, 0)).toEqual({ _tag: "PageDown" });
    expect(guideActionForKey("rewind", 1, 0)).toEqual({ _tag: "DayBack" });
    expect(guideActionForKey("next", 1, 0)).toEqual({ _tag: "DayForward" });
    expect(guideActionForKey("info", 1, 42)).toEqual({ _tag: "Now", now: 42 });
    expect(guideActionForKey("select", 1, 0)).toBeUndefined();
  });
});

/** Feeds Android down events for `key` every `every` ms. */
const holdKey = (key: string, count: number, every: number) => {
  let hold: KeyHold = idleHold;
  const steps: (number | undefined)[] = [];
  for (let index = 0; index < count; index++) {
    const result = remoteToAction(hold, { eventType: key, eventKeyAction: 0 }, index * every);
    hold = result.hold;
    const action = result.action;
    steps.push(action !== undefined && "steps" in action ? action.steps : undefined);
  }
  return { hold, steps };
};

describe("remoteToAction", () => {
  it("accelerates a held arrow key", () => {
    const { steps } = holdKey("down", 12, 50);
    expect(steps.slice(0, 10)).toEqual(Array.from({ length: 10 }, () => 1));
    expect(steps[10]).toBe(2);
  });

  it("starts over when the key comes up", () => {
    const { hold } = holdKey("down", 20, 50);
    const released = remoteToAction(hold, { eventType: "down", eventKeyAction: 1 }, 1000);
    expect(released).toEqual({ hold: idleHold, action: undefined });
    const again = remoteToAction(released.hold, { eventType: "down", eventKeyAction: 0 }, 1010);
    expect(again.action).toEqual({ _tag: "Down", steps: 1 });
  });

  it("never accelerates paging", () => {
    const { steps } = holdKey("channelDown", 30, 50);
    expect(steps.every((value) => value === undefined)).toBe(true);
    const result = remoteToAction(idleHold, { eventType: "channelDown", eventKeyAction: 0 }, 0);
    expect(result.action).toEqual({ _tag: "PageDown" });
  });
});
