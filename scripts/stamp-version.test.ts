import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildVersion } from "./stamp-version.ts";

const json = (path: string): unknown =>
  JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8"));

describe("product version", () => {
  it("is the same for the server and the Android app", () => {
    const server = json("../apps/server/package.json") as { version: string };
    const app = json("../apps/app/app.json") as { expo: { version: string } };
    expect(app.expo.version).toBe(server.version);
  });
});

describe("buildVersion", () => {
  it("uses a release tag's version as it is", () => {
    expect(buildVersion("0.1.0", "0.1.0", "1a2b3c4d5e")).toBe("0.1.0");
    expect(buildVersion("0.1.0", "0.2.0-rc.1", "1a2b3c4d5e")).toBe("0.2.0-rc.1");
  });

  it("marks other builds as the checked-in version plus label and commit", () => {
    expect(buildVersion("0.1.0", "edge", "1a2b3c4d5e")).toBe("0.1.0-edge+1a2b3c4");
    expect(buildVersion("0.1.0", "pr-12", "")).toBe("0.1.0-pr-12");
    expect(buildVersion("0.1.0", "feature/x", "abc")).toBe("0.1.0-feature-x+abc");
  });

  it("keeps the checked-in version without a build version", () => {
    expect(buildVersion("0.1.0", "")).toBe("0.1.0");
  });
});
