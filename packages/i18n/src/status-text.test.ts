import { afterEach, describe, expect, it } from "vitest";
import { setLocale } from "./runtime.ts";
import { streamLimitText, transcodeReasonText } from "./status-text.ts";

afterEach(() => setLocale("en"));

describe("streamLimitText", () => {
  it("gives a title and a hint for each reason", () => {
    expect(streamLimitText("sourceFull")).toEqual({
      title: "No free stream for watching",
      body: "Every stream the source allows is in use. Try again when one is free.",
    });
    expect(streamLimitText("profileLimit").title).toBe("Your profile's streams are all in use");
  });

  it("follows the language in effect", () => {
    setLocale("de");
    expect(streamLimitText("sourceFull").title).toBe("Kein Stream zum Schauen frei");
  });
});

describe("transcodeReasonText", () => {
  it("completes the converted sentence with one reason or a list", () => {
    expect(transcodeReasonText("interlaced")).toBe("Converted because: the picture is interlaced");
    expect(transcodeReasonText(["interlaced", "catchUpPassthrough"])).toBe(
      "Converted because: the picture is interlaced and surround sound can't be sped up",
    );
  });
});
