import { afterEach, describe, expect, it } from "vitest";
import { pictureConversionsLabel } from "./picture-conversions-text.ts";
import { setLocale } from "./runtime.ts";

afterEach(() => setLocale("en"));

describe("picture conversion labels", () => {
  it("names every choice: no limit, automatic, then the numbers", () => {
    expect(pictureConversionsLabel("unlimited")).toBe("No limit");
    expect(pictureConversionsLabel("auto")).toBe("Automatic");
    expect(pictureConversionsLabel("1")).toBe("1");
    expect(pictureConversionsLabel("10")).toBe("10");
  });

  it("follows the language in effect", () => {
    setLocale("de");
    expect(pictureConversionsLabel("unlimited")).toBe("Unbegrenzt");
    expect(pictureConversionsLabel("auto")).toBe("Automatisch");
    expect(pictureConversionsLabel("10")).toBe("10");
  });
});
