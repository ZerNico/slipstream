import { Schema } from "effect";
import { type AccessPolicy, isPin, Pin, pinLength, type Profile } from "./household.ts";
import type { ChannelId, CollectionId } from "./ids.ts";
import { DAY } from "./time.ts";

/*
 * The logic of the profile and invite forms every client shares (SPEC §7.8): access policies as
 * one token field of channels and collections (an empty half means "everything" for that half),
 * the PIN part of the profile form, and a profile's initials.
 */

/** One token of the "What they see" field. */
export type AccessToken =
  | { readonly kind: "channel"; readonly id: ChannelId }
  | { readonly kind: "collection"; readonly id: CollectionId };

/** The tokens a policy shows, collections first (they say more about what someone sees). */
export const accessTokens = (access: AccessPolicy): AccessToken[] => [
  ...(access.collectionIds ?? []).map((id) => ({ kind: "collection" as const, id })),
  ...(access.channelIds ?? []).map((id) => ({ kind: "channel" as const, id })),
];

/** A stable key for a token. */
export const tokenKey = (token: AccessToken): string => `${token.kind}:${token.id}`;

/**
 * The policy for a set of tokens: lists only for the halves that have tokens, so a guest with
 * just "Formel 1" sees every channel but only that collection.
 */
export const accessFromTokens = (
  tokens: readonly AccessToken[],
  rest: { readonly mayRecord: boolean; readonly maxStreams?: number | undefined },
): AccessPolicy => {
  const channelIds = tokens.flatMap((token) => (token.kind === "channel" ? [token.id] : []));
  const collectionIds = tokens.flatMap((token) => (token.kind === "collection" ? [token.id] : []));
  return {
    ...(channelIds.length > 0 ? { channelIds } : {}),
    ...(collectionIds.length > 0 ? { collectionIds } : {}),
    mayRecord: rest.mayRecord,
    ...(rest.maxStreams === undefined ? {} : { maxStreams: rest.maxStreams }),
  };
};

/** Adds a token unless it is there already. */
export const addToken = (tokens: readonly AccessToken[], token: AccessToken): AccessToken[] =>
  tokens.some((existing) => tokenKey(existing) === tokenKey(token))
    ? [...tokens]
    : [...tokens, token];

/**
 * What Add still offers: the collections and the visible channels that are not tokens yet,
 * in the order given.
 */
export const freeTokens = <
  C extends { readonly id: ChannelId; readonly hidden: boolean },
  L extends { readonly id: CollectionId },
>(
  tokens: readonly AccessToken[],
  channels: readonly C[],
  collections: readonly L[],
): { readonly channels: readonly C[]; readonly collections: readonly L[] } => {
  const taken = new Set(tokens.map(tokenKey));
  return {
    collections: collections.filter(
      (collection) => !taken.has(tokenKey({ kind: "collection", id: collection.id })),
    ),
    channels: channels.filter(
      (channel) => !channel.hidden && !taken.has(tokenKey({ kind: "channel", id: channel.id })),
    ),
  };
};

/** Removes a token. */
export const removeToken = (tokens: readonly AccessToken[], token: AccessToken): AccessToken[] =>
  tokens.filter((existing) => tokenKey(existing) !== tokenKey(token));

/** Names for ids, from the channel and collection lists. */
export interface AccessNames {
  readonly channel: (id: ChannelId) => string;
  readonly collection: (id: CollectionId) => string;
}

/** The token's name. */
export const tokenName = (token: AccessToken, names: AccessNames): string =>
  token.kind === "channel" ? names.channel(token.id) : names.collection(token.id);

/**
 * What a policy amounts to, for badges and one-line summaries: the names it is limited to (none
 * when unrestricted), whether recording is allowed, and the stream limit.
 */
export interface AccessSummary {
  readonly sees: readonly string[];
  readonly mayRecord: boolean;
  readonly maxStreams: number | undefined;
}

/** Summarises a policy with names. */
export const summariseAccess = (access: AccessPolicy, names: AccessNames): AccessSummary => ({
  sees: accessTokens(access).map((token) => tokenName(token, names)),
  mayRecord: access.mayRecord,
  maxStreams: access.maxStreams,
});

/** Names for ids from the channel and collection lists a screen already has. */
export const accessNames = (
  channels: readonly { readonly id: ChannelId; readonly name: string }[],
  collections: readonly { readonly id: CollectionId; readonly name: string }[],
): AccessNames => ({
  channel: (id) => channels.find((channel) => channel.id === id)?.name ?? id,
  collection: (id) => collections.find((collection) => collection.id === id)?.name ?? id,
});

/** What the PIN part of the profile form does on save. */
export type PinMode = "keep" | "set" | "remove";

/**
 * Sets (`pin`) or removes (`null`) a profile's PIN. Someone changing their own PIN sends the
 * current one when a PIN is set (a wrong one answers `InvalidCredentials`); admins may reset
 * anyone's without it. The API caps how long `currentPin` may be.
 */
export const PinChange = Schema.Struct({
  pin: Schema.NullOr(Pin),
  currentPin: Schema.optionalKey(Schema.String),
}).annotate({ identifier: "PinChange" });
export type PinChange = typeof PinChange.Type;

/**
 * The `PinChange` a save sends, or nothing when the PIN stays as it is. Someone changing their
 * own PIN sends the current one; admins resetting another profile's PIN do not.
 */
export const pinChange = (form: {
  readonly mode: PinMode;
  readonly pin: string;
  readonly currentPin: string;
  readonly needsCurrent: boolean;
}): PinChange | undefined => {
  if (form.mode === "keep") return undefined;
  const current = form.needsCurrent ? { currentPin: form.currentPin } : {};
  if (form.mode === "remove") return { pin: null, ...current };
  return isPin(form.pin) ? { pin: form.pin, ...current } : undefined;
};

/** Keeps only digits, at most `pinLength`, as people type a PIN. */
export const pinInput = (value: string): string => value.replace(/\D/gu, "").slice(0, pinLength);

/** What a switch needs from the person: nothing, the PIN, or the admin's password. */
export type SwitchLock = "none" | "pin" | "password";

/** The lock a profile shows before the server is asked (the server has the last word). */
export const expectedLock = (profile: Pick<Profile, "hasPin" | "role">): SwitchLock =>
  profile.hasPin ? "pin" : profile.role === "admin" ? "password" : "none";

/** Two letters for an avatar: "Jonas Weber" is "JW", "Mara" is "MA". */
export const avatarInitials = (name: string): string => {
  const words = name.trim().split(/\s+/u).filter(Boolean);
  const letters =
    words.length > 1
      ? `${words[0]?.[0] ?? ""}${words.at(-1)?.[0] ?? ""}`
      : (words[0] ?? "").slice(0, 2);
  return letters.toUpperCase();
};

/**
 * Whole days a pending invite stays valid from `now` (at least one), or nothing for an invite
 * valid until used. Both in epoch milliseconds.
 */
export const inviteDaysLeft = (expiresAt: number | undefined, now: number): number | undefined =>
  expiresAt === undefined ? undefined : Math.max(1, Math.ceil((expiresAt - now) / DAY));
