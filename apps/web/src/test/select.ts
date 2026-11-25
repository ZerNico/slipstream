import { act } from "react";

/*
 * Driving the app's select (`ui/primitives/select.tsx`, Base UI) in jsdom: the trigger is a
 * `combobox` button that shows the picked label; the options exist only while it is open.
 */

/** The select named `label` (its aria-label) or with the id `#id`. */
export const selectTrigger = (root: ParentNode, name: string): HTMLButtonElement | null =>
  name.startsWith("#")
    ? root.querySelector<HTMLButtonElement>(`button${name}`)
    : root.querySelector<HTMLButtonElement>(`button[role="combobox"][aria-label="${name}"]`);

/** What the select shows: the picked option's label, or its placeholder. */
export const selectedText = (trigger: HTMLElement | null): string | undefined =>
  trigger?.textContent === undefined || trigger.textContent === null
    ? undefined
    : plain(trigger.textContent);

/** Text with every run of spaces (no-break ones too) as one plain space. */
const plain = (text: string): string => text.replaceAll(/\s+/gu, " ").trim();

const press = async (element: Element) => {
  await act(async () => {
    for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) {
      const init = { bubbles: true, cancelable: true, button: 0 };
      element.dispatchEvent(
        type.startsWith("pointer")
          ? new PointerEvent(type, { ...init, pointerType: "mouse" })
          : new MouseEvent(type, init),
      );
    }
  });
};

const openOptions = async (trigger: HTMLElement): Promise<HTMLElement[]> => {
  if (trigger.getAttribute("aria-expanded") !== "true") await press(trigger);
  for (let tries = 0; tries < 50; tries += 1) {
    const options = [...document.querySelectorAll<HTMLElement>('[role="option"]')];
    if (options.length > 0) return options;
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
  }
  throw new Error("the select did not open");
};

/** Opens the select and reads its options' labels, then closes it again. */
export const optionLabels = async (trigger: HTMLElement | null): Promise<string[]> => {
  if (!trigger) throw new Error("no select");
  const labels = (await openOptions(trigger)).map((option) => plain(option.textContent ?? ""));
  await act(async () => {
    trigger.ownerDocument.activeElement?.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
  });
  return labels;
};

/** Opens the select and picks the option whose label is `label`. */
export const pickOption = async (trigger: HTMLElement | null, label: string): Promise<void> => {
  if (!trigger) throw new Error("no select");
  const option = (await openOptions(trigger)).find(
    (candidate) => plain(candidate.textContent ?? "") === plain(label),
  );
  if (!option) {
    throw new Error(
      `no option "${label}" in ${JSON.stringify(
        [...document.querySelectorAll('[role="option"]')].map((o) => o.textContent),
      )}`,
    );
  }
  await press(option);
};
