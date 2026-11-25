import type { RecordingEntry } from "@slipstream/api";
import type { LibraryGroup } from "@slipstream/domain";
import { m, pathLabels } from "@slipstream/i18n";
import { FlashList } from "@shopify/flash-list";
import { useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, ScrollView, Text, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { pictureFor } from "../../data/artwork.ts";
import { cardMeta, libraryCard } from "../../data/library.ts";
import { useTheme } from "../../theme/theme.ts";
import { Chip } from "../../ui/Chip.tsx";
import { FocusButton } from "../../ui/FocusButton.tsx";
import { Icon, type IconName } from "../../ui/Icon.tsx";
import { StatusScreen } from "../../ui/StatusScreen.tsx";
import { EmptyState } from "../EmptyState.tsx";
import { Thumb } from "../Thumb.tsx";
import { LibrarySkeleton } from "../PhoneSkeletons.tsx";
import { type LibraryFilter } from "../../data/library.ts";
import { useLibraryView } from "../../recordings/use-recordings.ts";
import { useNow } from "../../ui/use-now.ts";
import { groupHref, recordingHref } from "../../routes.ts";

/** A link row under the title: Scheduled, Needs attention, with its count. */
const LinkRow = ({
  icon,
  label,
  count,
  tone,
  onPress,
}: {
  readonly icon: IconName;
  readonly label: string;
  readonly count: number;
  readonly tone?: "warn" | undefined;
  readonly onPress: () => void;
}) => {
  const { colors, em, fonts } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}, ${count}`}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: 0.8 * em,
        paddingHorizontal: 0.9 * em,
        paddingVertical: 0.8 * em,
        backgroundColor: pressed ? colors.raised : "transparent",
      })}
    >
      <Icon name={icon} size={1.3 * em} color={tone === "warn" ? colors.warnText : colors.fg2} />
      <Text
        numberOfLines={1}
        style={{ flex: 1, fontFamily: fonts.fUiSemiBold, fontSize: 0.9 * em, color: colors.fg }}
      >
        {label}
      </Text>
      <Text style={{ fontFamily: fonts.fMono, fontSize: 0.85 * em, color: colors.fg3 }}>
        {count}
      </Text>
    </Pressable>
  );
};

/** A place of the library as a tile: the newest recording's picture, the name and the counts. */
const GroupTile = ({
  group,
  onPress,
}: {
  readonly group: LibraryGroup<RecordingEntry>;
  readonly onPress: () => void;
}) => {
  const { colors, em, fonts } = useTheme();
  // The newest recording with a picture, else the newest (a running one may have none yet).
  const newest = group.entries.find((entry) => pictureFor(entry) !== undefined) ?? group.entries[0];
  if (newest === undefined) return null;
  const counts = [
    m.library_tile_count({ count: group.entries.length }),
    ...(group.newCount > 0 ? [m.library_tile_new({ count: group.newCount })] : []),
  ].join(" · ");
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${group.name}, ${counts}`}
      onPress={onPress}
      style={({ pressed }) => ({ gap: 0.4 * em, opacity: pressed ? 0.7 : 1 })}
    >
      <Thumb subject={newest} />
      <Text
        numberOfLines={1}
        style={{ fontFamily: fonts.fUiSemiBold, fontSize: 0.92 * em, color: colors.fg }}
      >
        {group.name}
      </Text>
      <Text
        numberOfLines={1}
        style={{ fontFamily: fonts.fUi, fontSize: 0.8 * em, color: colors.fg3 }}
      >
        {counts}
      </Text>
    </Pressable>
  );
};

/**
 * The phone library (the web's "Collections & shows" on a phone): the title with All and
 * Unwatched, Scheduled, Series recordings and Problems as links, what records now as a row of pictures, then
 * every place as a two-column grid of tiles. A place with one recording opens that recording's
 * page; one with more opens the place.
 */
