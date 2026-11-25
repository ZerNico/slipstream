// @vitest-environment happy-dom
import { ChannelId } from "@slipstream/domain";
import { act } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { keys } from "~/api/queries.ts";
import { mountWithMock } from "../test-support.tsx";
import { mergeOf, reviewCards } from "./model.ts";
import { NeedsReview } from "./needs-review.tsx";

let cleanup: (() => Promise<void>) | undefined;
afterEach(async () => {
  await cleanup?.();
  cleanup = undefined;
  document.body.innerHTML = "";
});

const button = (name: string) =>
  [...document.querySelectorAll<HTMLElement>("button")].find(
    (element) =>
      element.getAttribute("aria-label") === name || element.textContent?.trim() === name,
  );

const click = (element: HTMLElement | undefined) =>
  act(async () => {
    if (element === undefined) throw new Error("nothing to click");
    element.click();
    await Promise.resolve();
  });

const summary = {
  merge: 0,
  mergeSources: 0,
  newStreams: 0,
  newSources: [],
  goneStreams: 0,
  goneSources: [],
  withoutStreams: 0,
};

const candidate = (id: ChannelId | undefined) => ({
  id: id ?? ChannelId.make("x"),
  name: "",
  streams: [],
});

describe("needs review's model", () => {
  it("shows a card only for what is left", () => {
    expect(reviewCards(summary)).toEqual([]);
    expect(reviewCards({ ...summary, merge: 2, withoutStreams: 1 })).toEqual(["merge", "gone"]);
    expect(reviewCards({ ...summary, newStreams: 14, goneStreams: 3 })).toEqual(["new", "gone"]);
  });

  it("keeps the first channel of a suggestion", () => {
    const [a, b, c] = ["a", "b", "c"].map((id) => ChannelId.make(id));
    expect(
      mergeOf({ channels: [candidate(a), candidate(b), candidate(c)], reason: "sameGuide" }),
    ).toEqual({ keepId: a, otherIds: [b, c] });
    expect(mergeOf({ channels: [], reason: "similarName" })).toBeUndefined();
  });
});

describe("needs review", () => {
  it("is not there while nothing waits", async () => {
    const view = await mountWithMock(<NeedsReview />);
    cleanup = view.cleanup;
    await view.waitFor(() =>
      expect(view.client.getQueryData(keys.lineupReview)).not.toBeUndefined(),
    );
    expect(view.text()).not.toContain("Needs review");
  });

  it("merges a copy from its card's review, then goes away", async () => {
    const view = await mountWithMock(<NeedsReview />);
    cleanup = view.cleanup;
    await view.waitFor(() =>
      expect(view.client.getQueryData(keys.lineupReview)).not.toBeUndefined(),
    );
    await act(async () => {
      view.server.data.channels = [
        ...view.server.data.channels,
        {
          id: ChannelId.make("zdf-copy"),
          name: "ZDF HD",
          number: 99,
          favourite: false,
          hidden: false,
        },
      ];
      await view.client.invalidateQueries({ queryKey: keys.lineupReview });
    });
    await view.waitFor(() => expect(view.text()).toContain("Needs review"));
    expect(view.text()).toContain("1 channel in both sources");
    // The copy has no stream: the only red card.
    expect(view.text()).toContain("1 channel has no stream");

    // The merge card's Review opens the suggestions.
    await click(
      [...document.querySelectorAll<HTMLElement>("article")]
        .find((card) => card.textContent?.includes("in both sources"))
        ?.querySelector("button") ?? undefined,
    );

    await view.waitFor(() => expect(button("Merge into ZDF")).toBeDefined());
    expect(button("ZDF: not the same")).toBeDefined();
    await click(button("Merge into ZDF"));
    await view.waitFor(() => expect(view.text()).toContain("Merged"));
    expect(view.server.data.channels.some((channel) => channel.id === "zdf-copy")).toBe(false);
    await click(button("Done"));
    await view.waitFor(() => expect(view.text()).not.toContain("Needs review"));
  });
});
