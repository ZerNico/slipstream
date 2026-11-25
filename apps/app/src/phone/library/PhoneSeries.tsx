import { m, seriesCardLine } from "@slipstream/i18n";
import { useRouter } from "expo-router";
import { FlatList, Pressable, Switch, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "../../theme/theme.ts";
import { Hairline } from "../ui/settings.tsx";
import { Chip } from "../../ui/Chip.tsx";
import { FocusButton } from "../../ui/FocusButton.tsx";
import { useNow } from "../../ui/use-now.ts";
import { BackHeader } from "../BackHeader.tsx";
import { EmptyState } from "../EmptyState.tsx";
import { PageStatus } from "../ui/PageStatus.tsx";
import { ListSkeleton } from "../PhoneSkeletons.tsx";
import { nextLine, useSeries } from "../../series/use-series.ts";
import { newSeriesHref, seriesHref } from "../../routes.ts";

/**
 * The series recordings on a phone (the web's Series recordings): each with its channels and
 * days, what comes next and how many it recorded, and a switch to pause it. A tap opens it.
 */
export const PhoneSeries = () => {
  const { colors, em, fonts } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const now = useNow(60_000);
  const series = useSeries();
  if (series.loading) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg }}>
        <BackHeader title={m.series_title()} />
        <ListSkeleton />
      </View>
    );
  }
  if (series.error !== null) {
    return (
      <PageStatus
        heading={m.series_title()}
        title={m.series_error_title()}
        onRetry={series.retry}
      />
    );
  }
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <BackHeader
        title={m.series_title()}
        action={
          // Only the plus: "Neue Serienaufnahme" beside "Serienaufnahmen" would cut the title.
          <FocusButton
            label={m.series_new()}
            icon="plus"
            iconOnly
            size={0.85}
            onPress={() => router.push(newSeriesHref)}
          />
        }
      />
      <FlatList
        data={series.items}
        keyExtractor={(item) => item.rule.id}
        contentContainerStyle={{ flexGrow: 1, paddingBottom: insets.bottom + 1.5 * em }}
        ListEmptyComponent={<EmptyState title={m.series_empty()} />}
        ItemSeparatorComponent={Hairline}
        renderItem={({ item }) => (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={item.rule.name}
            onPress={() => router.push(seriesHref(item.rule.id))}
            style={({ pressed }) => ({
              flexDirection: "row",
              alignItems: "center",
              gap: 0.8 * em,
              paddingHorizontal: em,
              paddingVertical: 0.9 * em,
              backgroundColor: pressed ? colors.surface : "transparent",
            })}
          >
            <View style={{ flex: 1, gap: 0.25 * em }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 0.5 * em }}>
                <Text
                  numberOfLines={1}
                  style={{
                    flexShrink: 1,
                    fontFamily: fonts.fUiSemiBold,
                    fontSize: em,
                    color: item.rule.enabled ? colors.fg : colors.fg3,
                  }}
                >
                  {item.rule.name}
                </Text>
                {item.rule.enabled ? null : (
                  <View style={{ flexShrink: 0 }}>
                    <Chip label={m.series_paused()} tone="outline" size={0.7} />
                  </View>
                )}
              </View>
              <Text
                numberOfLines={1}
                style={{ fontFamily: fonts.fUi, fontSize: 0.85 * em, color: colors.fg2 }}
              >
                {seriesCardLine(
                  item.rule.matcher.channels.map((id) => series.names.get(id) ?? id),
                  item.rule.matcher.weekdays,
                )}
              </Text>
              <Text
                numberOfLines={1}
                style={{ fontFamily: fonts.fUi, fontSize: 0.82 * em, color: colors.fg3 }}
              >
                {[
                  nextLine(item, now),
                  m.series_card_recorded({ count: item.recorded.length }),
                ].join(" · ")}
              </Text>
            </View>
            {item.mine ? (
              <Switch
                accessibilityLabel={m.series_enabled_for({ name: item.rule.name })}
                value={item.rule.enabled}
                onValueChange={(next) => series.setEnabled(item.rule, next)}
                trackColor={{ true: colors.brand, false: colors.raised }}
                thumbColor={colors.fg}
              />
            ) : null}
          </Pressable>
        )}
      />
    </View>
  );
};
