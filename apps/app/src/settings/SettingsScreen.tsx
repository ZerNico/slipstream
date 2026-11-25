import { type FitMode, type QualityChoice, qualityChoices } from "@slipstream/domain";
import { deviceQualityLabel, languageName, locales, m } from "@slipstream/i18n";
import { useQuery } from "@tanstack/react-query";
import * as Network from "expo-network";
import { type Href, useRouter } from "expo-router";
import { type ReactNode, useState } from "react";
import { Alert, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useApiQueries } from "../data/hooks.ts";
import { chooseLanguage, type LanguageChoice, useLanguageChoice } from "../i18n/locale.ts";
import { networkKindFor } from "../player/playback.ts";
import { savePrefs, usePlayerPrefs } from "../player/player-prefs.ts";
import { useSession } from "../session/session-context.ts";
import { useTheme } from "../theme/theme.ts";
import { OptionRow } from "../ui/OptionRow.tsx";
import { PickerSheet } from "../ui/PickerSheet.tsx";
import { PhoneHandoff } from "../tv/PhoneHandoff.tsx";
import type { IconName } from "../ui/Icon.tsx";
import { useReturnFocus } from "../tv/library/use-tv-navigation.ts";
import { Rail, RailContent } from "../tv/Rail.tsx";
import { TvTitle } from "../tv/TvStatus.tsx";
import {
  householdDefaultLine,
  type HouseholdRow,
  type ProfileRow,
  rowKeys,
  settingsRows,
} from "./settings-groups.ts";

/**
 * A page of Settings: its route (pushed on phones, the phone hand-off's deep link on TV), its
 * icon and its title (the web's words).
 */
interface Page {
  readonly path: Extract<Href, string>;
  readonly icon: IconName;
  readonly title: () => string;
}

const householdPages: Readonly<Record<HouseholdRow, Page>> = {
  sources: { path: "/settings/sources", icon: "guide", title: () => m.settings_section_sources() },
  recording: {
    path: "/settings/recording",
    icon: "rec",
    title: () => m.settings_section_recording(),
  },
  users: { path: "/settings/users", icon: "user", title: () => m.settings_section_users() },
  playback: {
    path: "/settings/playback",
    icon: "speed",
    title: () => m.settings_section_default_quality(),
  },
  storage: { path: "/settings/storage", icon: "server", title: () => m.settings_section_storage() },
};

const profilePage: Page = {
  path: "/settings/profile",
  icon: "user",
  title: () => m.settings_section_profile(),
};

const languageChoices: readonly LanguageChoice[] = ["system", ...locales];

/** A choice as the picker names it: each language in its own words, the system's in the current one. */
const choiceName = (choice: LanguageChoice): string =>
  choice === "system" ? m.language_system() : languageName(choice);

const fitName = (fit: FitMode): string =>
  fit === "fit" ? m.player_fit_short() : m.player_fill_short();

/** What is picked in a sheet over the list. */
type Picking = "language" | "quality" | "fit";

/** A group's heading, and for the household the line saying whom it applies to. */
const GroupHeading = ({ title, note }: { readonly title: string; readonly note?: string }) => {
  const { colors, em, fonts, isTV } = useTheme();
  const size = isTV ? 1.2 : 1;
  return (
    <View style={{ paddingHorizontal: em, gap: 0.15 * em, marginBottom: -0.6 * size * em }}>
      <Text
        accessibilityRole="header"
        numberOfLines={1}
        style={{ fontFamily: fonts.fUiSemiBold, fontSize: 0.85 * size * em, color: colors.fg3 }}
      >
        {title}
      </Text>
      {note === undefined ? null : (
        <Text style={{ fontFamily: fonts.fUi, fontSize: 0.85 * size * em, color: colors.fg3 }}>
          {note}
        </Text>
      )}
    </View>
  );
};

/**
 * Settings as a grouped list, the same groups as the web: who is signed in on which server at
 * the top; This device (its language, its video quality and Fit or Fill, the same choices the
 * player's Options make, linking a TV on phones, choosing another server); Your profile (the
 * profile page, switching or adding a profile, signing out); and for an admin the Household's
 * sections, which apply to everyone (on TV each opens on the phone). The rail on TV; on phones
 * the tab bar comes from the tabs layout.
 */