export const PhoneLibrary = () => {
  const { colors, em, fonts, radii } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { width } = useWindowDimensions();
  const [filter, setFilter] = useState<LibraryFilter>("all");
  const now = useNow(60_000);
  const library = useLibraryView(filter, now);
  const labels = pathLabels();

  if (library.loading) {
    return (
      <View
        style={{ flex: 1, backgroundColor: colors.bg, paddingTop: insets.top + em, gap: 0.8 * em }}
      >
        <Text
          style={{
            fontFamily: fonts.fUiSemiBold,
            fontSize: 1.9 * em,
            color: colors.fg,
            paddingHorizontal: em,
          }}
        >
          {m.nav_recordings()}
        </Text>
        <LibrarySkeleton />
      </View>
    );
  }
  if (library.error !== null) {
    return (
      <StatusScreen
        title={m.error_unexpected()}
        actions={<FocusButton label={m.action_try_again()} onPress={library.retry} />}
      />
    );
  }
  const side = em;
  const gap = 0.8 * em;
  const runningWidth = Math.min(15 * em, width * 0.7);
  const openGroup = (group: LibraryGroup<RecordingEntry>) => {
    const only = group.entries.length === 1 ? group.entries[0] : undefined;
    router.push(only === undefined ? groupHref(group.key) : recordingHref(only.id));
  };

  const header = (
    <View style={{ gap: 1.1 * em, paddingBottom: 0.6 * em }}>
      <View style={{ paddingHorizontal: side, gap: 0.8 * em }}>
        <Text
          accessibilityRole="header"
          numberOfLines={1}
          style={{ fontFamily: fonts.fUiSemiBold, fontSize: 1.9 * em, color: colors.fg }}
        >
          {m.nav_recordings()}
        </Text>
        <View accessibilityRole="radiogroup" style={{ flexDirection: "row", gap: 0.5 * em }}>
          <FocusButton
            label={m.recordings_filter_all()}
            variant={filter === "all" ? "default" : "ghost"}
            size={0.85}
            selected={filter === "all"}
            onPress={() => setFilter("all")}
          />
          <FocusButton
            label={m.recordings_filter_unwatched()}
            variant={filter === "unwatched" ? "default" : "ghost"}
            size={0.85}
            selected={filter === "unwatched"}
            onPress={() => setFilter("unwatched")}
          />
        </View>
        <View
          style={{ borderRadius: radii.rL, backgroundColor: colors.surface, overflow: "hidden" }}
        >
          <LinkRow
            icon="clock"
            label={m.library_title_scheduled()}
            count={library.scheduled}
            onPress={() => router.push("/recordings/scheduled")}
          />
          <LinkRow
            icon="series"
            label={m.series_title()}
            count={library.series}
            onPress={() => router.push("/recordings/series")}
          />
          <LinkRow
            icon="warn"
            label={m.recordings_tab_problems()}
            count={library.attention}
            tone={library.attention > 0 ? "warn" : undefined}
            onPress={() => router.push("/recordings/problems")}
          />
        </View>
      </View>
      {library.running.length === 0 ? null : (
        <View style={{ gap: 0.6 * em }}>
          <Text
            style={{
              fontFamily: fonts.fUiSemiBold,
              fontSize: 1.1 * em,
              color: colors.fg,
              paddingHorizontal: side,
            }}
          >
            {m.recordings_recording_now()}
          </Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap, paddingHorizontal: side }}
          >
            {library.running.map((entry) => {
              const card = libraryCard(entry, library.names, labels);
              return (
                <Pressable
                  key={entry.id}
                  accessibilityRole="button"
                  accessibilityLabel={entry.title}
                  onPress={() => router.push(recordingHref(entry.id))}
                  style={{ width: runningWidth, gap: 0.4 * em }}
                >
                  <Thumb
                    subject={entry}
                    width={runningWidth}
                    badge={<Chip label={m.status_recording()} tone="rec" size={0.72} />}
                  />
                  <Text
                    numberOfLines={1}
                    style={{ fontFamily: fonts.fUiSemiBold, fontSize: 0.92 * em, color: colors.fg }}
                  >
                    {entry.title}
                  </Text>
                  <Text
                    numberOfLines={1}
                    style={{ fontFamily: fonts.fUi, fontSize: 0.8 * em, color: colors.fg3 }}
                  >
                    {cardMeta(card)}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      )}
      {library.groups.length === 0 ? null : (
        <Text
          style={{
            fontFamily: fonts.fUiSemiBold,
            fontSize: 1.1 * em,
            color: colors.fg,
            paddingHorizontal: side,
          }}
        >
          {m.library_shows()}
        </Text>
      )}
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <FlashList
        data={library.groups}
        numColumns={2}
        keyExtractor={(group) => group.key}
        contentContainerStyle={{ paddingTop: insets.top + em, paddingBottom: 1.5 * em }}
        ListHeaderComponent={header}
        ListEmptyComponent={
          <EmptyState title={m.recordings_empty()} body={m.recordings_empty_hint()} />
        }
        renderItem={({ item, index }) => (
          <View
            style={{
              paddingLeft: index % 2 === 0 ? side : gap / 2,
              paddingRight: index % 2 === 0 ? gap / 2 : side,
              paddingBottom: 1.1 * em,
            }}
          >
            <GroupTile group={item} onPress={() => openGroup(item)} />
          </View>
        )}
      />
    </View>
  );
};
