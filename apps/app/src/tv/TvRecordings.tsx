import type { RecordingEntry } from "@slipstream/api";
import { m, pathLabels } from "@slipstream/i18n";
import { useRouter } from "expo-router";
import { useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { cardMeta, libraryCard, type LibraryCard, type LibraryFilter } from "../data/library.ts";
import { playerParams } from "../player/playback.ts";
import { useLibraryView } from "../recordings/use-recordings.ts";
import { useTheme } from "../theme/theme.ts";
import { Chip } from "../ui/Chip.tsx";
import { FocusButton } from "../ui/FocusButton.tsx";
import { Bone } from "../ui/Skeleton.tsx";
import { useNow } from "../ui/use-now.ts";
import { Backdrop } from "./Backdrop.tsx";
import { CardRow } from "./CardRow.tsx";
import { PlaceCard } from "./library/PlaceCard.tsx";
import { useReturnFocus } from "./library/use-tv-navigation.ts";
import { Rail, RailContent } from "./Rail.tsx";
import { CARD_LIFT_ROOM } from "./rail-metrics.ts";
import { RecordingCard } from "./RecordingCard.tsx";
import { type Spotlight, useSpotlight, useSpotlit } from "./spotlight.ts";
import { CardRowBones, TvSkeleton, TvStatus, TvTitle } from "./TvStatus.tsx";
import { groupHref, recordingHref } from "../routes.ts";

/** The place a shelf stands for, when it holds more than one recording. */
interface ShelfPlace {
  readonly key: string;
  readonly count: number;
}

/** The return-focus key of a shelf's place card, apart from recording ids. */
const placeFocusKey = (key: string) => `place:${key}`;

/** Focus keys of the header's buttons. */
const HEADER_KEYS = {
  all: "filter:all",
  unwatched: "filter:unwatched",
  scheduled: "go:scheduled",
  series: "go:series",
  problems: "go:problems",
} as const;

/** The picture behind the shelves: the focused card's. Only it redraws as focus moves. */
const LibraryBackdrop = ({
  spotlight,
  entries,
}: {
  readonly spotlight: Spotlight;
  readonly entries: ReadonlyMap<string, RecordingEntry>;
}) => {
  const spotlit = useSpotlit(spotlight);
  return <Backdrop subject={spotlit === undefined ? undefined : entries.get(spotlit)} />;
};

/** One titled horizontal row of cards, ending in its place's card when it has one. */
const Shelf = ({
  title,
  cards,
  entries,
  target,
  place,
  onOpen,
  onPlay,
  onOpenPlace,
  onFocus,
}: {
  readonly title: string;
  readonly cards: readonly LibraryCard[];
  /** The library by id, for each card's picture. */
  readonly entries: ReadonlyMap<string, RecordingEntry>;
  /** What asks for focus now (useReturnFocus). */
  readonly target: string | undefined;
  /** The show or collection the shelf holds: a "See all" card at its end opens it. */
  readonly place: ShelfPlace | undefined;
  readonly onOpen: (card: LibraryCard) => void;
  readonly onPlay: (card: LibraryCard) => void;
  readonly onOpenPlace: (place: ShelfPlace) => void;
  readonly onFocus: (card: LibraryCard) => void;
}) => {
  const { colors, em, fonts } = useTheme();
  return (
    <View style={{ gap: 0.4 * em }}>
      <Text
        numberOfLines={1}
        style={{
          fontFamily: fonts.fUiSemiBold,
          fontSize: 1.25 * em,
          color: colors.fg,
          paddingLeft: CARD_LIFT_ROOM * em,
        }}
      >
        {title}
      </Text>
      <CardRow
        items={cards}
        keyOf={(card) => card.recordingId}
        renderCard={(card) => (
          <RecordingCard
            subject={entries.get(card.recordingId) ?? { channelId: card.channelId }}
            onFocus={() => onFocus(card)}
            title={card.title}
            meta={cardMeta(card)}
            progress={card.progress}
            badge={card.running ? <Chip label={m.status_recording()} tone="rec" /> : undefined}
            preferredFocus={target === card.recordingId}
            onPress={() => onOpen(card)}
            onLongPress={() => onPlay(card)}
          />
        )}
        footer={
          place === undefined ? undefined : (
            <PlaceCard
              name={title}
              count={place.count}
              preferredFocus={target === placeFocusKey(place.key)}
              onPress={() => onOpenPlace(place)}
            />
          )
        }
      />
    </View>
  );
};

/** The library while it loads: its heading and buttons, then shelves of card shapes. */
const LibrarySkeleton = () => {
  const { em } = useTheme();
  return (
    <TvSkeleton current="recordings">
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 0.6 * em,
          paddingLeft: CARD_LIFT_ROOM * em,
          marginTop: -em,
        }}
      >
        <Bone width={9 * em} height={2.6 * em} />
        <Bone width={11 * em} height={2.6 * em} />
      </View>
      <CardRowBones />
      <CardRowBones />
    </TvSkeleton>
  );
};

