import { describe, expect, it } from "vitest";
import {
  accessFromTokens,
  accessNames,
  accessTokens,
  addToken,
  ChannelId,
  CollectionId,
  expectedLock,
  freeTokens,
  avatarInitials,
  inviteDaysLeft,
  isPin,
  pinChange,
  pinInput,
  pinLength,
  removeToken,
  summariseAccess,
} from "../src/index.ts";

const f1 = ChannelId.make("sky-sport-f1");
const formel1 = CollectionId.make("formel-1");

describe("access", () => {
  const names = accessNames(
    [{ id: f1, name: "Sky Sport F1" }],
    [{ id: formel1, name: "Formel 1" }],
  );

  it("turns tokens into a policy with lists only for restricted halves", () => {
    const tokens = addToken([], { kind: "collection", id: formel1 });
    expect(accessFromTokens(tokens, { mayRecord: false, maxStreams: 1 })).toEqual({
      collectionIds: [formel1],
      mayRecord: false,
      maxStreams: 1,
    });
    expect(accessFromTokens([], { mayRecord: true })).toEqual({ mayRecord: true });
  });

  it("does not add a token twice and removes it again", () => {
    const one = addToken([], { kind: "channel", id: f1 });
    expect(addToken(one, { kind: "channel", id: f1 })).toHaveLength(1);
    expect(removeToken(one, { kind: "channel", id: f1 })).toEqual([]);
  });

  it("offers what is not a token yet, never a hidden channel", () => {
    const hiddenId = ChannelId.make("hidden");
    const news = CollectionId.make("news");
    const free = freeTokens(
      [{ kind: "collection", id: formel1 }],
      [
        { id: f1, hidden: false },
        { id: hiddenId, hidden: true },
      ],
      [{ id: formel1 }, { id: news }],
    );
    expect(free.collections.map((collection) => collection.id)).toEqual([news]);
    expect(free.channels.map((channel) => channel.id)).toEqual([f1]);
  });

  it("names what a guest sees, collections first", () => {
    const access = { channelIds: [f1], collectionIds: [formel1], mayRecord: false };
    expect(accessTokens(access).map((token) => token.kind)).toEqual(["collection", "channel"]);
    expect(summariseAccess(access, names).sees).toEqual(["Formel 1", "Sky Sport F1"]);
  });
});

describe("PIN", () => {
  it("strips everything but digits while typing, up to a full PIN", () => {
    expect(isPin("1234")).toBe(true);
    expect(isPin("123")).toBe(false);
    expect(pinInput("12a3-45")).toBe("1234");
    expect(isPin(pinInput("12a3-45"))).toBe(true);
    expect(pinInput("98765432")).toHaveLength(pinLength);
  });

  it("sends the current PIN only when changing one's own", () => {
    expect(pinChange({ mode: "keep", pin: "", currentPin: "", needsCurrent: true })).toBe(
      undefined,
    );
    expect(pinChange({ mode: "set", pin: "4321", currentPin: "1234", needsCurrent: true })).toEqual(
      { pin: "4321", currentPin: "1234" },
    );
    expect(pinChange({ mode: "remove", pin: "", currentPin: "", needsCurrent: false })).toEqual({
      pin: null,
    });
  });

  it("expects a PIN, the admin's password, or nothing", () => {
    expect(expectedLock({ hasPin: true, role: "admin" })).toBe("pin");
    expect(expectedLock({ hasPin: false, role: "admin" })).toBe("password");
    expect(expectedLock({ hasPin: false, role: "user" })).toBe("none");
  });
});

describe("avatarInitials", () => {
  it("takes the first and last word, or the first two letters of one", () => {
    expect(avatarInitials("Jonas Weber")).toBe("JW");
    expect(avatarInitials("Mara")).toBe("MA");
    expect(avatarInitials("  ")).toBe("");
  });
});

describe("invite days left", () => {
  it("rounds up to whole days, at least one, and nothing for until used", () => {
    const now = 1_000_000;
    expect(inviteDaysLeft(now + 36 * 3_600_000, now)).toBe(2);
    expect(inviteDaysLeft(now + 60_000, now)).toBe(1);
    expect(inviteDaysLeft(undefined, now)).toBeUndefined();
  });
});
