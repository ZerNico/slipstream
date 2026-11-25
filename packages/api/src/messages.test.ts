import { describe, expect, expectTypeOf, it } from "vitest";
import { AccountKind, ArtworkSource, InviteExpiry, TranscodeReason } from "@slipstream/domain";
import {
  messageKeys,
  type StreamLimitReason as StreamLimitMessageReason,
  type TranscodeReasonCode,
} from "@slipstream/i18n";
import {
  InviteInvalid,
  ProfileLocked,
  StreamLimitReached,
  type StreamLimitReason,
} from "./errors.ts";

/** Every reason literal the contract sends must have a message, so clients never show a code. */
describe("reason messages", () => {
  const keys = new Set<string>(messageKeys);

  it.each([
    ["transcode_reason_", "", TranscodeReason.literals],
    ["artwork_source_", "", ArtworkSource.literals],
    ["account_kind_", "", AccountKind.literals],
    ["invite_expiry_", "", InviteExpiry.literals],
    ["profile_locked_", "", ProfileLocked.fields.requires.literals],
    ["invite_invalid_", "", InviteInvalid.fields.reason.literals],
    ["stream_limit_", "", StreamLimitReached.fields.reason.literals],
    ["stream_limit_", "_hint", StreamLimitReached.fields.reason.literals],
  ] as const)("has a %s…%s message for every literal", (prefix, suffix, literals) => {
    expect(literals.filter((literal) => !keys.has(`${prefix}${literal}${suffix}`))).toEqual([]);
  });

  it("has a message for a range no longer captured", () => {
    expect(keys.has("playback_not_captured")).toBe(true);
  });

  it("types the i18n helpers' reasons exactly as the contract sends them", () => {
    expectTypeOf<StreamLimitMessageReason>().toEqualTypeOf<StreamLimitReason>();
    expectTypeOf<TranscodeReasonCode>().toEqualTypeOf<TranscodeReason>();
  });
});
