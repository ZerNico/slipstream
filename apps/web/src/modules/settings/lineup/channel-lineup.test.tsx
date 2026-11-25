// @vitest-environment happy-dom
import { act } from "react";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { mountWithMock } from "../test-support.tsx";
import { ChannelLineup } from "./channel-lineup.tsx";

// happy-dom lays nothing out; the windowed list needs a height to draw rows into.
const height = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientHeight");
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, "clientHeight", {
    configurable: true,
    get: () => 600,
  });
});
afterAll(() => {
  if (height !== undefined) Object.defineProperty(HTMLElement.prototype, "clientHeight", height);
});

let cleanup: (() => Promise<void>) | undefined;
afterEach(async () => {
  await cleanup?.();
  cleanup = undefined;
  document.body.innerHTML = "";
});

const byLabel = (label: string) =>
  document.querySelector<HTMLInputElement>(`[aria-label="${CSS.escape(label)}"]`);

const button = (name: string) =>
  [...document.querySelectorAll<HTMLElement>("button, [role=button], [role=menuitem]")].find(
    (element) =>
      element.getAttribute("aria-label") === name || element.textContent?.trim() === name,
  );

/** Types into an input as a person would: the value, then an input event. */
const typeInto = (input: HTMLInputElement | null, value: string) => {
  if (input === null) throw new Error("no input");
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
};

const press = (element: HTMLElement | null, key: string) =>
  act(async () => {
    element?.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
    await Promise.resolve();
  });

const setup = async () => {
  const view = await mountWithMock(<ChannelLineup />);
  cleanup = view.cleanup;
  await view.waitFor(() => expect(byLabel("Number of ZDF")).not.toBeNull());
  return view;
};

describe("the channel lineup", () => {
  it("says what typing a number does, and moves only the holder", async () => {
    const view = await setup();
    const number = byLabel("Number of Eurosport 1");
    await act(async () => {
      number?.focus();
      await Promise.resolve();
    });
    typeInto(number, "4");
    await view.waitFor(() => expect(view.text()).toContain("Move to 4 · ZDF moves to 6"));
    await press(number, "Enter");
    await view.waitFor(() => {
      const numbers = new Map(view.server.data.channels.map((c) => [c.name, c.number]));
      expect(numbers.get("Eurosport 1")).toBe(4);
      expect(numbers.get("ZDF")).toBe(6);
      expect(numbers.get("arte")).toBe(5);
    });
  });

  it("hides several channels from the bulk bar", async () => {
    const view = await setup();
    await view.click(byLabel("Select ZDF"));
    await view.click(byLabel("Select arte"));
    await view.waitFor(() => expect(view.text()).toContain("2 selected"));
    await view.click(button("Hide"));
    await view.waitFor(() => {
      const hidden = view.server.data.channels.filter((c) => c.hidden).map((c) => c.name);
      expect(hidden).toEqual(expect.arrayContaining(["ZDF", "arte"]));
    });
  });

  it("opens a channel with its streams in fallback order", async () => {
    const view = await setup();
    await view.click(document.querySelector('[data-channel="das-erste"]'));
    await view.waitFor(() => expect(view.text()).toContain("DE: Das Erste SD"));
    const streams = byLabel("Streams");
    const names = [...(streams?.querySelectorAll("li") ?? [])].map((li) => li.textContent ?? "");
    expect(names[0]).toContain("Das Erste");
    expect(names[1]).toContain("Backup IPTV");
  });

  it("warns that removing cancels one-off recordings still scheduled on the channel", async () => {
    const view = await setup();
    await view.click(byLabel("Select Sky Sport F1"));
    await view.click(button("Remove"));
    await view.waitFor(() =>
      expect(view.text()).toContain("1 scheduled recording on it will be cancelled"),
    );
  });
});
