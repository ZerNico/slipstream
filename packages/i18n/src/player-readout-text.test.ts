import { afterEach, describe, expect, it } from "vitest";
import { playerReadout, readoutLine } from "./player-readout-text.ts";
import { setLocale, setRegion, setTimeZone } from "./runtime.ts";

afterEach(() => {
  setLocale("en");
  setRegion(undefined);
  setTimeZone(undefined);
});

const MIN = 60_000;
/** 17:00 in UTC. */
const five = Date.UTC(2026, 10, 22, 17, 0);

describe("player read-out", () => {
  it("says what is left of a finished recording and when it ends", () => {
    setTimeZone("UTC");
    setRegion("DE");
    const readout = playerReadout({
      mode: "finished",
      leftMs: 58 * MIN + 5000,
      speed: 1,
      endsAt: five + 26 * MIN,
      missingMs: 15 * MIN,
    });
    expect(readout.kind).toBe("left");
    expect(readout.delta).toBe("58:05");
    expect(readout.label).toBe("left");
    expect(readoutLine(readout)).toBe("ends 17:26 · contains a 15 min gap");
  });

  it("leaves the gap out when nothing is missing, and rounds a short one up to a minute", () => {
    setTimeZone("UTC");
    setRegion("DE");
    const whole = playerReadout({ mode: "finished", leftMs: 0, speed: 1, endsAt: five });
    expect(readoutLine(whole)).toBe("ends 17:00");
    const short = playerReadout({
      mode: "finished",
      leftMs: 0,
      speed: 1,
      endsAt: five,
      missingMs: 10_000,
    });
    expect(readoutLine(short)).toBe("ends 17:00 · contains a 1 min gap");
  });

  it("says how far behind live, where the playhead is and when faster reaches live", () => {
    setTimeZone("UTC");
    setRegion("DE");
    const readout = playerReadout({
      mode: "running",
      atLive: false,
      behindMs: 31 * MIN + 30_000,
      position: five,
      speed: 1.5,
      liveAt: five + 63 * MIN,
    });
    expect(readout.kind).toBe("behind");
    expect(readout.delta).toBe("−31:30");
    expect(readout.label).toBe("behind live");
    expect(readout.sub[0]?.[1]).toEqual({ text: "17:00", strong: true });
    expect(readout.sub[1]?.[0]?.speed).toBe(true);
    // Region DE writes the speed with a decimal comma.
    expect(readoutLine(readout)).toBe("playing 17:00 · 1,5× · live at 18:03");
  });

  it("is only the LIVE pill at live", () => {
    expect(
      playerReadout({ mode: "running", atLive: true, behindMs: 0, position: five, speed: 1 }),
    ).toEqual({ kind: "live", delta: "", label: "", sub: [] });
  });

  it("follows the language in effect", () => {
    setLocale("de");
    setTimeZone("UTC");
    setRegion("DE");
    const readout = playerReadout({ mode: "finished", leftMs: MIN, speed: 1, endsAt: five });
    expect(readout.label).toBe("übrig");
    expect(readoutLine(readout)).toBe("endet 17:00");
  });
});
