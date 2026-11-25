import { Conflict, Forbidden, RateLimited, SourceFailed } from "@slipstream/api";
import { m, sourceFailureReasonText } from "@slipstream/i18n";
import { describe, expect, it } from "vitest";
import { failureOf, readProblem, sourceProblem } from "./failure.ts";

describe("failureOf", () => {
  it("reads the tag, the conflict code and the wait", () => {
    expect(failureOf(new Conflict({ code: "lastAdmin" }))).toMatchObject({
      tag: "Conflict",
      code: "lastAdmin",
    });
    expect(failureOf(new RateLimited({ retryAfterSeconds: 30 })).retryAfterSeconds).toBe(30);
  });

  it("reads a request that never reached the server as Offline", () => {
    const error = { _tag: "HttpClientError", reason: { _tag: "TransportError" } };
    expect(failureOf(error).tag).toBe("Offline");
    expect(readProblem(error)).toBe(m.error_offline());
  });

  it("reads anything else as nothing in particular", () => {
    expect(failureOf(new Error("boom")).tag).toBe("");
    expect(failureOf(undefined).tag).toBe("");
    expect(readProblem(undefined)).toBe(m.error_unexpected());
  });
});

describe("sourceProblem", () => {
  it("names the source's own failure, else reads it as any other", () => {
    const failed = new SourceFailed({ reason: "unreachable" });
    expect(sourceProblem(failed)).toBe(sourceFailureReasonText(failed));
    expect(sourceProblem(new Forbidden())).toBe(m.state_forbidden());
  });
});
