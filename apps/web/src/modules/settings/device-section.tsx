import { useQuery } from "@tanstack/react-query";
import { householdDefaultHint, qualityChoices } from "@slipstream/domain";
import {
  deviceQualityLabel,
  householdDefaultHintText,
  languageName,
  locales,
  m,
} from "@slipstream/i18n";
import { useQueries } from "~/api/hooks.ts";
import { shapes, useKept } from "~/api/shape-cache.ts";
import { chooseLocale, useLocale } from "~/i18n/locale.ts";
import { savePrefs, usePlayerPrefs } from "~/modules/watch/player-prefs.ts";
import { networkKind } from "~/modules/watch/use-playback-session.ts";
import { Segmented } from "~/ui/controls.tsx";
import { Select } from "~/ui/primitives/select.tsx";
import { LoadingScope, Sk } from "~/ui/skeleton.tsx";
import { setThemePreference, useThemePreference } from "~/ui/theme.ts";
import { ListPanel, ListRow, SettingsSection } from "./parts.tsx";

/**
 * What "Household default" stands for on this browser: the household's default for this
 * connection, or the plain explanation when it cannot be read. While it loads, the line the
 * last answer this browser saw gave, as the placeholder's size.
 */
function useHouseholdDefaultLine() {
  const queries = useQueries();
  const household = useQuery(queries.playbackSettings());
  const kept = useKept(shapes.playbackSettings);
  const network = networkKind();
  const known = household.data ?? kept;
  return {
    loading: household.isPending,
    line:
      known === undefined
        ? m.quality_server_default_detail()
        : householdDefaultHintText(householdDefaultHint(known.quality, network)),
  };
}

/**
 * Settings › This device (SPEC §8.7): what this browser remembers for itself, for whoever signs
 * in on it. The theme, the language and the video quality, the same choice the player's Options
 * menu makes, so a change in either place shows in the other.
 */
export function DeviceSection() {
  const theme = useThemePreference();
  const locale = useLocale();
  const prefs = usePlayerPrefs();
  const household = useHouseholdDefaultLine();
  return (
    <LoadingScope loading={household.loading}>
      <SettingsSection title={m.settings_section_device()}>
        <ListPanel>
          <ListRow
            stackOnPhone
            title={m.theme_label()}
            end={
              <Segmented
                label={m.theme_label()}
                value={theme}
                onChange={setThemePreference}
                segments={[
                  { value: "system", label: m.theme_system() },
                  { value: "light", label: m.theme_light() },
                  { value: "dark", label: m.theme_dark() },
                ]}
              />
            }
          />
          <ListRow
            stackOnPhone
            title={m.language_label()}
            end={
              <Segmented
                label={m.language_label()}
                value={locale}
                onChange={chooseLocale}
                segments={locales.map((value) => ({ value, label: languageName(value) }))}
              />
            }
          />
          <ListRow
            stackOnPhone
            title={m.player_quality()}
            sub={
              prefs.quality === "auto" ? (
                <Sk placeholder={household.line}>{household.loading ? "" : household.line}</Sk>
              ) : undefined
            }
            end={
              <Select
                aria-label={m.player_quality()}
                className="w-[13.5rem] max-w-full"
                value={prefs.quality}
                options={qualityChoices.map((quality) => ({
                  value: quality,
                  label: deviceQualityLabel(quality),
                }))}
                onChange={(quality) => savePrefs({ quality })}
              />
            }
          />
        </ListPanel>
      </SettingsSection>
    </LoadingScope>
  );
}
