// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { mount } from "~/test/dom.tsx";
import { type AttentionCard, AttentionSection } from "./attention-section.tsx";
import type { IssueText } from "./shape.ts";

const card = (key: string, tone: IssueText["tone"]): AttentionCard => ({
  key,
  text: { tone, glyph: tone === "ok" ? "check" : "warning", title: key, text: "", actions: [] },
  onDismiss: () => undefined,
});

let unmount: (() => Promise<void>) | undefined;

afterEach(async () => {
  await unmount?.();
  unmount = undefined;
});

const render = async (cards: readonly AttentionCard[]) => {
  const view = await mount(<AttentionSection cards={cards} />);
  unmount = view.unmount;
  return view.host.querySelector("[data-attention-count]");
};

describe("Needs attention", () => {
  it("counts problems only in its badge", async () => {
    const badge = await render([card("a", "err"), card("b", "warn"), card("d", "ok")]);
    expect(badge?.textContent).toBe("2");
  });

  it("hides the badge when only good news is left", async () => {
    const badge = await render([card("c", "ok"), card("d", "ok")]);
    expect(badge).toBeNull();
  });
});
