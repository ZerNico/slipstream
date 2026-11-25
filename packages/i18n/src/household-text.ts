import { m } from "./runtime.ts";

/*
 * The lines Settings › Users & devices writes about profiles, guests and invites, for every
 * client. They take an access summary (the domain's `summariseAccess`) by its shape.
 */

/** What an access policy amounts to: the names it is limited to, recording, the stream limit. */
export interface AccessWords {
  /** Names the policy is limited to; empty when it sees everything. */
  readonly sees: readonly string[];
  readonly mayRecord: boolean;
  readonly maxStreams: number | undefined;
}

/** How long a guest invite link stays valid. */
export type InviteExpiryWord = "oneDay" | "sevenDays" | "untilUsed";

/** A profile picture's colour, as `AvatarTone` names it. */
export type AvatarToneWord = "amber" | "teal" | "violet" | "rose" | "green" | "blue";

/** The name of an avatar colour ("Teal"). */
export const toneLabel = (tone: AvatarToneWord): string => {
  switch (tone) {
    case "amber":
      return m.tone_amber();
    case "teal":
      return m.tone_teal();
    case "violet":
      return m.tone_violet();
    case "rose":
      return m.tone_rose();
    case "green":
      return m.tone_green();
    case "blue":
      return m.tone_blue();
  }
};

/** The words for an invite's lifetime ("In 7 days"). */
export const inviteExpiryLabel = (expiry: InviteExpiryWord): string => {
  switch (expiry) {
    case "oneDay":
      return m.invite_expiry_oneDay();
    case "sevenDays":
      return m.invite_expiry_sevenDays();
    case "untilUsed":
      return m.invite_expiry_untilUsed();
  }
};

/**
 * The line under a household profile's name: its role, what it sees when restricted, that it
 * can't record, and the PIN ("Watch and record · sees KiKA · can't record · PIN").
 */
export const profileLine = (profile: {
  readonly admin: boolean;
  /** Whether the policy limits channels or collections at all. */
  readonly restricted: boolean;
  readonly access: AccessWords;
  readonly hasPin: boolean;
}): string => {
  const parts = [profile.admin ? m.profile_admin() : m.account_kind_household()];
  if (!profile.admin && profile.restricted) {
    parts.push(m.access_sees({ names: profile.access.sees.join(", ") }));
  }
  if (!profile.admin && !profile.access.mayRecord) parts.push(m.access_cant_record());
  if (profile.hasPin) parts.push(m.profiles_pin());
  return parts.join(" · ");
};

/** A guest's access as badges in one line ("Sees Formel 1 · Can't record · 1 stream"). */
export const guestAccessLine = (access: AccessWords): string =>
  [
    access.sees.length === 0
      ? m.access_sees_everything()
      : m.access_sees_badge({ names: access.sees.join(", ") }),
    access.mayRecord ? m.access_may_record() : m.access_cant_record_badge(),
    ...(access.maxStreams === undefined
      ? []
      : [m.access_stream_count({ count: access.maxStreams })]),
  ].join(" · ");

/**
 * A pending invite's line: not used yet, how long it stays valid (`days` left, none for "until
 * used"), what it grants.
 */
export const inviteLine = (invite: {
  readonly daysLeft: number | undefined;
  readonly access: AccessWords;
}): string =>
  [
    m.invite_not_used(),
    invite.daysLeft === undefined
      ? m.invite_until_used()
      : m.invite_expires_in({ days: invite.daysLeft }),
    invite.access.sees.length === 0
      ? m.access_sees_everything_lower()
      : m.access_sees({ names: invite.access.sees.join(", ") }),
    invite.access.mayRecord ? m.access_may_record_lower() : m.access_cant_record(),
    ...(invite.access.maxStreams === undefined
      ? []
      : [m.access_stream_count({ count: invite.access.maxStreams })]),
  ].join(" · ");
