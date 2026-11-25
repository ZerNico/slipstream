import { describe, expect, it } from "vitest";
import { editSeriesHref, hrefPath, newSeriesHref, phoneLink } from "./routes.ts";

describe("phoneLink", () => {
  it("puts a route path behind the app's scheme", () => {
    expect(phoneLink("/settings/sources")).toBe("slipstream://settings/sources");
    expect(phoneLink(newSeriesHref)).toBe("slipstream://recordings/series/new");
  });

  it("links a series recording's editor, its id escaped", () => {
    expect(phoneLink(editSeriesHref("r1"))).toBe("slipstream://recordings/series/r1/edit");
    expect(hrefPath(editSeriesHref("a/b"))).toBe("/recordings/series/a%2Fb/edit");
  });
});
