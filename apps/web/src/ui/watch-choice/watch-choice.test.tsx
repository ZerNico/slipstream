// @vitest-environment happy-dom
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLocale, setRegion } from "@slipstream/i18n";
import { mount } from "~/test/dom.tsx";
import type { ChoiceInput, ChoiceOption } from "@slipstream/domain";
import { WatchChoice } from "./watch-choice.tsx";

const clock = (hours: number, minutes: number) => new Date(2026, 10, 22, hours, minutes).getTime();

const running: ChoiceInput = {
  windowStart: clock(17, 55),
  windowEnd: clock(20, 30),
  live: true,
  now: clock(18, 42),
  resumeAt: clock(18, 11),
};

function Harness({
  input,
  onPick,
}: {
  input: ChoiceInput;
  onPick: (option: ChoiceOption) => void;
}) {
  const [open, setOpen] = useState(true);
  return (
    <WatchChoice
      open={open}
      onOpenChange={setOpen}
      title="Live F1: Qualifying - GP Katar"
      subtitle="Sky Sport F1 · started 47 min ago"
      artwork={{ title: "Live F1: Qualifying - GP Katar" }}
      input={input}
      timeline={{
        start: input.windowStart,
        end: input.windowEnd,
        captured: { start: input.windowStart, end: input.now },
      }}
      onPick={(option) => {
        onPick(option);
        setOpen(false);
      }}
    />
  );
}

let teardown: (() => Promise<void>) | undefined;
beforeEach(() => {
  setLocale("en");
  setRegion("GB");
  // Wide enough for the centred dialog (the bottom sheet is for under 600 px).
  window.innerWidth = 1024;
});
afterEach(async () => {
  await teardown?.();
  teardown = undefined;
  setLocale("en");
  setRegion(undefined);
});

const options = () => [...document.querySelectorAll<HTMLButtonElement>(".choice-option")];

describe("WatchChoice (SPEC §7.6)", () => {
  it("names each way in, in the wall-clock notation of a running recording", async () => {
    const mounted = await mount(<Harness input={running} onPick={() => undefined} />);
    teardown = mounted.unmount;
    await mounted.settle(100);
    expect(
      options().map((option) => option.querySelector(".choice-option-label")?.textContent),
    ).toEqual(["Resume at 18:11", "Watch from start", "Watch live"]);
    const minus = String.fromCodePoint(0x2212);
    expect(options()[0]?.querySelector(".choice-option-detail")?.textContent).toBe(
      `Where you stopped · ${minus}31:00 behind live`,
    );
    expect(options()[1]?.querySelector(".choice-option-detail")?.textContent).toBe(
      `From 17:55 · ${minus}47:00 behind live`,
    );
    expect(options()[0]?.hasAttribute("data-primary")).toBe(true);
  });

  it("uses position-of-length for a finished recording", async () => {
    const finished: ChoiceInput = {
      ...running,
      live: false,
      now: clock(22, 0),
      resumeAt: clock(17, 55) + 46.5 * 60_000,
    };
    const mounted = await mount(<Harness input={finished} onPick={() => undefined} />);
    teardown = mounted.unmount;
    await mounted.settle(100);
    expect(
      options().map((option) => option.querySelector(".choice-option-label")?.textContent),
    ).toEqual(["Resume from 46:30", "Play from the beginning"]);
  });

  it("moves with the arrow keys and picks with Enter", async () => {
    const onPick = vi.fn<(option: ChoiceOption) => void>();
    const mounted = await mount(<Harness input={running} onPick={onPick} />);
    teardown = mounted.unmount;
    await mounted.settle(100);
    options()[0]?.focus();
    await mounted.key("ArrowDown");
    expect(document.activeElement).toBe(options()[1]);
    await mounted.key("ArrowUp");
    await mounted.key("ArrowUp");
    expect(document.activeElement).toBe(options()[2]);
    await mounted.click(options()[0]);
    expect(onPick).toHaveBeenCalledWith({ kind: "resume", at: clock(18, 11) });
  });
});
