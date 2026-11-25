import { describe, expect, it } from "vitest";
import { repeatKind } from "../src/repeats.ts";

describe("repeatKind", () => {
  it("reads a copy as recorded, scheduled or deleted", () => {
    expect(repeatKind({ state: "completed" })).toBe("recorded");
    expect(repeatKind({ state: "incomplete" })).toBe("recorded");
    expect(repeatKind({ state: "recording" })).toBe("recorded");
    expect(repeatKind({ state: "scheduled" })).toBe("scheduled");
    expect(repeatKind({ state: "history" })).toBe("deleted");
  });
});
