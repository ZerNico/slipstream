import type { LoginResult } from "@slipstream/api";
import { pinLength, type Profile, Role } from "@slipstream/domain";
import { Option, Predicate, Schema } from "effect";

/** A profile signed in on this device: who it is and the device token that acts as them. */
export const StoredAccount = Schema.Struct({
  userId: Schema.String,
  username: Schema.String,
  displayName: Schema.String,
  role: Role,
  token: Schema.String,
  /** Epoch ms of the last time this profile was chosen, for the picker's order. */
  lastUsedAt: Schema.Number,
  /**
   * Whether picking this profile asks for its PIN, as the household last said. Kept here so
   * the picker still asks while the household cannot be read.
   */
  hasPin: Schema.optionalKey(Schema.Boolean),
});
export type StoredAccount = typeof StoredAccount.Type;

/** The server this device talks to. */
export const StoredServer = Schema.Struct({
  url: Schema.String,
  name: Schema.String,
});
export type StoredServer = typeof StoredServer.Type;

/** Everything the app remembers between launches, kept in the device's secure storage. */
export const StoredSession = Schema.Struct({
  server: Schema.optionalKey(StoredServer),
  accounts: Schema.Array(StoredAccount),
  /** Shared TVs ask "Who's watching?" on launch; a person can turn that off per device. */
  pickerEnabled: Schema.Boolean,
});
export type StoredSession = typeof StoredSession.Type;

/** A fresh install: no server, nobody signed in, picker on. */
export const emptySession: StoredSession = { accounts: [], pickerEnabled: true };

const codec = Schema.fromJsonString(StoredSession);
const decode = Schema.decodeUnknownOption(codec);
const encode = Schema.encodeSync(codec);

/** Reads stored state; anything unreadable starts over rather than crashing the app. */
export const decodeSession = (text: string | null | undefined): StoredSession =>
  text === null || text === undefined
    ? emptySession
    : Option.getOrElse(decode(text), () => emptySession);

/** Serialises state for secure storage. */
export const encodeSession = (session: StoredSession): string => encode(session);

/**
 * Uses another server. Tokens belong to the server that issued them, so switching to a
 * different URL signs every profile out; picking the same server again keeps them.
 */
export const setServer = (session: StoredSession, server: StoredServer): StoredSession =>
  session.server?.url === server.url
    ? { ...session, server }
    : { ...session, server, accounts: [] };

/** Forgets the server and every profile on it. */
export const forgetServer = (session: StoredSession): StoredSession => ({
  pickerEnabled: session.pickerEnabled,
  accounts: [],
});

/**
 * Adds the profile a sign-in returned, replacing an older token for the same person. Fails
 * soft: a result without a device token (a browser login) adds nothing.
 */
export const addAccount = (
  session: StoredSession,
  result: LoginResult,
  now: number,
): StoredSession => {
  if (result.token === undefined) return session;
  const account: StoredAccount = {
    userId: result.user.id,
    username: result.user.username,
    displayName: result.user.displayName,
    role: result.user.role,
    token: result.token,
    lastUsedAt: now,
  };
  return {
    ...session,
    accounts: [
      ...session.accounts.filter((existing) => existing.userId !== account.userId),
      account,
    ],
  };
};

/** Removes a profile from this device (sign out, or its token was revoked). */
export const removeAccount = (session: StoredSession, userId: string): StoredSession => ({
  ...session,
  accounts: session.accounts.filter((account) => account.userId !== userId),
});

/** Records that a profile was chosen now. */
export const touchAccount = (
  session: StoredSession,
  userId: string,
  now: number,
): StoredSession => ({
  ...session,
  accounts: session.accounts.map((account) =>
    account.userId === userId ? { ...account, lastUsedAt: now } : account,
  ),
});

/** Profiles for the picker, the one used last on this device first. */
export const profilesInOrder = (session: StoredSession): readonly StoredAccount[] =>
  session.accounts.toSorted((a, b) => b.lastUsedAt - a.lastUsedAt);

/** The profile to use without asking: the one used last. */
export const lastUsedAccount = (session: StoredSession): StoredAccount | undefined =>
  profilesInOrder(session)[0];

/**
 * Whether to show "Who's watching?": on shared devices (more than one profile signed in),
 * unless turned off, and only until someone has been picked in this launch.
 */
export const needsProfilePicker = (session: StoredSession, pickedThisLaunch: boolean): boolean =>
  session.pickerEnabled && session.accounts.length > 1 && !pickedThisLaunch;

