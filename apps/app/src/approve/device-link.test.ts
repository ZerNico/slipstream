import { DeviceCodeApproval, deviceLinkUrl, normaliseUserCode } from "@slipstream/api";
import { defaultProfile, UserId } from "@slipstream/domain";
import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import {
  approveAs,
  approveProblem,
  blockSignIn,
  deviceLinkCode,
  profileChoices,
  type Approver,
} from "./device-link.ts";

const alex = { id: UserId.make("u-alex"), displayName: "Alex", role: "admin" } as const;
const household = { id: UserId.make("u-house"), displayName: "Household", role: "user" } as const;
const kim = { id: UserId.make("u-kim"), displayName: "Kim", role: "user" } as const;
const admin: Approver = alex;
const member: Approver = kim;

describe("deviceLinkCode", () => {
  it("reads the code from the URL the server puts in the QR code", () => {
    expect(deviceLinkCode(deviceLinkUrl("https://tv.example.com", "QK74RM"))).toBe("QK74RM");
    expect(deviceLinkCode(deviceLinkUrl("http://192.168.12.11:8080/", "qk7-4rm"))).toBe("QK74RM");
    expect(deviceLinkCode("https://example.com/slipstream/link/?code=QK74RM")).toBe("QK74RM");
  });

  it("reads the app's own scheme in both spellings", () => {
    expect(deviceLinkCode("slipstream://link?code=QK74RM")).toBe("QK74RM");
    expect(deviceLinkCode("slipstream:///link?code=QK7%C2%B74RM")).toBe("QK74RM");
  });

  it("ignores other links and links without a code", () => {
    expect(deviceLinkCode("https://tv.example.com/recordings?code=QK74RM")).toBeUndefined();
    expect(deviceLinkCode("https://tv.example.com/link")).toBeUndefined();
    expect(deviceLinkCode("slipstream://player?code=QK74RM")).toBeUndefined();
    expect(deviceLinkCode("ftp://tv.example.com/link?code=QK74RM")).toBeUndefined();
    expect(deviceLinkCode("not a url")).toBeUndefined();
  });

  it("normalises typed codes like the TV shows them", () => {
    expect(normaliseUserCode(" qk7·4rm ")).toBe("QK74RM");
  });
});

describe("profile choice", () => {
  it("offers admins every household profile, themselves first", () => {
    expect(profileChoices(admin, [household, alex, kim]).map((choice) => choice.id)).toEqual([
      "u-alex",
      "u-house",
      "u-kim",
    ]);
  });

  it("offers everyone else only themselves", () => {
    expect(profileChoices(member, [household, alex, kim])).toEqual([kim]);
    expect(profileChoices(admin, undefined)).toEqual([alex]);
  });

  it("defaults shared TVs to a household profile, not the admin", () => {
    expect(defaultProfile(profileChoices(admin, [alex, household]), admin)).toBe("u-house");
    expect(defaultProfile(profileChoices(admin, [alex]), admin)).toBe("u-alex");
    expect(defaultProfile(profileChoices(member, [household]), member)).toBe("u-kim");
  });
});

describe("answers", () => {
  const encode = Schema.encodeSync(DeviceCodeApproval);

  it("only names the profile when it is someone else", () => {
    expect(encode(approveAs("QK74RM", alex.id, admin))).toEqual({
      userCode: "QK74RM",
      approve: true,
    });
    expect(encode(approveAs("QK74RM", household.id, admin))).toEqual({
      userCode: "QK74RM",
      approve: true,
      userId: "u-house",
    });
    expect(encode(blockSignIn("QK74RM"))).toEqual({ userCode: "QK74RM", approve: false });
  });

  it("explains failures by what the person can do about them", () => {
    expect(approveProblem({ _tag: "NotFound", entity: "device", id: "x" })).toBe("invalidCode");
    expect(approveProblem({ _tag: "DeviceCodeNotReady", reason: "expired" })).toBe("invalidCode");
    expect(approveProblem({ _tag: "Forbidden" })).toBe("forbidden");
    expect(approveProblem(new Error("network"))).toBe("failed");
  });
});
