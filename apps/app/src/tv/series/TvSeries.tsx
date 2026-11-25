import { m, seriesCardLine } from "@slipstream/i18n";
import { useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { nextLine, type SeriesItem, useSeries } from "../../series/use-series.ts";
import { useTheme } from "../../theme/theme.ts";
import { Chip } from "../../ui/Chip.tsx";
import { FocusButton } from "../../ui/FocusButton.tsx";
import { useNow } from "../../ui/use-now.ts";
import { useReturnFocus } from "../library/use-tv-navigation.ts";
import { PhoneHandoff } from "../PhoneHandoff.tsx";
import { Rail, RailContent } from "../Rail.tsx";
import { ListBones, TvSkeleton, TvStatus, TvTitle } from "../TvStatus.tsx";
import { SeriesToggle } from "./SeriesToggle.tsx";
import { newSeriesHref, seriesHref } from "../../routes.ts";

/** The focus key of the New button, apart from series ids. */
const NEW_KEY = "new";

/** One series recording in the list: OK opens its page; amber while it has focus. */
const SeriesRow = ({
  item,
  names,
  now,
  preferredFocus,
  onOpen,
}: {
  readonly item: SeriesItem;
  readonly names: ReadonlyMap<string, string>;
  readonly now: number;
  readonly preferredFocus: boolean;
  readonly onOpen: () => void;
}) => {
  const { colors, em, fonts, radii } = useTheme();
  const [focused, setFocused] = useState(false);
  const { rule } = item;
  const fg = focused ? colors.onBrand : rule.enabled ? colors.fg : colors.fg3;
  const quiet = focused ? colors.onBrand : colors.fg2;
  return (
    <Pressable
      onPress={onOpen}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      hasTVPreferredFocus={preferredFocus}
      accessibilityRole="button"
      accessibilityLabel={rule.name}
      style={{
        flex: 1,
        gap: 0.3 * em,
        paddingVertical: 0.9 * em,
        paddingHorizontal: 1.2 * em,
        borderRadius: radii.rM,
        backgroundColor: focused ? colors.brand : colors.surface,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 0.7 * em }}>
        <Text
          numberOfLines={1}
          style={{ flexShrink: 1, fontFamily: fonts.fUiSemiBold, fontSize: 1.3 * em, color: fg }}
        >
          {rule.name}
        </Text>
        {rule.enabled ? null : <Chip label={m.series_paused()} tone="outline" />}
      </View>
      <Text numberOfLines={1} style={{ fontFamily: fonts.fUi, fontSize: em, color: quiet }}>
        {seriesCardLine(
          rule.matcher.channels.map((id) => names.get(id) ?? id),
          rule.matcher.weekdays,
        )}
      </Text>
      <Text
        numberOfLines={1}
        style={{
          fontFamily: fonts.fUi,
          fontSize: em,
          color: focused ? colors.onBrand : colors.fg3,
        }}
      >
        {[nextLine(item, now), m.series_card_recorded({ count: item.recorded.length })].join(" · ")}
      </Text>
    </Pressable>
  );
};

/**
 * The series recordings on TV (the web's Series recordings): each with its channels and days,
 * what comes next and how many it recorded, Pause or Resume beside it, and OK opens its page.
 * A new one is made from the guide's "Record series", or on the phone through the hand-off.
 * Back from a page or the hand-off, focus returns to what opened it.
 */
export const TvSeries = () => {
  const { colors, em, fonts } = useTheme();
  const router = useRouter();
  const now = useNow(60_000);
  const series = useSeries();
  const [handoff, setHandoff] = useState(false);
  const keys = series.items.map((item) => item.rule.id);
  const { target, opening } = useReturnFocus({
    keys: [NEW_KEY, ...keys],
    first: keys[0] ?? NEW_KEY,
    covered: handoff,
  });

  if (series.loading) {
    return (
      <TvSkeleton current="recordings" title={m.series_title()}>
        <ListBones />
      </TvSkeleton>
    );
  }
  if (series.error !== null && series.items.length === 0) {
    return <TvStatus current="recordings" title={m.series_error_title()} onRetry={series.retry} />;
  }
  const empty = series.items.length === 0;

  return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.bg }]}>
      <Rail current="recordings" />
      <RailContent>
        <ScrollView
          style={StyleSheet.absoluteFill}
          contentContainerStyle={{
            paddingLeft: 3 * em,
            paddingRight: 4 * em,
            paddingTop: 2.7 * em,
            paddingBottom: 3 * em,
            gap: 1.6 * em,
          }}
        >
          <View style={{ flexDirection: "row", alignItems: "center", gap: 2 * em }}>
            <TvTitle>{m.series_title()}</TvTitle>
            <View style={{ marginLeft: "auto" }}>
              <FocusButton
                label={m.series_new()}
                icon="plus"
                variant="ghost"
                preferredFocus={target === NEW_KEY}
                onPress={() => {
                  opening(NEW_KEY);
                  setHandoff(true);
                }}
              />
            </View>
          </View>
          {empty ? (
            <Text
              style={{
                fontFamily: fonts.fUiSemiBold,
                fontSize: 2 * em,
                color: colors.fg,
                maxWidth: 50 * em,
              }}
            >
              {m.series_empty()}
            </Text>
          ) : null}
          <View style={{ gap: 0.7 * em, maxWidth: 70 * em }}>
            {series.items.map((item) => (
              <View
                key={item.rule.id}
                style={{ flexDirection: "row", alignItems: "center", gap: 1.2 * em }}
              >
                <SeriesRow
                  item={item}
                  names={series.names}
                  now={now}
                  preferredFocus={target === item.rule.id}
                  onOpen={() => {
                    opening(item.rule.id);
                    router.push(seriesHref(item.rule.id));
                  }}
                />
                {item.mine ? (
                  <SeriesToggle
                    rule={item.rule}
                    onToggle={(enabled) => series.setEnabled(item.rule, enabled)}
                  />
                ) : (
                  // Someone else's: the space stays, so every row lines up.
                  <View style={{ minWidth: 9.5 * em }} />
                )}
              </View>
            ))}
          </View>
        </ScrollView>
      </RailContent>
      {handoff ? (
        <PhoneHandoff
          title={m.series_new()}
          path={newSeriesHref}
          onClose={() => setHandoff(false)}
        />
      ) : null}
    </View>
  );
};
