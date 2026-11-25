import type { RecordingEntry } from "@slipstream/api";
import { epochMs, groupPage, renderSegment } from "@slipstream/domain";
import { m, pathLabels, whenLabel } from "@slipstream/i18n";
import { householdZone } from "../../data/zone.ts";
import { useRouter } from "expo-router";
import { useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { cardMeta, libraryCard } from "../../data/library.ts";
import { playerParams } from "../../player/playback.ts";
import { useRecordings } from "../../recordings/use-recordings.ts";
import { useTheme } from "../../theme/theme.ts";
import { Chip } from "../../ui/Chip.tsx";
import { FocusButton } from "../../ui/FocusButton.tsx";
import { Bone } from "../../ui/Skeleton.tsx";
import { useNow } from "../../ui/use-now.ts";
import { Backdrop } from "../Backdrop.tsx";
import { CardRow } from "../CardRow.tsx";
import { Rail, RailContent } from "../Rail.tsx";
import { CARD_LIFT_ROOM } from "../rail-metrics.ts";
import { RecordingCard } from "../RecordingCard.tsx";
import { type Spotlight, useSpotlight, useSpotlit } from "../spotlight.ts";
import { CardRowBones, TvSkeleton, TvStatus } from "../TvStatus.tsx";
import { useReturnFocus, useTvBack } from "./use-tv-navigation.ts";
import { recordingHref } from "../../routes.ts";

/** The focus key of a season's button, apart from recording ids. */
const seasonKey = (name: string) => `season:${name}`;

/** The page while the library loads: the heading, the line under it and a row of cards. */
const PlaceSkeleton = () => {
  const { em } = useTheme();
  return (
    <TvSkeleton current="recordings">
      <View style={{ gap: 0.6 * em, paddingLeft: CARD_LIFT_ROOM * em }}>
        <Bone width={30 * em} height={3.4 * em} />
        <Bone width={14 * em} height={1.3 * em} />
      </View>
      <CardRowBones />
    </TvSkeleton>
  );
};

/** The picture behind the page: the focused card's, else the place's first. */
const PlaceBackdrop = ({
  spotlight,
  entries,
  fallback,
}: {
  readonly spotlight: Spotlight;
  readonly entries: readonly RecordingEntry[];
  readonly fallback: RecordingEntry | undefined;
}) => {
  const spotlit = useSpotlit(spotlight);
  return <Backdrop subject={entries.find((entry) => entry.id === spotlit) ?? fallback} />;
};

/** One of the place's cards: a recording, or what is scheduled to land in it (dimmed). */
interface PlaceItem {
  readonly entry: RecordingEntry;
  readonly scheduled: boolean;
}

/**
 * A place of the library on TV (a collection or a show; the web's group page, Plex's show
 * page): its name and counts, the seasons as buttons when it has them, then its events or
 * seasons as rows of cards (what is scheduled to land in one dimmed at the row's end), or one
 * grid. OK opens the recording's page; a long press plays it. The focused card's picture fills
 * the screen behind; back from a page or the player, focus returns to the card.
 */
export const TvPlacePage = ({ groupKey }: { readonly groupKey: string }) => {
  const { colors, em, fonts } = useTheme();
  const router = useRouter();
  useTvBack();
  const now = useNow(60_000);
  const library = useRecordings();
  const [season, setSeason] = useState<string | undefined>(undefined);
  const spotlight = useSpotlight();
  const labels = pathLabels();
  const page = library.loading
    ? undefined
    : groupPage(groupKey, library.all, library.collections, labels, season);
  const sections =
    page === undefined
      ? []
      : page.sections.length === 0
        ? [
            {
              key: "all",
              title: undefined,
              items: page.flat.map((entry) => ({ entry, scheduled: false })),
            },
          ]
        : page.sections.map((section) => ({
            key: section.key,
            title: section.title,
            items: [
              ...section.entries.map((entry) => ({ entry, scheduled: false })),
              ...section.scheduled.map((entry) => ({ entry, scheduled: true })),
            ],
          }));
  const cardKeys = sections.flatMap((section) => section.items.map((item) => item.entry.id));
  // Focus starts on the first card; a picked season keeps it on the season's button.
  const { target, opening } = useReturnFocus({
    keys: [...(page?.seasons ?? []).map(seasonKey), ...cardKeys],
    first: season === undefined ? cardKeys[0] : seasonKey(season),
  });

  if (library.loading) return <PlaceSkeleton />;
  if (page === undefined) {
    // A failed refresh keeps what was loaded; only nothing at all is an error.
    return library.error !== null && library.all.length === 0 ? (
      <TvStatus current="recordings" title={m.library_error_title()} onRetry={library.retry} />
    ) : (
      <TvStatus current="recordings" title={m.library_group_missing()} />
    );
  }

  const card = ({ entry, scheduled }: PlaceItem) => {
    const item = libraryCard(entry, library.names, labels);
    const start = epochMs(entry.start);
    return (
      <RecordingCard
        subject={entry}
        title={renderSegment(entry.group.item, labels)}
        meta={
          scheduled
            ? m.library_scheduled_card({
                when: whenLabel(start, now, householdZone()),
              })
            : cardMeta(item)
        }
        progress={scheduled ? 0 : item.progress}
        badge={item.running ? <Chip label={m.status_recording()} tone="rec" /> : undefined}
        dim={scheduled}
        preferredFocus={target === entry.id}
        onFocus={() => spotlight.set(entry.id)}
        onPress={() => {
          opening(entry.id);
          router.push(recordingHref(entry.id));
        }}
        onLongPress={
          scheduled
            ? undefined
            : () => {
                opening(entry.id);
                router.push({
                  pathname: "/player",
                  params: playerParams({
                    _tag: "Recording",
                    recordingId: entry.id,
                    from: item.from,
                  }),
                });
              }
        }
      />
    );
  };

  return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.bg }]}>
      <PlaceBackdrop
        spotlight={spotlight}
        entries={library.all}
        fallback={sections[0]?.items[0]?.entry ?? page.group.entries[0]}
      />
      <Rail current="recordings" />
      <RailContent>
        <ScrollView
          style={StyleSheet.absoluteFill}
          contentContainerStyle={{
            paddingLeft: (3 - CARD_LIFT_ROOM) * em,
            paddingRight: 4 * em,
            paddingTop: 2.7 * em,
            paddingBottom: 3 * em,
            gap: 1.6 * em,
          }}
        >
          <View style={{ gap: 0.4 * em, paddingLeft: CARD_LIFT_ROOM * em }}>
            <Text
              numberOfLines={1}
              style={{ fontFamily: fonts.fDisplay, fontSize: 3.4 * em, color: colors.fg }}
            >
              {page.group.name.toUpperCase()}
            </Text>
            <Text
              numberOfLines={1}
              style={{ fontFamily: fonts.fUi, fontSize: 1.2 * em, color: colors.fg2 }}
            >
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
              style={{ marginRight: -4 * em }}
              contentContainerStyle={{
                gap: 0.6 * em,
                paddingLeft: CARD_LIFT_ROOM * em,
                paddingRight: 4 * em,
              }}
            >
              {page.seasons.map((name) => (
                <FocusButton
                  key={name}
                  label={name}
                  variant={name === page.season ? "default" : "ghost"}
                  preferredFocus={target === seasonKey(name)}
                  onFocus={() => spotlight.set(undefined)}
                  onPress={() => setSeason(name)}
                />
              ))}
            </ScrollView>
          )}
          {page.sections.length === 0 ? (
            // One level only: every recording in one grid, newest first.
            <View
              style={{
                flexDirection: "row",
                flexWrap: "wrap",
                gap: 1.4 * em,
                padding: CARD_LIFT_ROOM * em,
              }}
            >
              {sections[0]?.items.map((item) => (
                <View key={item.entry.id}>{card(item)}</View>
              ))}
            </View>
          ) : (
            sections.map((section) => (
              <View key={section.key} style={{ gap: 0.4 * em }}>
                <Text
                  numberOfLines={1}
                  style={{
                    fontFamily: fonts.fUiSemiBold,
                    fontSize: 1.25 * em,
                    color: colors.fg,
                    paddingLeft: CARD_LIFT_ROOM * em,
                  }}
                >
                  {section.title}
                </Text>
                <CardRow items={section.items} keyOf={(item) => item.entry.id} renderCard={card} />
              </View>
            ))
          )}
        </ScrollView>
      </RailContent>
    </View>
  );
};
