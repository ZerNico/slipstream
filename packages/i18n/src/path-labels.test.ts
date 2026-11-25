import { afterEach, describe, expect, it } from "vitest";
import { pathLabels } from "./path-labels.ts";
import { setLocale } from "./runtime.ts";

afterEach(() => {
  setLocale("en");
});

describe("pathLabels", () => {
  it("names path parts in the language in effect when called", () => {
    expect(pathLabels().season(2)).toBe("Season 2");
    setLocale("de");
    const labels = pathLabels();
    expect([labels.other, labels.season(2)]).toEqual(["Sonstiges", "Staffel 2"]);
  });

  it("phrases an airing from any instant with epoch milliseconds", () => {
    const airing = pathLabels().airing({ epochMilliseconds: Date.UTC(2026, 10, 22, 19, 15) });
    expect(airing).toMatch(/\d/u);
  });
});
