import { Schema } from "effect";
import { ChannelId, CollectionId, InviteId, UserId } from "./ids.ts";
import { DAY, Instant } from "./time.ts";
import { Role } from "./user.ts";

/**
 * Household profiles share devices and switch from the avatar menu; guests have their own
 * account, are invited by link and sign in from anywhere (SPEC 7.8). Guests are never admins.
 */
export const AccountKind = Schema.Literals(["household", "guest"]);
export type AccountKind = typeof AccountKind.Type;

/**
 * The colour of a profile's initial avatar, as a design-token name (never a raw colour): web and
 * app map it to their palette.
 */
export const AvatarTone = Schema.Literals(["amber", "teal", "violet", "rose", "green", "blue"]);
export type AvatarTone = typeof AvatarTone.Type;

/** How many digits a profile PIN has: the PIN pad's cells and the schema below. */
export const pinLength = 4;

/** A profile PIN: exactly `pinLength` digits. */
export const Pin = Schema.String.check(
  Schema.isPattern(new RegExp(`^\\d{${pinLength}}$`, "u"), { title: "four digits" }),
);
export type Pin = typeof Pin.Type;

/** Whether a value is a valid PIN (`pinLength` digits). */
export const isPin = Schema.is(Pin);

const StreamCount = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1));

/** The most streams the profile and invite forms offer as a profile's own limit. */
export const maxStreamsLimit = 8;

/**
 * What a restricted profile (Kids) or a guest may see and do. An absent list means no
 * restriction. Access is checked on where an item lands: a recording or scheduled programme
 * counts as the collection it goes to, so a profile limited to "Kids" never sees a Tatort
 * recorded on a channel it may watch.
 */
export const AccessPolicy = Schema.Struct({
  /** Channels in live TV, the guide and the player; absent: every channel. */
  channelIds: Schema.optionalKey(Schema.Array(ChannelId)),
  /** Collections in the library; absent: the whole library, automatic groups included. */
  collectionIds: Schema.optionalKey(Schema.Array(CollectionId)),
  /** May schedule recordings and create rules. */
  mayRecord: Schema.Boolean,
  /** Streams this profile may watch at the same time; absent: no own limit. */
  maxStreams: Schema.optionalKey(StreamCount),
}).annotate({ identifier: "AccessPolicy" });
export type AccessPolicy = typeof AccessPolicy.Type;

/** No restrictions: what admins and ordinary household profiles get. */
export const fullAccess: AccessPolicy = { mayRecord: true };

/** True when the policy hides any channel or collection. */
export const isRestricted = (access: AccessPolicy): boolean =>
  access.channelIds !== undefined || access.collectionIds !== undefined;

/** Whether the profile may see a channel in live TV, the guide and the player. */
export const canSeeChannel = (access: AccessPolicy, channelId: ChannelId): boolean =>
  access.channelIds === undefined || access.channelIds.includes(channelId);

/** Where a recording, a scheduled programme or a rule's results end up. */
export interface Destination {
  readonly channelId: ChannelId;
  /** The collection it is placed in or will go to; absent for automatic groups. */
  readonly collectionId?: CollectionId | undefined;
}

/**
 * Whether the profile may see a recording or scheduled programme: its channel is visible, and,
 * when collections are restricted, it lands in one of the allowed collections (automatic groups
 * are then hidden).
 */
export const canSeeDestination = (access: AccessPolicy, destination: Destination): boolean =>
  canSeeChannel(access, destination.channelId) &&
  (access.collectionIds === undefined ||
    (destination.collectionId !== undefined &&
      access.collectionIds.includes(destination.collectionId)));

/** What visibility of a rule depends on. */
export interface RuleScope {
  /** The rule matcher's channels; empty means every channel. */
  readonly channelIds: ReadonlyArray<ChannelId>;
  /** The collection the rule records into; absent for "Automatic". */
  readonly collectionId?: CollectionId | undefined;
}

/**
 * Whether a restricted profile sees a rule (SPEC 7.8): only rules on channels it can see (a rule
 * on every channel only for profiles that see every channel) that record into a collection it
 * can see. Seeing a rule is not editing it: only its owner and admins change it.
 */
export const canSeeRule = (access: AccessPolicy, rule: RuleScope): boolean => {
  const channelsVisible =
    access.channelIds === undefined
      ? true
      : rule.channelIds.length > 0 &&
        rule.channelIds.every((channelId) => canSeeChannel(access, channelId));
  const collectionVisible =
    access.collectionIds === undefined ||
    (rule.collectionId !== undefined && access.collectionIds.includes(rule.collectionId));
  return channelsVisible && collectionVisible;
};

/**
 * Whether a viewer may change a rule (SPEC 7.8): admins change every rule, everyone else only
 * their own; other people's rules are read-only. An unknown viewer (`id` not loaded yet) owns
 * nothing.
 */
export const canEditRule = (
  rule: { readonly ownerId: UserId },
  viewer: { readonly id: UserId | undefined; readonly isAdmin: boolean },
): boolean => viewer.isAdmin || (viewer.id !== undefined && rule.ownerId === viewer.id);

