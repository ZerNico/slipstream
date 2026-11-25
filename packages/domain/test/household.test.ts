import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import {
  type AccessPolicy,
  canSeeChannel,
  canSeeDestination,
  canSeeRule,
  fullAccess,
  goesToOptions,
  inviteLifetimeMillis,
  isRestricted,
  Pin,
} from "../src/household.ts";
import { ChannelId, CollectionId } from "../src/ids.ts";
import { daserste, skyF1 } from "./test-support.ts";

const kika = ChannelId.make("kika");
const kidsCollection = CollectionId.make("kids");
const formel1 = CollectionId.make("formel-1");
const tatort = CollectionId.make("tatort");

/** The Kids profile of SPEC 7.8: KiKA and Das Erste, only the Kids collection. */
const kids: AccessPolicy = {
  channelIds: [kika, daserste],
  collectionIds: [kidsCollection],
  mayRecord: true,
};

describe("access policy", () => {
  it("restricts nothing for full access", () => {
    expect(isRestricted(fullAccess)).toBe(false);
    expect(canSeeChannel(fullAccess, skyF1)).toBe(true);
    expect(canSeeDestination(fullAccess, { channelId: skyF1 })).toBe(true);
  });

  it("limits channels in live TV and the guide", () => {
    expect(isRestricted(kids)).toBe(true);
    expect(canSeeChannel(kids, daserste)).toBe(true);
    expect(canSeeChannel(kids, skyF1)).toBe(false);
  });

  it("checks recordings on where they land, not only on the channel", () => {
    // Mara's Tatort on Das Erste: a visible channel, but it lands in a collection Kids can't see.
    expect(canSeeDestination(kids, { channelId: daserste, collectionId: tatort })).toBe(false);
    // Jonas's Tagesschau goes to an automatic group, hidden for a collection-limited profile.
    expect(canSeeDestination(kids, { channelId: daserste })).toBe(false);
    expect(canSeeDestination(kids, { channelId: kika, collectionId: kidsCollection })).toBe(true);
    // A Kids recording on a channel the profile can't watch stays hidden too.
    expect(canSeeDestination(kids, { channelId: skyF1, collectionId: kidsCollection })).toBe(false);
  });

  it("shows rules only on visible channels that record into visible collections", () => {
    expect(canSeeRule(kids, { channelIds: [kika], collectionId: kidsCollection })).toBe(true);
    expect(canSeeRule(kids, { channelIds: [kika, skyF1], collectionId: kidsCollection })).toBe(
      false,
    );
    expect(canSeeRule(kids, { channelIds: [], collectionId: kidsCollection })).toBe(false);
    expect(canSeeRule(kids, { channelIds: [daserste] })).toBe(false);
    expect(canSeeRule(fullAccess, { channelIds: [] })).toBe(true);
  });
});

describe("goes to options", () => {
  const collections = [formel1, kidsCollection, tatort];

  it("offers Automatic, every collection and New collection to unrestricted profiles", () => {
    expect(goesToOptions(fullAccess, collections, { mayCreateCollections: true })).toEqual({
      automatic: true,
      newCollection: true,
      collectionIds: collections,
      initial: { _tag: "Automatic" },
    });
    expect(
      goesToOptions(fullAccess, collections, { mayCreateCollections: false })?.newCollection,
    ).toBe(false);
  });

  it("limits a collection-limited profile to its own collections, starting on the first", () => {
    expect(goesToOptions(kids, collections, { mayCreateCollections: true })).toEqual({
      automatic: false,
      newCollection: false,
      collectionIds: [kidsCollection],
      initial: { _tag: "Collection", collectionId: kidsCollection },
    });
  });

  it("offers nothing to profiles that may not record or have no collection to record into", () => {
    const viewer = { ...kids, mayRecord: false };
    expect(goesToOptions(viewer, collections, { mayCreateCollections: true })).toBeUndefined();
    expect(goesToOptions(kids, [formel1], { mayCreateCollections: true })).toBeUndefined();
  });
});

describe("profiles and invites", () => {
  it("accepts exactly four digits as a PIN", () => {
    const decode = Schema.decodeUnknownSync(Pin);
    expect(decode("0815")).toBe("0815");
    for (const wrong of ["815", "08155", "08a5", " 0815"]) {
      expect(() => decode(wrong)).toThrow(/Expected a string matching/);
    }
  });

  it("turns an invite expiry into a lifetime", () => {
    expect(inviteLifetimeMillis("oneDay")).toBe(86_400_000);
    expect(inviteLifetimeMillis("sevenDays")).toBe(604_800_000);
    expect(inviteLifetimeMillis("untilUsed")).toBeUndefined();
  });
});
