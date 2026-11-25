import { describe, expect, it } from "vitest";
import {
  addSkip,
  hideControls,
  AUTO_HIDE_MS,
  initialControls,
  keepControls,
  shownControls,
  SKIP_RUN_MS,
  tapPicture,
  tapSide,
  PILL_MS,
  playerKeyFor,
  reduceKey,
  tickControls,
  type ControlsState,
  type PlayerCommand,
  type PlayerKey,
} from "./controls.ts";

/** Presses keys in order, `gap` ms apart, collecting the commands. */
const press = (
  keys: readonly (PlayerKey | [PlayerKey, "up"])[],
  start: ControlsState = initialControls,
  gap = 100,
) => {
  let state = start;
  const commands: PlayerCommand[] = [];
  keys.forEach((entry, index) => {
    const [key, phase] = typeof entry === "string" ? [entry, "down" as const] : entry;
    const result = reduceKey(state, key, phase, index * gap);
    state = result.state;
    if (result.command !== undefined) commands.push(result.command);
  });
  return { state, commands };
};

describe("controls hidden", () => {
  it("skips 10 s with left and right and shows the delta pill for 3 s", () => {
    const { state, commands } = press(["right", "left", "left"]);
    expect(commands).toEqual([
      { _tag: "SeekBy", seconds: 10 },
      { _tag: "SeekBy", seconds: -10 },
      { _tag: "SeekBy", seconds: -10 },
    ]);
    expect(state.mode).toBe("hidden");
    expect(state.pillUntil).toBe(200 + PILL_MS);
    expect(tickControls(state, 200 + PILL_MS).pillUntil).toBeUndefined();
  });

  it("shows the controls on OK or up/down, and Back leaves the player", () => {
    expect(press(["select"]).state.mode).toBe("controls");
    expect(press(["down"]).state.mode).toBe("controls");
    expect(press(["back"]).commands).toEqual([{ _tag: "Exit" }]);
  });
});

describe("controls row", () => {
  it("goes up to the timeline, Back hides, and they hide by themselves", () => {
    const shown = press(["select"]).state;
    expect(press(["up"], shown).state.mode).toBe("timeline");
    expect(press(["back"], shown).state.mode).toBe("hidden");
    expect(tickControls(shown, AUTO_HIDE_MS - 1).mode).toBe("controls");
    expect(tickControls(shown, AUTO_HIDE_MS).mode).toBe("hidden");
  });

  it("keeps the controls while keys arrive", () => {
    const { state } = press(["select", "left", "right"], initialControls, 1000);
    expect(state.hideAt).toBe(2000 + AUTO_HIDE_MS);
  });

  it("toggles pause from the play/pause key in any state", () => {
    expect(press(["playPause"]).commands).toEqual([{ _tag: "TogglePause" }]);
  });
});

describe("timeline", () => {
  const timeline = press(["select", "up"]).state;

  it("scrubs a preview while held and seeks once on release", () => {
    const held = press(["right", "right", "right"], timeline, 50);
    expect(held.commands).toEqual([]);
    expect(held.state.scrub).toBe(30);
    const released = reduceKey(held.state, "right", "up", 200);
    expect(released.command).toEqual({ _tag: "SeekBy", seconds: 30 });
    expect(released.state.scrub).toBe(0);
  });

  it("accelerates from 10 s to 30 s, 2 min and 5 min while held", () => {
    const keys = Array.from({ length: 40 }, () => "left" as const);
    const { state } = press(keys, timeline, 50);
    // 6 x 10 s + 10 x 30 s + 14 x 120 s + 10 x 300 s
    expect(state.scrub).toBe(-(60 + 300 + 1680 + 3000));
  });

  it("commits the scrub with OK, and OK without a scrub toggles pause", () => {
    const scrubbed = press(["left"], timeline).state;
    expect(reduceKey(scrubbed, "select", "down", 500).command).toEqual({
      _tag: "SeekBy",
      seconds: -10,
    });
    expect(reduceKey(timeline, "select", "down", 500).command).toEqual({ _tag: "TogglePause" });
  });

  it("does not hide in the middle of a scrub", () => {
    const scrubbed = press(["left"], timeline).state;
    expect(tickControls(scrubbed, 60_000).mode).toBe("timeline");
  });

  it("goes back down to the controls row", () => {
    expect(press(["down"], timeline).state.mode).toBe("controls");
  });
});

describe("playerKeyFor", () => {
  it("maps remote events and treats menu as back", () => {
    expect(playerKeyFor("left")).toBe("left");
    expect(playerKeyFor("menu")).toBe("back");
    expect(playerKeyFor("focus")).toBeUndefined();
  });
});

describe("touch (phone)", () => {
  it("opens with the controls up, and a tap hides and shows them", () => {
    const shown = shownControls(0);
    expect(shown.mode).toBe("controls");
    expect(tapPicture(shown, 100).mode).toBe("hidden");
    expect(tapPicture(tapPicture(shown, 100), 200).mode).toBe("controls");
  });

  it("hides by itself while playing, never while held (paused)", () => {
    const shown = shownControls(0);
    expect(tickControls(shown, AUTO_HIDE_MS, true).mode).toBe("controls");
    expect(tickControls(shown, AUTO_HIDE_MS).mode).toBe("hidden");
  });

  it("stays up longer after a touch on the controls, and keeps hidden ones hidden", () => {
    const touched = keepControls(shownControls(0), 3000);
    expect(tickControls(touched, AUTO_HIDE_MS).mode).toBe("controls");
    expect(keepControls(initialControls, 0).mode).toBe("hidden");
  });

  it("clears the controls for a hold, and leaves hidden ones as they are", () => {
    expect(hideControls(shownControls(0)).mode).toBe("hidden");
    expect(hideControls(initialControls)).toBe(initialControls);
  });

  it("skips from the outer two fifths of the picture only", () => {
    expect(tapSide(100, 1000)).toBe(-1);
    expect(tapSide(900, 1000)).toBe(1);
    expect(tapSide(500, 1000)).toBeUndefined();
  });

  it("adds up a run of taps on one side, and starts over on the other side or after a pause", () => {
    const first = addSkip(undefined, -1, 0);
    expect(first.seconds).toBe(10);
    expect(addSkip(first, -1, 500).seconds).toBe(20);
    expect(addSkip(first, 1, 500)).toMatchObject({ direction: 1, seconds: 10 });
    expect(addSkip(first, -1, SKIP_RUN_MS + 1).seconds).toBe(10);
  });
});
