import { useQuery } from "@tanstack/react-query";
import { useNavigate, useRouteContext } from "@tanstack/react-router";
import { useQueries } from "~/api/hooks.ts";
import { useLogout } from "~/api/mutations.ts";
import { isLocale, languageName, locales, m } from "@slipstream/i18n";
import { chooseLocale, useLanguageChoice } from "~/i18n/locale.ts";
import { Icon } from "~/ui/icon.tsx";
import {
  DarkIcon,
  KeyboardIcon,
  LightIcon,
  LockIcon,
  SettingsIcon,
  SignOutIcon,
  SystemThemeIcon,
  UsersIcon,
} from "~/ui/icons.ts";
import {
  MenuItem,
  MenuLabel,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  ResponsiveMenu,
} from "~/ui/menu.tsx";
import { Avatar } from "~/ui/avatar.tsx";
import { useOverlay } from "~/ui/overlay/use-overlay.tsx";
import { setThemePreference, type ThemePreference, useThemePreference } from "~/ui/theme.ts";
import { media, useMediaQuery } from "~/ui/use-media-query.ts";

const isTheme = (value: string): value is ThemePreference =>
  value === "system" || value === "light" || value === "dark";

/**
 * The avatar menu (SPEC §2.4): the current profile, switching profile, Settings, the admin's
 * profiles and devices, keyboard shortcuts (fine pointer only), the theme, Sign out. A popover
 * on desktop, the one Sheet under 768 px on touch (`?dlg=account`).
 */
export function AccountMenu() {
  const { me } = useRouteContext({ from: "/_app" });
  const queries = useQueries();
  const overlay = useOverlay();
  const navigate = useNavigate();
  const logout = useLogout();
  const theme = useThemePreference();
  const language = useLanguageChoice();
  const fine = useMediaQuery(media.finePointer);
  const admin = me.role === "admin";
  // Household profiles switch on this device; a guest's list holds only themselves.
  const profiles = useQuery(queries.profiles());
  const mine = profiles.data?.find((profile) => profile.id === me.id);
  const others = (profiles.data ?? []).filter(
    (profile) => profile.id !== me.id && profile.kind === "household",
  );

  return (
    <ResponsiveMenu
      name="account"
      label={m.account_menu_label()}
      trigger={
        <button type="button" className="shell-avatar-button" aria-label={m.account_menu_label()}>
          <Avatar name={me.displayName} tone={mine?.avatarTone} />
        </button>
      }
    >
      <div className="flex items-center gap-3 px-2.5 pt-2 pb-2.5">
        <Avatar name={me.displayName} tone={mine?.avatarTone} size={36} />
        <div className="min-w-0">
          <div className="truncate font-semibold">{me.displayName}</div>
          <div className="type-meta">{admin ? m.profile_admin() : m.account_kind_household()}</div>
        </div>
      </div>
      {others.length > 0 ? (
        <>
          <MenuLabel>{m.account_switch_profile()}</MenuLabel>
          {others.map((profile) => (
            <MenuItem
              key={profile.id}
              icon={<Avatar name={profile.displayName} tone={profile.avatarTone} size={20} />}
              end={profile.hasPin ? <Icon icon={LockIcon} size={16} /> : undefined}
              onSelect={() => overlay.open({ kind: "dlg", name: "pin", arg: profile.id })}
            >
              {profile.displayName}
            </MenuItem>
          ))}
          <MenuSeparator />
        </>
      ) : null}
      <MenuItem icon={<Icon icon={SettingsIcon} />} link={{ to: "/settings" }}>
        {m.nav_settings()}
      </MenuItem>
      {admin ? (
        <MenuItem
          icon={<Icon icon={UsersIcon} />}
          link={{ to: "/settings/$section", params: { section: "users" } }}
        >
          {m.account_people_devices()}
        </MenuItem>
      ) : null}
      {fine ? (
        <MenuItem
          icon={<Icon icon={KeyboardIcon} />}
          onSelect={() => overlay.open({ kind: "dlg", name: "keys" })}
        >
          {m.account_shortcuts()}
        </MenuItem>
      ) : null}
      <MenuSeparator />
      <MenuLabel>{m.theme_label()}</MenuLabel>
      <MenuRadioGroup
        value={theme}
        onValueChange={(value) => {
          if (isTheme(value)) setThemePreference(value);
        }}
      >
        <MenuRadioItem value="system" icon={<Icon icon={SystemThemeIcon} />}>
          {m.theme_system()}
        </MenuRadioItem>
        <MenuRadioItem value="light" icon={<Icon icon={LightIcon} />}>
          {m.theme_light()}
        </MenuRadioItem>
        <MenuRadioItem value="dark" icon={<Icon icon={DarkIcon} />}>
          {m.theme_dark()}
        </MenuRadioItem>
      </MenuRadioGroup>
      <MenuSeparator />
      <MenuLabel>{m.language_label()}</MenuLabel>
      <MenuRadioGroup
        value={language}
        onValueChange={(value) => {
          if (value === "system" || isLocale(value)) chooseLocale(value);
        }}
      >
        <MenuRadioItem value="system">{m.language_system()}</MenuRadioItem>
        {locales.map((locale) => (
          <MenuRadioItem key={locale} value={locale}>
            {languageName(locale)}
          </MenuRadioItem>
        ))}
      </MenuRadioGroup>
      <MenuSeparator />
      <MenuItem
        icon={<Icon icon={SignOutIcon} />}
        onSelect={() =>
          logout.mutate(undefined, {
            onSettled: () => void navigate({ to: "/login", replace: true }),
          })
        }
      >
        {m.shell_sign_out()}
      </MenuItem>
    </ResponsiveMenu>
  );
}
