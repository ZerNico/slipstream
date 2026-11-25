import { Link, useRouterState } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { m } from "@slipstream/i18n";
import { Icon } from "~/ui/icon.tsx";
import { SearchIcon, SettingsIcon } from "~/ui/icons.ts";
import { useOverlay } from "~/ui/overlay/use-overlay.tsx";
import { isApplePlatform } from "~/ui/platform.ts";
import { IconButton } from "~/ui/primitives/button.tsx";
import { AccountMenu } from "./account-menu.tsx";
import { Lockup, Mark } from "./logo.tsx";
import { isCurrent, type NavItem, navItems } from "./nav.ts";
import { RecordingPill } from "./recording-pill.tsx";

/** What the problem counts are: recordings that failed, and channels left without a stream. */
export interface NavProblems {
  readonly recordings: number;
  readonly lineup: number;
}

/** A problems count on its own: none, no badge and no gap (SPEC §6.1). */
function ProblemCount({ count }: { count: number }) {
  if (count === 0) return null;
  return (
    <span className="shell-count" aria-label={m.nav_issues({ count })}>
      {count}
    </span>
  );
}

/** The problems count on the Recordings item and (for the lineup) on Settings. */
function Count({ item, problems }: { item: NavItem; problems: NavProblems }) {
  if (item.key === "recordings") return <ProblemCount count={problems.recordings} />;
  if (item.key === "settings") return <ProblemCount count={problems.lineup} />;
  return null;
}

const usePathname = () => useRouterState({ select: (state) => state.location.pathname });

/**
 * The top bar (SPEC §2.2, §2.4): lockup and four tabs from 1100 px, the recording pill from
 * 768 px, search (an icon on phones, a 260 px field with ⌘K on desktop), the settings gear on
 * desktop, the avatar menu everywhere. Over the Home hero it is transparent until the page
 * scrolls 40 px, and takes the hero's cinema colours.
 */
export function TopBar({ problems, under }: { problems: NavProblems; under: boolean }) {
  const pathname = usePathname();
  const overlay = useOverlay();
  const scrolled = useScrolledPast(40, under);
  const over = under && !scrolled;
  // "⌘K" on Apple keyboards, "Ctrl K" (German "Strg K") everywhere else.
  const searchKey = m.shell_search_key({ apple: isApplePlatform() });
  return (
    <header
      className="shell-topbar"
      data-over={over ? "" : undefined}
      data-surface={over ? "cine" : undefined}
    >
      <div className="shell-topbar-row wrap">
        <Link to="/" className="shell-logo" aria-label={m.shell_home_label()}>
          <Mark />
          <Lockup />
        </Link>
        <nav className="shell-navtabs" aria-label={m.shell_nav_label()}>
          {navItems.slice(0, 4).map((item) => (
            <Link
              key={item.key}
              to={item.to}
              className="shell-navtab"
              aria-current={isCurrent(item, pathname) ? "page" : undefined}
            >
              {item.label()}
              <Count item={item} problems={problems} />
            </Link>
          ))}
        </nav>
        <span className="shell-spacer" />
        <RecordingPill />
        <button
          type="button"
          className="shell-search"
          aria-label={m.shell_search_label({ key: searchKey })}
          onClick={() => overlay.open({ kind: "dlg", name: "cmdk" })}
        >
          <Icon icon={SearchIcon} />
          <span className="shell-search-label">{m.shell_search_placeholder()}</span>
          <kbd className="kbd shell-search-kbd">{searchKey}</kbd>
        </button>
        <span className="shell-settings">
          <IconButton
            label={m.nav_settings()}
            tooltipSide="bottom"
            nativeButton={false}
            render={<Link to="/settings" />}
          >
            <Icon icon={SettingsIcon} />
          </IconButton>
          <ProblemCount count={problems.lineup} />
        </span>
        <AccountMenu />
      </div>
    </header>
  );
}

/** The tablet rail (768 to 1099 px) and the compact rail in short landscape: five labelled items. */
export function Rail({ problems }: { problems: NavProblems }) {
  const pathname = usePathname();
  return (
    <nav className="shell-rail" aria-label={m.shell_nav_label()}>
      <Link to="/" className="shell-logo" aria-label={m.shell_home_label()}>
        <Mark />
      </Link>
      {navItems.map((item) => (
        <Link
          key={item.key}
          to={item.to}
          className="shell-rail-item"
          aria-current={isCurrent(item, pathname) ? "page" : undefined}
        >
          <span className="shell-rail-pill">
            <Icon icon={item.icon} size={24} />
          </span>
          {/* A long word ("Einstellungen") breaks with a hyphen rather than past the 72 px item. */}
          <span className="max-w-full text-center leading-tight hyphens-auto">{item.label()}</span>
          <Count item={item} problems={problems} />
        </Link>
      ))}
    </nav>
  );
}

/** The phone tab bar (under 768 px, not in short landscape): five tabs, 64 px plus the safe area. */
export function TabBar({ problems }: { problems: NavProblems }) {
  const pathname = usePathname();
  return (
    <nav className="shell-tabbar" aria-label={m.shell_nav_label()}>
      {navItems.map((item) => (
        <Link
          key={item.key}
          to={item.to}
          className="shell-tab"
          aria-current={isCurrent(item, pathname) ? "page" : undefined}
        >
          <Icon icon={item.icon} size={24} className="shell-tab-icon" />
          {/* Five tabs share 320 px: a long word ends in an ellipsis, never under its neighbour. */}
          <span className="max-w-full truncate px-0.5">{item.label()}</span>
          <Count item={item} problems={problems} />
        </Link>
      ))}
    </nav>
  );
}

/** Whether the window has scrolled past `threshold` px; only listens while `active`. */
function useScrolledPast(threshold: number, active: boolean): boolean {
  const [past, setPast] = useState(false);
  useEffect(() => {
    if (!active) return;
    const check = () => setPast(window.scrollY > threshold);
    check();
    window.addEventListener("scroll", check, { passive: true });
    return () => window.removeEventListener("scroll", check);
  }, [threshold, active]);
  return active && past;
}
