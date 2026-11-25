import { householdDefaultHint, type NetworkKind, type QualityDefaults } from "@slipstream/domain";
import { householdDefaultHintText, m } from "@slipstream/i18n";

/*
 * What Settings lists, in three groups, the same on phones and TV: This device (what this device
 * remembers for itself), Your profile (who is signed in), and the household's sections, which
 * apply to everyone and only an admin sees.
 */

/** A row of This device. */
export type DeviceRow = "language" | "quality" | "fit" | "link" | "server";

/** A row of Your profile. */
export type ProfileRow = "profile" | "switch" | "add" | "signOut";

/** A household section; each opens its page (on TV, on the phone). */
export type HouseholdRow = "sources" | "recording" | "users" | "playback" | "storage";

/** The rows of each group; an empty household means the group is not shown. */
export interface SettingsRows {
  readonly device: readonly DeviceRow[];
  readonly profile: readonly ProfileRow[];
  readonly household: readonly HouseholdRow[];
}

/**
 * The rows for who is signed in on which device: Link TV only on phones (a TV is linked from a
 * phone), Switch profile only with more than one profile signed in here, the household's
 * sections only for an admin.
 */
export const settingsRows = (input: {
  readonly admin: boolean;
  readonly tv: boolean;
  /** More than one profile is signed in on this device. */
  readonly shared: boolean;
}): SettingsRows => ({
  device: ["language", "quality", "fit", ...(input.tv ? [] : ["link" as const]), "server"],
  profile: ["profile", ...(input.shared ? ["switch" as const] : []), "add", "signOut"],
  household: input.admin ? ["sources", "recording", "users", "playback", "storage"] : [],
});

/** Every row's key in screen order, for TV focus: the first one is focused on open. */
export const rowKeys = (rows: SettingsRows): readonly string[] => [
  ...rows.device,
  ...rows.profile,
  ...rows.household,
];

/**
 * The line under "Household default" in the quality picker: what the household's default is on
 * this connection once it is known, else what the choice means. The settings row itself names
 * only the choice, so it holds one line whenever the household's answer arrives.
 */
export const householdDefaultLine = (
  household: QualityDefaults | undefined,
  network: NetworkKind | undefined,
): string =>
  household === undefined
    ? m.quality_server_default_detail()
    : householdDefaultHintText(householdDefaultHint(household, network));
