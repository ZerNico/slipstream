import { assert, describe, it } from "@effect/vitest";
import { Schema } from "effect";
import { DeviceInfo, LoginRequest } from "./groups/auth.ts";
import { nameMaxLength, secretMaxLength } from "./primitives.ts";
import { CollectionInput } from "./groups/collections.ts";
import { GuestInviteInput } from "./groups/guests.ts";
import { PinCheck, ProfileInput, ProfileSwitch, ProfileUpdate } from "./groups/profiles.ts";
import { RecordingUpdate } from "./groups/recordings.ts";
import { RuleInput, RulePreviewRequest, RuleUpdate } from "./groups/rules.ts";
import {
  exportTemplateMaxLength,
  ruleNameMaxLength,
  titlePatternMaxLength,
  titleValueMaxLength,
} from "@slipstream/domain";

/** Whether `schema` decodes `value`. */
const accepts = <A, I>(schema: Schema.Codec<A, I>, value: unknown) =>
  Schema.decodeUnknownResult(schema)(value)._tag === "Success";

const long = (length: number) => "x".repeat(length);

const login = (password: string) => ({ username: "admin", password });

/** A rule input with `title` conditions, changed by `overrides`. */
const rule = (overrides: Record<string, unknown> = {}, title: Array<unknown> = []) => ({
  name: "Formel 1",
  enabled: true,
  matcher: { channels: [], title, categories: [], weekdays: [] },
  padding: { beforeMinutes: 5, afterMinutes: 10 },
  retention: { _tag: "KeepAll" },
  ...overrides,
});
const startsWith = (values: Array<string>) => [{ _tag: "StartsWith", values }];
const regex = (pattern: string) => [{ _tag: "Regex", pattern }];
const categories = (values: Array<string>) =>
  rule({ matcher: { channels: [], title: [], categories: values, weekdays: [] } });

describe("input limits", () => {
  it("caps passwords, PINs to check and switch secrets at the secret length", () => {
    assert.isTrue(accepts(LoginRequest, login(long(secretMaxLength))));
    assert.isFalse(accepts(LoginRequest, login(long(secretMaxLength + 1))));
    assert.isFalse(accepts(PinCheck, { pin: long(secretMaxLength + 1) }));
    assert.isFalse(accepts(ProfileSwitch, { secret: long(secretMaxLength + 1) }));
    assert.isFalse(accepts(ProfileUpdate, { password: long(secretMaxLength + 1) }));
    assert.isFalse(accepts(ProfileUpdate, { currentPassword: long(secretMaxLength + 1) }));
    assert.isTrue(accepts(ProfileUpdate, { password: long(secretMaxLength) }));
  });

  it("caps device names, labels and profile names at the name length", () => {
    assert.isTrue(accepts(DeviceInfo, { name: long(nameMaxLength), kind: "tv" }));
    assert.isFalse(accepts(DeviceInfo, { name: long(nameMaxLength + 1), kind: "tv" }));
    assert.isFalse(accepts(RecordingUpdate, { labels: [long(nameMaxLength + 1)] }));
    assert.isFalse(
      accepts(ProfileInput, { displayName: long(nameMaxLength + 1), avatarTone: "teal" }),
    );
    assert.isFalse(accepts(ProfileUpdate, { displayName: long(nameMaxLength + 1) }));
    assert.isFalse(
      accepts(GuestInviteInput, {
        name: long(nameMaxLength + 1),
        access: { mayRecord: false },
        expiry: "sevenDays",
      }),
    );
    const collection = {
      name: "Sport",
      rank: 0,
      matcher: { channels: [], title: [], categories: [], weekdays: [] },
      labels: [long(nameMaxLength)],
      layout: { parts: [], path: [] },
    };
    assert.isTrue(accepts(CollectionInput, collection));
    assert.isFalse(accepts(CollectionInput, { ...collection, labels: [long(nameMaxLength + 1)] }));
  });

  describe("rules", () => {
    it("caps the rule name", () => {
      assert.isTrue(accepts(RuleInput, rule({ name: long(ruleNameMaxLength) })));
      assert.isFalse(accepts(RuleInput, rule({ name: long(ruleNameMaxLength + 1) })));
      assert.isFalse(accepts(RuleUpdate, { name: long(ruleNameMaxLength + 1) }));
    });

    it("caps matcher values, their count, categories and regex patterns", () => {
      assert.isTrue(accepts(RuleInput, rule({}, startsWith([long(titleValueMaxLength)]))));
      assert.isFalse(accepts(RuleInput, rule({}, startsWith([long(titleValueMaxLength + 1)]))));
      assert.isFalse(
        accepts(RuleInput, rule({}, startsWith(Array.from({ length: 51 }, () => "F1")))),
      );
      assert.isTrue(accepts(RuleInput, rule({}, regex(long(titlePatternMaxLength)))));
      assert.isFalse(accepts(RuleInput, rule({}, regex(long(titlePatternMaxLength + 1)))));
      assert.isFalse(accepts(RuleInput, categories([long(titleValueMaxLength + 1)])));
      assert.isFalse(
        accepts(CollectionInput, {
          name: "Sport",
          rank: 0,
          matcher: {
            channels: [],
            title: regex(long(titlePatternMaxLength + 1)),
            categories: [],
            weekdays: [],
          },
          labels: [],
          layout: { parts: [], path: [] },
        }),
      );
    });

    it("caps the export path template and previews obey the same limits", () => {
      assert.isTrue(accepts(RuleInput, rule({ exportTemplate: long(exportTemplateMaxLength) })));
      assert.isFalse(
        accepts(RuleInput, rule({ exportTemplate: long(exportTemplateMaxLength + 1) })),
      );
      assert.isFalse(
        accepts(RulePreviewRequest, { rule: rule({ name: long(ruleNameMaxLength + 1) }) }),
      );
    });
  });
});