/**
 * TV recordings library (PLAN 6.6 "Recordings section in web, TV and phone"): what is recording
 * now leads, then a shelf per place (the phone's and the web's grouping), newest first. OK opens the recording's page
 * (a long press plays it); a shelf that is one show ends in a card that opens the show's page.
 * Back from a page or the player brings focus back to what opened it. "Unwatched" hides what
 * the viewer finished.
 */
export const TvRecordings = () => {
  const router = useRouter();
  const { colors, em, fonts } = useTheme();
  const [filter, setFilter] = useState<LibraryFilter>("all");
  const spotlight = useSpotlight();
  const now = useNow(60_000);
  const library = useLibraryView(filter, now);
  const { loading, error, retry } = library;
  const labels = pathLabels();
  const entries = new Map(library.all.map((entry) => [entry.id, entry]));
  const cardOf = (entry: RecordingEntry) => libraryCard(entry, library.names, labels);
  // What records now leads; a place's shelf holds the rest, ending in the place when it has more.
  const shelves = [
    ...(library.running.length === 0
      ? []
      : [
          {
            key: "running",
            title: m.recordings_recording_now(),
            cards: library.running.map(cardOf),
            place: undefined,
          },
        ]),
    ...library.groups.flatMap((group) => {
      const cards = group.entries.filter((entry) => entry.state !== "recording").map(cardOf);
      if (cards.length === 0) return [];
      const count = group.entries.length;
      return [
        {
          key: group.key,
          title: group.name,
          cards,
          place: count > 1 ? { key: group.key, count } : undefined,
        },
      ];
    }),
  ];
  const cardKeys = shelves.flatMap((shelf) => [
    ...shelf.cards.map((card) => card.recordingId),
    ...(shelf.place === undefined ? [] : [placeFocusKey(shelf.place.key)]),
  ]);
  const { target, opening } = useReturnFocus({
    keys: [...Object.values(HEADER_KEYS), ...cardKeys],
    first: loading ? undefined : (shelves[0]?.cards[0]?.recordingId ?? HEADER_KEYS.all),
  });

  if (loading) return <LibrarySkeleton />;
  // A failed refresh keeps what was loaded; only nothing at all is an error.
  if (error !== null && library.all.length === 0) {
    return <TvStatus current="recordings" title={m.error_unexpected()} onRetry={retry} />;
  }

  const openCard = (card: LibraryCard) => {
    opening(card.recordingId);
    router.push(recordingHref(card.recordingId));
  };
  const playCard = (card: LibraryCard) => {
    opening(card.recordingId);
    router.push({
      pathname: "/player",
      params: playerParams({ _tag: "Recording", recordingId: card.recordingId, from: card.from }),
    });
  };
  const openPlace = (place: ShelfPlace) => {
    opening(placeFocusKey(place.key));
    router.push(groupHref(place.key));
  };
  const go = (
    key: string,
    href: "/recordings/scheduled" | "/recordings/series" | "/recordings/problems",
  ) => {
    opening(key);
    router.push(href);
  };
  // The focused card's picture fills the screen behind the shelves.
  const focusCard = (card: LibraryCard) => spotlight.set(card.recordingId);
  const empty = shelves.length === 0;

  return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.bg }]}>
      <LibraryBackdrop spotlight={spotlight} entries={entries} />
      <Rail current="recordings" />
      <RailContent>
        <ScrollView
          style={StyleSheet.absoluteFill}
          contentContainerStyle={{
            paddingLeft: (3 - CARD_LIFT_ROOM) * em,
            paddingRight: 4 * em,
            paddingTop: 2.7 * em,
            paddingBottom: 3 * em,
            gap: 2.4 * em,
          }}
        >
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 2 * em,
              paddingLeft: CARD_LIFT_ROOM * em,
            }}
          >
            <TvTitle>{m.nav_recordings()}</TvTitle>
            <View accessibilityRole="radiogroup" style={{ flexDirection: "row", gap: 0.6 * em }}>
              <FocusButton
                label={m.recordings_filter_all()}
                variant={filter === "all" ? "default" : "ghost"}
                preferredFocus={target === HEADER_KEYS.all}
                onFocus={() => spotlight.set(undefined)}
                onPress={() => setFilter("all")}
              />
              <FocusButton
                label={m.recordings_filter_unwatched()}
                variant={filter === "unwatched" ? "default" : "ghost"}
                preferredFocus={target === HEADER_KEYS.unwatched}
                onFocus={() => spotlight.set(undefined)}
                onPress={() => setFilter("unwatched")}
              />
            </View>
            {/* The library's other places, as on the phone and the web. */}
            <View style={{ flexDirection: "row", gap: 0.6 * em, marginLeft: "auto" }}>
              <FocusButton
                label={m.library_title_scheduled()}
                icon="clock"
                variant="ghost"
                preferredFocus={target === HEADER_KEYS.scheduled}
                onFocus={() => spotlight.set(undefined)}
                onPress={() => go(HEADER_KEYS.scheduled, "/recordings/scheduled")}
              />
              <FocusButton
                label={m.series_title()}
                icon="series"
                variant="ghost"
                preferredFocus={target === HEADER_KEYS.series}
                onFocus={() => spotlight.set(undefined)}
                onPress={() => go(HEADER_KEYS.series, "/recordings/series")}
              />
              <FocusButton
                label={m.recordings_tab_problems()}
                icon="warn"
                variant="ghost"
                preferredFocus={target === HEADER_KEYS.problems}
                onFocus={() => spotlight.set(undefined)}
                onPress={() => go(HEADER_KEYS.problems, "/recordings/problems")}
              />
            </View>
          </View>
          {empty ? (
            <View style={{ gap: 0.6 * em, paddingLeft: CARD_LIFT_ROOM * em, maxWidth: 50 * em }}>
              <Text style={{ fontFamily: fonts.fUiSemiBold, fontSize: 2 * em, color: colors.fg }}>
                {filter === "unwatched" ? m.tv_library_unwatched_empty() : m.recordings_empty()}
              </Text>
              {filter === "unwatched" ? null : (
                <Text style={{ fontFamily: fonts.fUi, fontSize: 1.2 * em, color: colors.fg2 }}>
                  {m.recordings_empty_hint_tv()}
                </Text>
              )}
            </View>
          ) : null}
          {shelves.map((shelf) => (
            <Shelf
              key={shelf.key}
              title={shelf.title}
              cards={shelf.cards}
              entries={entries}
              target={target}
              place={shelf.place}
              onOpen={openCard}
              onPlay={playCard}
              onOpenPlace={openPlace}
              onFocus={focusCard}
            />
          ))}
        </ScrollView>
      </RailContent>
    </View>
  );
};
