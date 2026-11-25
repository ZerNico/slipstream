import type { RecordingEntry } from "@slipstream/api";
import { epochMs, groupPage, renderSegment } from "@slipstream/domain";
import { m, pathLabels, whenLabel } from "@slipstream/i18n";
import { householdZone } from "../../data/zone.ts";
import { useRouter } from "expo-router";
import { useState } from "react";
import { FlatList, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { libraryCard } from "../../data/library.ts";
import { useTheme } from "../../theme/theme.ts";
import { useNow } from "../../ui/use-now.ts";
import { BackHeader } from "../BackHeader.tsx";
import { PageStatus } from "../ui/PageStatus.tsx";
import { ListSkeleton } from "../PhoneSkeletons.tsx";
import { EntryRow } from "./EntryRow.tsx";
import { useRecordings } from "../../recordings/use-recordings.ts";
import { recordingHref } from "../../routes.ts";

/** One line of a group's list: a section's heading or one of its recordings. */
type GroupItem =
  | { readonly kind: "heading"; readonly key: string; readonly title: string }
  | {
      readonly kind: "row";
      readonly key: string;
      readonly entry: RecordingEntry;
      readonly scheduled: boolean;
    };

/** A season chip: the shown season is filled. */
const SeasonChip = ({
  label,
  active,
  onPress,
}: {
  readonly label: string;
  readonly active: boolean;
  readonly onPress: () => void;
}) => {
  const { colors, em, fonts } = useTheme();
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityLabel={label}
      accessibilityState={{ selected: active }}
      hitSlop={0.3 * em}
      onPress={onPress}
      style={{
        height: 2.2 * em,
        paddingHorizontal: 0.9 * em,
        borderRadius: 1.1 * em,
        justifyContent: "center",
        backgroundColor: active ? colors.fg : colors.surface,
      }}
    >
      <Text
        numberOfLines={1}
        style={{
          fontFamily: fonts.fUiSemiBold,
          fontSize: 0.85 * em,
          color: active ? colors.bg : colors.fg2,
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
};

/**
 * A place of the library on a phone (the web's group page): its name and counts, the seasons
 * as chips when it has them, then its events or seasons as sections (what is scheduled to land
 * in one listed dimmed under it), or one list. A row opens the recording's page.
 */
export const PhoneGroup = ({ groupKey }: { readonly groupKey: string }) => {
  const { colors, em, fonts } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const now = useNow(60_000);
  const library = useRecordings();
  const [season, setSeason] = useState<string | undefined>(undefined);
  const labels = pathLabels();
  if (library.loading) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg }}>
        <BackHeader />
        <ListSkeleton title />
      </View>
    );
  }
  if (library.error !== null) {
    return <PageStatus title={m.library_error_title()} onRetry={library.retry} />;
  }
  const page = groupPage(groupKey, library.all, library.collections, labels, season);
  if (page === undefined) return <PageStatus title={m.library_group_missing()} />;
  // Its episodes as one virtualised list: section headings and rows in reading order.
  const items: readonly GroupItem[] =
    page.sections.length === 0
      ? page.flat.map((entry) => ({ kind: "row", key: entry.id, entry, scheduled: false }))
      : page.sections.flatMap((section): readonly GroupItem[] => [
          { kind: "heading", key: `heading:${section.key}`, title: section.title },
          ...section.entries.map((entry): GroupItem => ({
            kind: "row",
            key: entry.id,
            entry,
            scheduled: false,
          })),
          ...section.scheduled.map((entry): GroupItem => ({
            kind: "row",
            key: entry.id,
            entry,
            scheduled: true,
          })),
        ]);
  const row = (entry: RecordingEntry, scheduled: boolean) => (
    <EntryRow
      entry={entry}
      card={libraryCard(entry, library.names, labels)}
      title={renderSegment(entry.group.item, labels)}
      dim={scheduled}
      meta={
        scheduled
          ? m.library_scheduled_card({
              when: whenLabel(epochMs(entry.start), now, householdZone()),
            })
          : undefined
      }
      onPress={() => router.push(recordingHref(entry.id))}
    />
  );
  const heading = (title: string) => (
    <Text
      accessibilityRole="header"
      numberOfLines={2}
      style={{
        fontFamily: fonts.fUiSemiBold,
        fontSize: 1.05 * em,
        color: colors.fg,
        paddingHorizontal: em,
        paddingTop: 1.1 * em,
        paddingBottom: 0.3 * em,
      }}
    >
      {title}
    </Text>
  );
  const top = (
    <>
      <View style={{ paddingHorizontal: em, gap: 0.3 * em, paddingBottom: 0.4 * em }}>
        <Text
          accessibilityRole="header"
          numberOfLines={3}
          style={{ fontFamily: fonts.fUiSemiBold, fontSize: 1.7 * em, color: colors.fg }}
        >
          {page.group.name}
        </Text>
        <Text style={{ fontFamily: fonts.fUi, fontSize: 0.88 * em, color: colors.fg3 }}>
          {page.group.newCount === 0
            ? m.library_tile_count({ count: page.group.entries.length })
            : m.library_group_stats({
                count: page.group.entries.length,
                fresh: page.group.newCount,
              })}
        </Text>
      </View>
      {page.seasons.length === 0 ? null : (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          accessibilityRole="tablist"
          accessibilityLabel={m.library_season_label()}
          contentContainerStyle={{
            gap: 0.5 * em,
            paddingHorizontal: em,
            paddingVertical: 0.5 * em,
          }}
        >
          {page.seasons.map((name) => (
            <SeasonChip
              key={name}
              label={name}
              active={name === page.season}
              onPress={() => setSeason(name)}
            />
          ))}
        </ScrollView>
      )}
    </>
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <BackHeader />
      <FlatList
        data={items}
        keyExtractor={(item) => item.key}
        ListHeaderComponent={top}
        contentContainerStyle={{ paddingBottom: insets.bottom + 1.5 * em }}
        renderItem={({ item }) =>
          item.kind === "heading" ? heading(item.title) : row(item.entry, item.scheduled)
        }
      />
    </View>
  );
};
