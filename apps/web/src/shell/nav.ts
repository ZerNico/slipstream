import { m } from "@slipstream/i18n";
import type { IconSvgElement } from "~/ui/icon.tsx";
import { GuideIcon, HomeIcon, RecordingsIcon, RulesIcon, SettingsIcon } from "~/ui/icons.ts";

/** A place in the app's navigation. */
export interface NavItem {
  readonly key: "home" | "guide" | "recordings" | "series" | "settings";
  readonly label: () => string;
  readonly to: "/" | "/guide" | "/recordings" | "/series" | "/settings";
  readonly icon: IconSvgElement;
  /** `G` then this key goes there (SPEC §7.2). */
  readonly key2: string;
}

/**
 * The five places, the same words on every breakpoint (SPEC §2.4, decision r1 #10): phone tab
 * bar and tablet rail show all five; the desktop top bar shows the first four as tabs and
 * Settings as a gear.
 */
export const navItems: readonly NavItem[] = [
  { key: "home", label: () => m.nav_home(), to: "/", icon: HomeIcon, key2: "h" },
  { key: "guide", label: () => m.nav_guide(), to: "/guide", icon: GuideIcon, key2: "g" },
  {
    key: "recordings",
    label: () => m.nav_recordings(),
    to: "/recordings",
    icon: RecordingsIcon,
    key2: "r",
  },
  { key: "series", label: () => m.nav_series(), to: "/series", icon: RulesIcon, key2: "e" },
  {
    key: "settings",
    label: () => m.nav_settings(),
    to: "/settings",
    icon: SettingsIcon,
    key2: "s",
  },
];

/** Whether a nav item is the current place for a path (Home only on `/`). */
export const isCurrent = (item: NavItem, pathname: string): boolean =>
  item.to === "/" ? pathname === "/" : pathname === item.to || pathname.startsWith(`${item.to}/`);
