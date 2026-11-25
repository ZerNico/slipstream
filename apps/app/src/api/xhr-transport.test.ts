import { describe, expect, it } from "vitest";
import { growingText } from "./xhr-transport.ts";

describe("growingText", () => {
  it("hands on only the part of the text not seen before", () => {
    const read = growingText(100);
    expect(read("data: a\n")).toEqual({ chunk: "data: a\n", spent: false });
    expect(read("data: a\n")).toEqual({ chunk: undefined, spent: false });
    expect(read("data: a\n\ndata: b")).toEqual({ chunk: "\ndata: b", spent: false });
  });

  it("says the budget is spent once that much has arrived in all", () => {
    const read = growingText(10);
    expect(read("12345").spent).toBe(false);
    expect(read("1234567890")).toEqual({ chunk: "67890", spent: true });
  });
});