/**
 * Whether someone may create collections ("New collection…") and so link one to a series
 * recording (the collection offer, recording model §3.3, §3.4): the same right, admins only.
 */
export const canCreateCollections = (actor: { readonly role: Role }): boolean =>
  actor.role === "admin";

/** What the "Goes to" select starts on. */
export const GoesToInitial = Schema.TaggedUnion({
  Automatic: {},
  Collection: { collectionId: CollectionId },
}).annotate({ identifier: "GoesToInitial" });
export type GoesToInitial = typeof GoesToInitial.Type;

/** The choices of the "Goes to" select in the programme sheet and the rule editor. */
export const GoesToOptions = Schema.Struct({
  /** "Automatic (Formel 1)": let collections and the guide decide. */
  automatic: Schema.Boolean,
  /** "New collection…" as an inline step. */
  newCollection: Schema.Boolean,
  /** Collections the profile may pick, in the order given. */
  collectionIds: Schema.Array(CollectionId),
  initial: GoesToInitial,
}).annotate({ identifier: "GoesToOptions" });
export type GoesToOptions = typeof GoesToOptions.Type;

/**
 * The "Goes to" choices for a profile (SPEC 7.8). A collection-limited profile lists only its own
 * collections and starts on the first, without "Automatic" or "New collection…", because the
 * result would vanish from its own library. Returns `undefined` when the profile may not record,
 * or is collection-limited without any existing collection to record into.
 */
export const goesToOptions = (
  access: AccessPolicy,
  collections: ReadonlyArray<CollectionId>,
  options: { readonly mayCreateCollections: boolean },
): GoesToOptions | undefined => {
  if (!access.mayRecord) return undefined;
  if (access.collectionIds === undefined) {
    return {
      automatic: true,
      newCollection: options.mayCreateCollections,
      collectionIds: collections,
      initial: { _tag: "Automatic" },
    };
  }
  const allowed = access.collectionIds;
  const own = collections.filter((id) => allowed.includes(id));
  const [first] = own;
  if (first === undefined) return undefined;
  return {
    automatic: false,
    newCollection: false,
    collectionIds: own,
    initial: { _tag: "Collection", collectionId: first },
  };
};

/**
 * One person as the household sees them: in the avatar menu's profile switcher, in Settings ›
 * Users & devices and on a TV's profile picker. No username and nothing to sign in with.
 */
export const Profile = Schema.Struct({
  id: UserId,
  displayName: Schema.NonEmptyString,
  role: Role,
  kind: AccountKind,
  avatarTone: AvatarTone,
  /** Switching to this profile asks for its PIN (the lock icon in the menu). */
  hasPin: Schema.Boolean,
  access: AccessPolicy,
  createdAt: Instant,
}).annotate({ identifier: "Profile" });
export type Profile = typeof Profile.Type;

/** How long a guest invite link stays valid. Every invite is used up when someone accepts it. */
export const InviteExpiry = Schema.Literals(["oneDay", "sevenDays", "untilUsed"]);
export type InviteExpiry = typeof InviteExpiry.Type;

/** A pending guest invite, as admins see it in Users & devices ("Invite for Lisa"). */
export const GuestInvite = Schema.Struct({
  id: InviteId,
  /** Who it is for, prefilled as the guest's display name. */
  name: Schema.NonEmptyString,
  access: AccessPolicy,
  createdBy: UserId,
  createdAt: Instant,
  /** Absent for "until used". */
  expiresAt: Schema.optionalKey(Instant),
  /** The link to send, with its secret token; admins can copy it again until it is used. */
  url: Schema.String,
}).annotate({ identifier: "GuestInvite" });
export type GuestInvite = typeof GuestInvite.Type;

/** Milliseconds an invite with this expiry stays valid, or `undefined` for "until used". */
export const inviteLifetimeMillis = (expiry: InviteExpiry): number | undefined => {
  switch (expiry) {
    case "oneDay":
      return DAY;
    case "sevenDays":
      return 7 * DAY;
    case "untilUsed":
      return undefined;
  }
};

/**
 * The profile a TV is signed in as unless someone picks another: a shared, non-admin profile
 * when there is one (design language: shared TVs default to the household, not the admin),
 * otherwise the person approving.
 */
export const defaultProfile = (
  profiles: readonly Pick<Profile, "id" | "role">[],
  me: { readonly id: UserId },
): UserId =>
  profiles.find((profile) => profile.role === "user" && profile.id !== me.id)?.id ?? me.id;

/**
 * Whom a TV can be signed in as by name: every household profile for an admin, otherwise only
 * the person approving (the server refuses anything else). The approver comes first.
 */
export const profileChoices = <P extends Pick<Profile, "id" | "role">>(
  me: P,
  profiles: readonly P[] | undefined,
): readonly P[] =>
  me.role !== "admin" || profiles === undefined
    ? [me]
    : [me, ...profiles.filter((profile) => profile.id !== me.id)];
