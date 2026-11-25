import { afterEach, describe, expect, it } from "vitest";
import { keepBufferLabel, keepRunningLabel } from "./live-keep-text.ts";
import { setLocale } from "./runtime.ts";

afterEach(() => setLocale("en"));

describe("live keep labels", () => {
  it("names minutes, hours and the programme's end", () => {
    expect(keepRunningLabel(10)).toBe("10 min");
    expect(keepRunningLabel(60)).toBe("1 h");
    expect(keepRunningLabel("programmeEnd")).toBe("Until the programme ends");
  });

  it("says when the buffer is not kept", () => {
    expect(keepBufferLabel(0)).toBe("Don’t keep");
    expect(keepBufferLabel(24 * 60)).toBe("24 h");
  });

  it("follows the language in effect", () => {
    setLocale("de");
    expect(keepRunningLabel("programmeEnd")).toBe("Bis die Sendung endet");
    expect(keepBufferLabel(0)).toBe("Nicht behalten");
  });
});
