import { afterEach, describe, expect, it } from "vitest";
import { deliveryText } from "./delivery-text.ts";
import { setLocale } from "./runtime.ts";

afterEach(() => setLocale("en"));

describe("deliveryText", () => {
  it("says Direct when the stream plays as it is", () => {
    expect(deliveryText({ decision: "direct" })).toBe("Direct");
  });

  it("says how the stream is changed, with the encoder when the picture is converted", () => {
    expect(deliveryText({ decision: "remux" })).toBe("Repackaged, picture and sound untouched");
    expect(deliveryText({ decision: "audio" })).toBe("Sound converted");
    expect(deliveryText({ decision: "video", encoder: "nvenc" })).toBe("Converted · NVENC");
  });

  it("follows the language in effect", () => {
    setLocale("de");
    expect(deliveryText({ decision: "direct" })).toBe("Direkt");
  });
});
