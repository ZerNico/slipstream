import { epochMs } from "@slipstream/domain";
import { m, pathLabels, seriesCardLine } from "@slipstream/i18n";
import { useRouter } from "expo-router";
import { Alert, FlatList, Switch, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { libraryCard } from "../../data/library.ts";
import { ActionRow, Hairline, Panel } from "../ui/settings.tsx";
import { useTheme } from "../../theme/theme.ts";
import { BackHeader } from "../BackHeader.tsx";
import { PageStatus } from "../ui/PageStatus.tsx";
import { ListSkeleton } from "../PhoneSkeletons.tsx";
import { EntryRow } from "./EntryRow.tsx";
import { useSeries } from "../../series/use-series.ts";
import { editSeriesHref, recordingHref } from "../../routes.ts";

/**
 * A series recording on a phone: its name, channels and days, a switch to pause it, the extra
 * minutes, what it has scheduled and what it recorded, Edit, and Delete with a native confirm.
 */
export const PhoneSeriesDetail = ({ id }: { readonly id: string }) => {
  const { colors, em, fonts, radii } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const series = useSeries();
  const labels = pathLabels();
  if (series.loading) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg }}>
        <BackHeader />
        <ListSkeleton title />
      </View>
    );
  }
  if (series.error !== null) {
    return <PageStatus title={m.series_error_title()} onRetry={series.retry} />;
  }
  const item = series.items.find((candidate) => candidate.rule.id === id);
  if (item === undefined) return <PageStatus title={m.series_not_found()} />;
  const { rule } = item;
  const askDelete = () =>
    Alert.alert(m.series_delete_title({ name: rule.name }), m.series_delete_text(), [
      { text: m.series_delete_keep(), style: "cancel" },
      {
        text: m.series_delete_yes(),
        style: "destructive",
        onPress: () => {
          void series.remove(rule);
          router.back();
        },
      },
    ]);
  const heading = (text: string) => (
    <Text
      accessibilityRole="header"
      style={{
        fontFamily: fonts.fUiSemiBold,
        fontSize: 1.05 * em,
        color: colors.fg,
        paddingHorizontal: em,
        paddingTop: 1.3 * em,
        paddingBottom: 0.3 * em,
      }}
    >
      {text}
    </Text>
  );
  const panelRow = (label: string, value: string) => (
    <View
      style={{
        flexDirection: "row",
        justifyContent: "space-between",
        gap: 0.8 * em,
        paddingHorizontal: em,
        paddingVertical: 0.8 * em,
      }}
    >
      <Text
        style={{ flexShrink: 1, fontFamily: fonts.fUi, fontSize: 0.95 * em, color: colors.fg2 }}
      >
        {label}
      </Text>
      <Text
        numberOfLines={1}
        style={{ fontFamily: fonts.fUiSemiBold, fontSize: 0.95 * em, color: colors.fg }}
      >
        {value}
      </Text>
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <BackHeader />
      <FlatList
        data={item.recorded}
        keyExtractor={(entry) => entry.id}
        contentContainerStyle={{ paddingBottom: insets.bottom + 2 * em }}
        renderItem={({ item: entry }) => (
          <EntryRow
            entry={entry}
            card={libraryCard(entry, series.names, labels)}
            onPress={() => router.push(recordingHref(entry.id))}
          />
        )}
        ListHeaderComponent={
          <>
            <View style={{ paddingHorizontal: em, gap: 0.35 * em }}>
              <Text
                accessibilityRole="header"
                style={{ fontFamily: fonts.fUiSemiBold, fontSize: 1.7 * em, color: colors.fg }}
              >
                {rule.name}
              </Text>
              <Text style={{ fontFamily: fonts.fUi, fontSize: 0.92 * em, color: colors.fg2 }}>
                {seriesCardLine(
                  rule.matcher.channels.map((channel) => series.names.get(channel) ?? channel),
                  rule.matcher.weekdays,
                )}
              </Text>
            </View>
            <View
              style={{
                marginTop: 1.1 * em,
                marginHorizontal: em,
                borderRadius: radii.rL,
                backgroundColor: colors.surface,
                overflow: "hidden",
              }}
            >
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  paddingHorizontal: em,
                  paddingVertical: 0.6 * em,
                }}
              >
                <Text
                  style={{
                    flex: 1,
                    fontFamily: fonts.fUiSemiBold,
                    fontSize: 0.98 * em,
                    color: colors.fg,
                  }}
                >
                  {rule.enabled ? m.series_turned_on() : m.series_turned_off()}
                </Text>
                <Switch
                  accessibilityLabel={m.series_enabled_for({ name: rule.name })}
                  disabled={!item.mine}
                  value={rule.enabled}
                  onValueChange={(next) => series.setEnabled(rule, next)}
                  trackColor={{ true: colors.brand, false: colors.raised }}
                  thumbColor={colors.fg}
                />
              </View>
              <Hairline />
              {panelRow(
                m.padding_before(),
                m.series_minutes({ minutes: rule.padding.beforeMinutes }),
              )}
              <Hairline />
              {panelRow(
                m.padding_after(),
                m.series_minutes({ minutes: rule.padding.afterMinutes }),
              )}
            </View>
            {item.upcoming.length === 0 ? null : heading(m.library_title_scheduled())}
            {item.upcoming.map((entry) => (
              <EntryRow
                key={entry.id}
                entry={entry}
                card={libraryCard(entry, series.names, labels)}
                dim
                meta={m.recordings_slot({
                  start: new Date(epochMs(entry.start)),
                  end: new Date(epochMs(entry.end)),
                })}
                onPress={() => router.push(recordingHref(entry.id))}
              />
            ))}
            {item.recorded.length === 0
              ? null
              : heading(m.series_card_recorded({ count: item.recorded.length }))}
          </>
        }
        ListFooterComponent={
          // Edit and Delete are the owner's (or an admin's); without them no empty panel.
          !item.mine ? undefined : (
            <View style={{ marginTop: 1.5 * em }}>
              <Panel>
                <ActionRow
                  icon="series"
                  title={m.series_title_edit()}
                  onPress={() => router.push(editSeriesHref(rule.id))}
                />
                <Hairline />
                <ActionRow
                  icon="delete"
                  title={m.action_delete()}
                  tone="danger"
                  onPress={askDelete}
                />
              </Panel>
            </View>
          )
        }
      />
    </View>
  );
};