/** What the device keeps in line with the household on the server. */
export type HouseholdProfile = Pick<Profile, "id" | "displayName" | "role" | "hasPin">;

/**
 * Brings the profiles on this device in line with the household on the server: names, roles
 * and PINs changed in the web UI show up here, and profiles whose account was deleted leave the
 * device (their tokens no longer work anyway). Returns the same object when nothing changed.
 */
export const syncWithHousehold = (
  session: StoredSession,
  household: readonly HouseholdProfile[],
): StoredSession => {
  const byId = new Map(household.map((profile) => [profile.id as string, profile]));
  let changed = false;
  const accounts = session.accounts.flatMap((account) => {
    const profile = byId.get(account.userId);
    if (profile === undefined) {
      changed = true;
      return [];
    }
    if (
      profile.displayName === account.displayName &&
      profile.role === account.role &&
      profile.hasPin === (account.hasPin ?? false)
    ) {
      return [account];
    }
    changed = true;
    return [
      {
        ...account,
        displayName: profile.displayName,
        role: profile.role,
        hasPin: profile.hasPin,
      },
    ];
  });
  return changed ? { ...session, accounts } : session;
};

/** Household profiles not signed in on this device yet, in the server's order. */
export const profilesNotHere = <P extends Pick<Profile, "id">>(
  session: StoredSession,
  household: readonly P[],
): readonly P[] => {
  const here = new Set(session.accounts.map((account) => account.userId));
  return household.filter((profile) => !here.has(profile.id));
};

/**
 * Whether picking a profile asks for its PIN first: as the household on the server says when it
 * could be read, else as it said last time. A profile never known to have a PIN opens straight
 * away; the server still refuses what the profile may not do.
 */
export const profileNeedsPin = (
  account: Pick<StoredAccount, "userId" | "hasPin">,
  household: readonly Pick<Profile, "id" | "hasPin">[],
): boolean =>
  household.find((profile) => profile.id === account.userId)?.hasPin ?? account.hasPin ?? false;

/**
 * What picking a stored profile on "Who's watching?" leads to: straight in, its PIN first (as
 * the household just read says, see {@link profileNeedsPin}), or nothing when the profile is no
 * longer on this device.
 */
export type ProfilePick = "Enter" | "NeedsPin" | "Gone";

/** Decides {@link ProfilePick} for `userId` against the household as last read. */
export const profilePick = (
  session: StoredSession,
  userId: string,
  household: readonly Pick<Profile, "id" | "hasPin">[],
): ProfilePick => {
  const account = session.accounts.find((candidate) => candidate.userId === userId);
  if (account === undefined) return "Gone";
  return profileNeedsPin(account, household) ? "NeedsPin" : "Enter";
};

/** How checking a PIN went, for the PIN entry to say. */
export type PinResult =
  | { readonly _tag: "Accepted" }
  | { readonly _tag: "Wrong" }
  /** Too many wrong PINs: wait this long before the next try. */
  | { readonly _tag: "RateLimited"; readonly retryAfterSeconds: number }
  /** The profile's token no longer works here; the profile was signed out on this device. */
  | { readonly _tag: "SignedOut" }
  | { readonly _tag: "Failed" };

/**
 * Reads the failure of `profiles.verifyPin` (undefined when it succeeded). Only `Accepted` lets
 * the profile in; anything unknown (offline, a server error) keeps the gate shut.
 */
export const pinResult = (error: unknown): PinResult => {
  if (error === undefined) return { _tag: "Accepted" };
  const tag = Predicate.hasProperty(error, "_tag") ? error._tag : undefined;
  switch (tag) {
    case "InvalidCredentials":
      return { _tag: "Wrong" };
    case "RateLimited":
      return {
        _tag: "RateLimited",
        retryAfterSeconds:
          Predicate.hasProperty(error, "retryAfterSeconds") &&
          typeof error.retryAfterSeconds === "number"
            ? error.retryAfterSeconds
            : 0,
      };
    case "Unauthorized":
      return { _tag: "SignedOut" };
    default:
      return { _tag: "Failed" };
  }
};

/**
 * The PIN after one more digit, or one fewer for `"delete"`; never longer than the domain's
 * `pinLength`. The entry checks it once it is a whole PIN (`isPin`).
 */
export const typePinDigit = (pin: string, key: number | "delete"): string =>
  key === "delete"
    ? pin.slice(0, -1)
    : pin.length >= pinLength || !Number.isInteger(key) || key < 0 || key > 9
      ? pin
      : `${pin}${key}`;
