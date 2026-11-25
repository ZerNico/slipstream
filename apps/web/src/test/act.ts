import { act } from "react";

declare global {
  // React reads this to know `act` is in charge of flushing updates.
  // oxlint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

/** Tells React that tests drive it through `act`; call before the first render. */
export const actEnvironment = (): void => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
};

/** Clicks an element inside `act`; fails the test when there is nothing to click. */
export const clickIn = async (element: Element | null | undefined): Promise<void> => {
  if (!(element instanceof HTMLElement)) throw new Error("nothing to click");
  await act(async () => {
    element.click();
  });
};
