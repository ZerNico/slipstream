import { DateTime } from "effect";
import type { RecordingSettings } from "@slipstream/api";
import {
  type AccessPolicy,
  type AvatarTone,
  ChannelId,
  CollectionId,
  DAY,
  defaultArtworkOrder,
  fullAccess,
  type GuestInvite,
  initialLiveKeep,
  type LiveKeep,
  InviteId,
  type Profile,
  type User,
  UserId,
} from "@slipstream/domain";
import type { MockData } from "./fixtures.ts";

/**
 * What the mock knows about household profiles and guests beyond the fixture accounts: avatar
 * tones, PINs, access policies, pending invites, and the recording defaults (SPEC 7.7, 7.8).
 * Part of each mock instance's data (`MockData.household`).
 */
export interface HouseholdState {
  readonly tones: Map<UserId, AvatarTone>;
  readonly pins: Map<UserId, string>;
  readonly access: Map<UserId, AccessPolicy>;
  /** Accounts that are guests (everyone else is a household profile). */
  readonly guests: Set<UserId>;
  readonly lastSeen: Map<UserId, { readonly at: number; readonly from: "home" | "away" }>;
  /** Pending invites with their secret token. */
  invites: Array<{ readonly invite: GuestInvite; readonly token: string; used: boolean }>;
  /** Tokens of invites that were used or revoked, for the "no longer valid" answers. */
  readonly spent: Map<string, "used" | "revoked">;
  recording: RecordingSettings;
  /** Live TV after its viewers leave (Settings › Recording). */
  live: LiveKeep;
  /** Whether a TMDB key is set (the mock keeps no key, only that there is one). */
  tmdb: boolean;
}

/** The mock origin invite links point at. */
export const mockOrigin = "http://slipstream.test";

/** The token of the fixture invite ("Invite for Lisa"), for tests of the invite page. */
export const mockInviteToken = "lisa-invite-token";

/** The PIN of the fixture's locked profile (Kim). */
export const mockPin = "1234";

/** The fixture's guest account (Tom), who signs in from away. */
export const mockGuest = (now: number): User => ({
  id: UserId.make("tom"),
  username: "tom",
  displayName: "Tom",
  role: "user",
  createdAt: DateTime.makeUnsafe(now - 30 * DAY),
});

/**
 * The household state of a fresh mock: tones, PINs, access, the guest Tom and the pending
 * invite. `admin` creates the invite.
 */
export const makeHousehold = (now: number, admin: UserId): HouseholdState => {
  const tom = mockGuest(now);
  const tones = new Map<UserId, AvatarTone>([
    [UserId.make("alex"), "amber"],
    [UserId.make("household"), "teal"],
    [UserId.make("kim"), "violet"],
    [tom.id, "blue"],
  ]);
  const access = new Map<UserId, AccessPolicy>([
    [
      UserId.make("kim"),
      {
        channelIds: [ChannelId.make("das-erste"), ChannelId.make("zdf")],
        mayRecord: true,
      },
    ],
    [
      tom.id,
      {
        channelIds: [ChannelId.make("sky-sport-f1")],
        collectionIds: [CollectionId.make("formel-1")],
        mayRecord: false,
        maxStreams: 1,
      },
    ],
  ]);
  const lisa: GuestInvite = {
    id: InviteId.make("lisa"),
    name: "Lisa",
    access: { collectionIds: [CollectionId.make("formel-1")], mayRecord: true, maxStreams: 1 },
    createdBy: admin,
    createdAt: DateTime.makeUnsafe(now - DAY),
    expiresAt: DateTime.makeUnsafe(now + 6 * DAY),
    url: `${mockOrigin}/invite?token=${mockInviteToken}`,
  };
  return {
    tones,
    pins: new Map([[UserId.make("kim"), mockPin]]),
    access,
    guests: new Set([tom.id]),
    lastSeen: new Map([[tom.id, { at: now - 8 * DAY, from: "away" as const }]]),
    invites: [{ invite: lisa, token: mockInviteToken, used: false }],
    spent: new Map(),
    tmdb: false,
    live: initialLiveKeep,
    recording: {
      extraTime: {
        padding: { beforeMinutes: 2, afterMinutes: 10 },
        overrides: [
          { _tag: "Category", category: "Sport", padding: { beforeMinutes: 5, afterMinutes: 60 } },
          {
            _tag: "Channel",
            channelId: ChannelId.make("sky-sport-f1"),
            padding: { beforeMinutes: 5, afterMinutes: 60 },
          },
          { _tag: "Category", category: "Film", padding: { beforeMinutes: 2, afterMinutes: 15 } },
        ],
      },
      artworkOrder: [...defaultArtworkOrder],
    },
  };
};

/** A fixture account as a profile, with its tone, PIN and access. */
export const profileOf = (state: HouseholdState, user: User): Profile => ({
  id: user.id,
  displayName: user.displayName,
  role: user.role,
  kind: state.guests.has(user.id) ? "guest" : "household",
  avatarTone: state.tones.get(user.id) ?? "amber",
  hasPin: state.pins.has(user.id),
  access: user.role === "admin" ? fullAccess : (state.access.get(user.id) ?? fullAccess),
  createdAt: user.createdAt,
});

/**
 * What `user` may see and do, the way the server's viewer works it out: admins and household
 * profiles without a policy see everything. Every list a restricted profile reads is filtered
 * with the domain's `canSee*` helpers over this.
 */
export const accessOf = (data: MockData, user: User): AccessPolicy =>
  profileOf(data.household, user).access;
