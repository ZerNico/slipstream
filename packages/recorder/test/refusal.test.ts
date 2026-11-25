import { describe, expect, it } from "vitest";
import { classifyEmptyRun, httpStatusIn } from "../src/refusal.ts";

const run = (lastError: string | null, lastedMs = 30) => ({
  startedAtMs: 1000,
  endedAtMs: 1000 + lastedMs,
  lastError,
});

describe("refusal detection", () => {
  // Lines as ffmpeg 9 prints them against the fake source's refusals.
  it("reads the status from ffmpeg's warning or error line", () => {
    expect(httpStatusIn("HTTP error 509 Bandwidth Limit Exceeded")).toBe(509);
    expect(httpStatusIn("Error opening input: Server returned 403 Forbidden (access denied)")).toBe(
      403,
    );
    expect(httpStatusIn("Server returned 5XX Server Error reply")).toBeUndefined();
  });

  it("treats 403, 429 and 509 as the provider's limit", () => {
    for (const status of [403, 429, 509]) {
      expect(classifyEmptyRun(run("Server returned 5XX Server Error reply"), status)).toEqual({
        _tag: "Refused",
        httpStatus: status,
      });
    }
    expect(
      classifyEmptyRun(
        run("Error opening input files: Server returned 429 Too Many Requests"),
        undefined,
      ),
    ).toEqual({ _tag: "Refused", httpStatus: 429 });
  });

  it("treats an immediate end of stream as a refusal, a slow one as a failure", () => {
    const empty = "Error opening input files: Invalid data found when processing input";
    expect(classifyEmptyRun(run(empty), undefined)).toEqual({
      _tag: "Refused",
      httpStatus: undefined,
    });
    expect(classifyEmptyRun(run(empty, 20_000), undefined)).toEqual({ _tag: "Unreachable" });
  });

  it("treats other errors as unreachable", () => {
    expect(
      classifyEmptyRun(run("Error opening input files: Connection refused"), undefined),
    ).toEqual({ _tag: "Unreachable" });
    expect(classifyEmptyRun(run("Server returned 404 Not Found"), 404)).toEqual({
      _tag: "Unreachable",
    });
    expect(classifyEmptyRun(run(null), undefined)).toEqual({ _tag: "Unreachable" });
  });
});