export const SettingsScreen = () => {
  const { colors, em, fonts, isTV, radii } = useTheme();
  const insets = useSafeAreaInsets();
  const session = useSession();
  const router = useRouter();
  const queries = useApiQueries();
  const prefs = usePlayerPrefs();
  const network = networkKindFor(Network.useNetworkState().type);
  // TV: the page whose phone hand-off is open.
  const [handoff, setHandoff] = useState<Page | undefined>(undefined);
  const [picking, setPicking] = useState<Picking | undefined>(undefined);
  const language = useLanguageChoice();
  const size = isTV ? 1.2 : 1;
  const name = session.account?.displayName ?? "";
  const server = session.stored.server?.name ?? "";
  const admin = session.account?.role === "admin";
  const rows = settingsRows({ admin, tv: isTV, shared: session.stored.accounts.length > 1 });
  // What "Household default" stands for here; everyone may read the household's defaults.
  const household = useQuery(queries.playbackSettings());
  const initials = name
    .split(/\s+/u)
    .map((part) => part.charAt(0))
    .join("")
    .slice(0, 2)
    .toUpperCase();
  const panel = {
    borderRadius: radii.rL,
    backgroundColor: colors.surface,
    padding: 0.4 * em,
    gap: 0.2 * em,
  } as const;
  // TV: focus starts on the first row, and comes back to a row after its sheet or hand-off.
  const keys = rowKeys(rows);
  const { target, opening } = useReturnFocus({
    keys,
    first: keys[0],
    covered: handoff !== undefined || picking !== undefined,
  });
  const pick = (what: Picking) => {
    opening(what);
    setPicking(what);
  };
  const open = (key: string, page: Page) => {
    if (!isTV) {
      router.push(page.path);
      return;
    }
    opening(key);
    setHandoff(page);
  };

  const deviceRow = (row: (typeof rows.device)[number]): ReactNode => {
    switch (row) {
      case "language":
        return (
          <OptionRow
            key={row}
            icon="globe"
            title={m.language_label()}
            hint={choiceName(language)}
            preferredFocus={target === row}
            onPress={() => pick("language")}
          />
        );
      case "quality":
        return (
          <OptionRow
            key={row}
            icon="speed"
            title={m.player_quality()}
            hint={deviceQualityLabel(prefs.quality)}
            preferredFocus={target === row}
            onPress={() => pick("quality")}
          />
        );
      case "fit":
        return (
          <OptionRow
            key={row}
            icon="settings"
            title={m.player_picture_heading()}
            hint={fitName(prefs.fit)}
            preferredFocus={target === row}
            onPress={() => pick("fit")}
          />
        );
      case "link":
        return (
          <OptionRow
            key={row}
            icon="tv"
            title={m.device_link_tv()}
            onPress={() => router.push("/link")}
          />
        );
      case "server":
        return (
          <OptionRow
            key={row}
            icon="server"
            title={m.settings_change_server()}
            preferredFocus={target === row}
            onPress={session.forgetServer}
          />
        );
    }
  };

  const profileRow = (row: ProfileRow): ReactNode => {
    switch (row) {
      case "profile":
        return (
          <OptionRow
            key={row}
            icon={profilePage.icon}
            title={m.settings_profile_edit()}
            hint={isTV ? m.handoff_on_phone() : undefined}
            preferredFocus={target === row}
            onPress={() => open(row, profilePage)}
          />
        );
      case "switch":
        return (
          <OptionRow
            key={row}
            icon="user"
            title={m.account_switch_profile()}
            preferredFocus={target === row}
            onPress={session.switchProfile}
          />
        );
      case "add":
        return (
          <OptionRow
            key={row}
            icon="plus"
            title={m.profiles_add()}
            preferredFocus={target === row}
            onPress={session.addProfile}
          />
        );
      case "signOut":
        return (
          <OptionRow
            key={row}
            icon="signOut"
            title={m.shell_sign_out()}
            preferredFocus={target === row}
            onPress={() =>
              // One tap is too easy to make by mistake: a native confirm first.
              Alert.alert(
                m.settings_sign_out_question({ name, server }),
                m.settings_sign_out_text(),
                [
                  { text: m.action_cancel(), style: "cancel" },
                  { text: m.shell_sign_out(), style: "destructive", onPress: session.signOut },
                ],
              )
            }
          />
        );
    }
  };

  const list = (
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={{
        paddingTop: insets.top + (isTV ? 2.7 : 1) * em,
        paddingBottom: isTV ? insets.bottom + 2 * em : 1.5 * em,
        // On TV the list sits in RailContent, which starts at the rail's edge.
        paddingLeft: (isTV ? 3 : 1.1) * em,
        paddingRight: (isTV ? 4 : 1.1) * em,
        gap: 1.2 * size * em,
      }}
    >
      {isTV ? (
        <TvTitle>{m.nav_settings()}</TvTitle>
      ) : (
        <Text
          accessibilityRole="header"
          style={{ fontFamily: fonts.fUiSemiBold, fontSize: 1.9 * size * em, color: colors.fg }}
        >
          {m.nav_settings()}
        </Text>
      )}
      <View style={{ maxWidth: isTV ? 44 * em : undefined, gap: 1.2 * size * em }}>
        {/* Who you are, where: the account card. */}
        <View style={[panel, { flexDirection: "row", alignItems: "center", gap: em, padding: em }]}>
          <View
            style={{
              width: 3 * size * em,
              height: 3 * size * em,
              borderRadius: 1.5 * size * em,
              backgroundColor: colors.brand,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Text
              style={{
                fontFamily: fonts.fUiSemiBold,
                fontSize: 1.1 * size * em,
                color: colors.onBrand,
              }}
            >
              {initials}
            </Text>
          </View>
          <View style={{ flex: 1, gap: 0.15 * em }}>
            <Text
              numberOfLines={1}
              style={{
                fontFamily: fonts.fUiSemiBold,
                fontSize: 1.1 * size * em,
                color: colors.fg,
              }}
            >
              {name}
            </Text>
            <Text
              numberOfLines={1}
              style={{ fontFamily: fonts.fUi, fontSize: 0.9 * size * em, color: colors.fg2 }}
            >
              {server}
            </Text>
          </View>
        </View>
        {/* What this device remembers for itself, whoever is signed in on it. */}
        <GroupHeading title={m.settings_section_device()} />
        <View style={panel}>{rows.device.map(deviceRow)}</View>
        <GroupHeading title={m.settings_section_profile()} />
        <View style={panel}>{rows.profile.map(profileRow)}</View>
        {/* The household's settings, as the web's sections: forms, so on TV each opens on
              the phone. Only an admin has them. */}
        {rows.household.length === 0 ? null : (
          <>
            <GroupHeading title={m.settings_group_server()} note={m.settings_group_server_note()} />
            <View style={panel}>
              {rows.household.map((row) => {
                const page = householdPages[row];
                return (
                  <OptionRow
                    key={row}
                    icon={page.icon}
                    title={page.title()}
                    hint={isTV ? m.handoff_on_phone() : undefined}
                    preferredFocus={target === row}
                    onPress={() => open(row, page)}
                  />
                );
              })}
            </View>
          </>
        )}
      </View>
    </ScrollView>
  );
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      {isTV ? (
        <>
          <Rail current="settings" />
          <RailContent>{list}</RailContent>
        </>
      ) : (
        list
      )}
      {picking === "language" ? (
        <PickerSheet
          title={m.language_label()}
          choices={languageChoices.map((option) => ({ value: option, label: choiceName(option) }))}
          selected={language}
          onPick={chooseLanguage}
          onClose={() => setPicking(undefined)}
        />
      ) : null}
      {picking === "quality" ? (
        <PickerSheet<QualityChoice>
          title={m.player_quality()}
          choices={qualityChoices.map((quality) => ({
            value: quality,
            label: deviceQualityLabel(quality),
            hint:
              quality === "auto"
                ? householdDefaultLine(household.data?.quality, network)
                : undefined,
          }))}
          selected={prefs.quality}
          onPick={(quality) => savePrefs({ quality })}
          onClose={() => setPicking(undefined)}
        />
      ) : null}
      {picking === "fit" ? (
        <PickerSheet<FitMode>
          title={m.player_picture_heading()}
          choices={(["fit", "fill"] as const).map((fit) => ({ value: fit, label: fitName(fit) }))}
          selected={prefs.fit}
          onPick={(fit) => savePrefs({ fit })}
          onClose={() => setPicking(undefined)}
        />
      ) : null}
      {handoff === undefined ? null : (
        <PhoneHandoff
          title={handoff.title()}
          path={handoff.path}
          onClose={() => setHandoff(undefined)}
        />
      )}
    </View>
  );
};
