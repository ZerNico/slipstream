// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLocale, setRegion } from "@slipstream/i18n";
import { mount } from "~/test/dom.tsx";
import type { TimelineData } from "./geometry.ts";
import { Timeline } from "./timeline.tsx";

/** Local wall-clock times, so labels read the same in every time zone. */
const clock = (hours: number, minutes: number) => new Date(2026, 10, 22, hours, minutes).getTime();

/** Qualifying: window 17:55 to 20:30, live 18:42, you at 18:11 (31:30 behind). */
const qualifying: TimelineData = {
  start: clock(17, 55),
  end: clock(20, 30),
  captured: { start: clock(17, 55), end: clock(18, 42) },
  marks: [clock(18, 0), clock(19, 30)],
  playhead: clock(18, 11) - 30_000,
  live: clock(18, 42),
  bands: [
    { start: clock(17, 55), end: clock(18, 0), title: "Vorberichte" },
    { start: clock(18, 0), end: clock(19, 30), title: "Qualifying" },
  ],
};

let teardown: (() => Promise<void>) | undefined;
beforeEach(() => {
  setLocale("en");
  setRegion("GB");
});
afterEach(async () => {
  await teardown?.();
  teardown = undefined;
  setLocale("en");
  setRegion(undefined);
});

const render = async (element: React.ReactElement) => {
  const mounted = await mount(element);
  teardown = mounted.unmount;
  return mounted;
};

describe("Timeline", () => {
  it("draws every layer and labels the live edge, your time and the window", async () => {
    const { host } = await render(<Timeline data={qualifying} />);
    for (const part of [
      "tl-aired",
      "tl-upcoming",
      "tl-captured",
      "tl-played",
      "tl-behind",
      "tl-edge",
      "tl-knob",
    ]) {
      expect({ part, drawn: host.querySelector(`.${part}`) !== null }).toEqual({
        part,
        drawn: true,
      });
    }
    expect(host.querySelector(".tl-label-live")?.textContent).toBe("LIVE 18:42");
    expect(host.querySelector(".tl-label-here")?.textContent).toBe("18:10");
    expect(
      [...host.querySelectorAll(".tl-label-bottom")].map((label) => label.textContent),
    ).toEqual(["17:55", "20:30"]);
    expect(host.querySelectorAll(".tl-band")).toHaveLength(2);
    expect(host.querySelector(".tl-band[data-current]")?.textContent).toBe("Qualifying");
  });

  it("hides your time by visibility when it crowds the live label, keeping its row", async () => {
    const { host } = await render(<Timeline data={{ ...qualifying, playhead: clock(18, 40) }} />);
    const here = host.querySelector(".tl-label-here");
    expect(here).not.toBeNull();
    expect(here?.hasAttribute("data-hidden")).toBe(true);
  });

  it("shows no knob and no behind band for a live programme you are not watching", async () => {
    const { playhead: _playhead, ...notWatching } = qualifying;
    const { host } = await render(<Timeline data={notWatching} />);
    expect(host.querySelector(".tl-knob")).toBeNull();
    expect(host.querySelector(".tl-behind")).toBeNull();
    expect(host.querySelector(".tl-edge")).not.toBeNull();
  });

  it("labels a finished recording by position and length", async () => {
    const { live: _live, ...finished } = qualifying;
    const { host } = await render(
      <Timeline
        data={{ ...finished, captured: { start: qualifying.start, end: qualifying.end } }}
        relative
        variant="compact"
      />,
    );
    expect(
      [...host.querySelectorAll(".tl-label-bottom")].map((label) => label.textContent),
    ).toEqual(["0:00", "2:35:00"]);
    expect(host.querySelector(".tl-upcoming")).toBeNull();
  });

  it("is a slider in the player: words for the value, keys that seek", async () => {
    const onSeek = vi.fn<(time: number) => void>();
    const { host, key } = await render(
      <Timeline data={qualifying} onSeek={onSeek} label="Position in Qualifying" />,
    );
    const slider = host.querySelector<HTMLElement>('[role="slider"]');
    expect(slider?.getAttribute("aria-label")).toBe("Position in Qualifying");
    expect(slider?.getAttribute("aria-valuetext")).toBe(
      `18:10, ${String.fromCodePoint(0x2212)}31:30 behind live`,
    );
    slider?.focus();
    await key("ArrowRight");
    expect(onSeek).toHaveBeenLastCalledWith((qualifying.playhead ?? 0) + 10_000);
    await key("ArrowLeft", { shiftKey: true });
    expect(onSeek).toHaveBeenLastCalledWith((qualifying.playhead ?? 0) - 60_000);
    await key("End");
    expect(onSeek).toHaveBeenLastCalledWith(qualifying.live);
  });

  it("says Live at the live edge", async () => {
    const { host } = await render(
      <Timeline data={{ ...qualifying, playhead: clock(18, 42) }} onSeek={() => undefined} />,
    );
    expect(host.querySelector('[role="slider"]')?.getAttribute("aria-valuetext")).toBe(
      "Live, 18:42",
    );
  });

  it("is not focusable outside the player", async () => {
    const { host } = await render(<Timeline data={qualifying} />);
    expect(host.querySelector('[role="slider"]')).toBeNull();
    expect(host.querySelector("[tabindex]")).toBeNull();
  });
});
