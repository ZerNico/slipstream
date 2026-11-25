import { describe, expect, it } from "vitest";
import { UserId } from "@slipstream/domain";
import {
  approveAs,
  approveHousehold,
  approveProblem,
  blockSignIn,
  formatUserCode,
  normaliseUserCode,
} from "./groups/auth.ts";

describe("user codes", () => {
  it("accepts codes typed with spaces, dots, dashes or lower case", () => {
    expect(normaliseUserCode(" qk7·4rm ")).toBe("QK74RM");
    expect(normaliseUserCode("QK7-4RM")).toBe("QK74RM");
  });

  it("shows codes split in the middle like the TV does, short ones whole", () => {
    expect(formatUserCode("QK74RM")).toBe("QK7·4RM");
    expect(formatUserCode("qk74r")).toBe("QK7·4R");
    expect(formatUserCode("QK7-4RM")).toBe("QK7·4RM");
    expect(formatUserCode("ABCD")).toBe("ABCD");
    expect(formatUserCode("AB")).toBe("AB");
  });
});

describe("approving a TV", () => {
  const alex = { id: UserId.make("alex"), role: "admin" } as const;
  const kim = { id: UserId.make("kim"), role: "user" } as const;

  it("sends userId only for someone else", () => {
    expect(approveAs("QK74RM", alex.id, alex)).toEqual({ userCode: "QK74RM", approve: true });
    expect(approveAs("QK74RM", kim.id, alex)).toEqual({
      userCode: "QK74RM",
      approve: true,
      userId: kim.id,
    });
    expect(blockSignIn("QK74RM")).toEqual({ userCode: "QK74RM", approve: false });
  });

  it("starts a household TV on a non-admin profile", () => {
    expect(approveHousehold("QK74RM", [alex, kim], alex)).toEqual({
      userCode: "QK74RM",
      approve: true,
      household: true,
      userId: kim.id,
    });
  });

  it("reads an unknown or answered code as get a new one", () => {
    expect(approveProblem({ _tag: "NotFound" })).toBe("invalidCode");
    expect(approveProblem({ _tag: "DeviceCodeNotReady" })).toBe("invalidCode");
    expect(approveProblem({ _tag: "Forbidden" })).toBe("forbidden");
    expect(approveProblem(new Error("x"))).toBe("failed");
  });
});
