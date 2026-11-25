import type { Role } from "@slipstream/domain";
import { m } from "@slipstream/i18n";

/**
 * The settings sections (SPEC §8.7) in three groups: This device (language, theme, the quality
 * on this device), Your profile, and the household's sections, which only the admin sees. The
 * URL is `/settings/<section>`; `playback` keeps its URL for the household's Default quality.
 */
export const settingsSections = [
  "device",
  "profile",
  "sources",
  "recording",
  "users",
  "playback",
  "storage",
] as const;

/** A settings section's URL name. */
export type SettingsSection = (typeof settingsSections)[number];

/** Whom a group of sections is for: this device, your profile, or everyone in the household. */
export type SettingsGroupKind = "device" | "profile" | "household";

/** A group of sections, in nav order. */
export interface SettingsGroup {
  readonly kind: SettingsGroupKind;
  readonly sections: readonly SettingsSection[];
}

/** Whether a URL segment names a settings section. */
export const isSettingsSection = (value: string): value is SettingsSection =>
  settingsSections.some((section) => section === value);

/** A section's title, as the side nav and the page header write it. */
export const settingsTitle = (section: string): string => {
  switch (section) {
    case "device":
      return m.settings_section_device();
    case "sources":
      return m.settings_section_sources();
    case "recording":
      return m.settings_section_recording();
    case "users":
      return m.settings_section_users();
    case "playback":
      return m.settings_section_default_quality();
    case "storage":
      return m.settings_section_storage();
    default:
      return m.settings_section_profile();
  }
};

/** The groups a person sees: everyone This device and Your profile; the admin the household too. */
export const settingsGroups = (role: Role): readonly SettingsGroup[] => [
  { kind: "device", sections: ["device"] },
  { kind: "profile", sections: ["profile"] },
  ...(role === "admin"
    ? [
        {
          kind: "household" as const,
          sections: ["sources", "recording", "users", "playback", "storage"] as const,
        },
      ]
    : []),
];

/** The sections a person may open, in nav order. */
export const visibleSections = (role: Role): readonly SettingsSection[] =>
  settingsGroups(role).flatMap((group) => group.sections);

/** Whether a section belongs to the household (applies to everyone in it). */
export const isHouseholdSection = (section: SettingsSection): boolean =>
  section !== "device" && section !== "profile";
