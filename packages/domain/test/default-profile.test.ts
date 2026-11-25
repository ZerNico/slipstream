import { describe, expect, it } from "vitest";
import { defaultProfile, profileChoices } from "../src/household.ts";
import { UserId } from "../src/ids.ts";

describe("defaultProfile", () => {
  const alex = { id: UserId.make("alex"), role: "admin" } as const;
  const household = { id: UserId.make("household"), role: "user" } as const;

  it("signs a shared TV in as the household profile, not the admin approving it", () => {
    expect(defaultProfile([alex, household], alex)).toBe(household.id);
  });

  it("falls back to the person approving when there is no other profile", () => {
    expect(defaultProfile([alex], alex)).toBe(alex.id);
    expect(defaultProfile([], alex)).toBe(alex.id);
  });
});

describe("profileChoices", () => {
  const alex = { id: UserId.make("alex"), role: "admin" } as const;
  const kim = { id: UserId.make("kim"), role: "user" } as const;
  const household = { id: UserId.make("household"), role: "user" } as const;

  it("offers an admin every profile, the approver first", () => {
    expect(profileChoices(alex, [household, alex, kim])).toEqual([alex, household, kim]);
  });

  it("offers anyone else only themselves, and the approver alone before profiles load", () => {
    expect(profileChoices(kim, [household, alex, kim])).toEqual([kim]);
    expect(profileChoices(alex, undefined)).toEqual([alex]);
  });
});
