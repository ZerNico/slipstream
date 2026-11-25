import type { RecordingEntry } from "@slipstream/api";
import { epochMs } from "@slipstream/domain";
import { formatters, m } from "@slipstream/i18n";
import { useRouter } from "expo-router";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useHome } from "../data/hooks.ts";
import { windowMarks } from "../data/capture-marks.ts";
import type { Hero } from "../data/home.ts";
import { channelPlayTarget, playerParams } from "../player/playback.ts";
import { TodoRow } from "../recordings/TodoRow.tsx";
import { useTodoSheet } from "../recordings/use-todo-sheet.tsx";
import { useTheme } from "../theme/theme.ts";
import { CaptureTimeline } from "../ui/CaptureTimeline.tsx";
import { Chip } from "../ui/Chip.tsx";
import { FocusButton } from "../ui/FocusButton.tsx";
import { Bone } from "../ui/Skeleton.tsx";
import { useNow } from "../ui/use-now.ts";
import { Backdrop } from "./Backdrop.tsx";
import { CardRow } from "./CardRow.tsx";
import { useReturnFocus } from "./library/use-tv-navigation.ts";
import { Rail, RailContent } from "./Rail.tsx";
import { RecordingCard } from "./RecordingCard.tsx";
import { CARD_LIFT_ROOM } from "./rail-metrics.ts";
import { type Spotlight, useSpotlight, useSpotlit } from "./spotlight.ts";
import { CardRowBones, TvSkeleton, TvStatus } from "./TvStatus.tsx";
import { recordingHref } from "../routes.ts";

/** What the hero says about the item in focus: a card, or the home screen's own pick. */
interface Words {
  readonly eyebrow: string;
  readonly recording: boolean;
  readonly title: string;
  readonly meta: string;
}

/** The hero's words for the home screen's pick (running, next or latest recording). */
const heroWords = (hero: Hero, now: number): Words => {
  const running = hero.kind === "recording";
  return {
    recording: running,
    eyebrow: running
      ? m.player_started_ago({
          channel: hero.channelName,
          seconds: Math.max(0, (now - hero.start) / 1000),
        })
      : hero.kind === "next"
        ? `${hero.channelName} · ${m.home_next_recording({ start: new Date(hero.start) })}`
        : hero.channelName,
    title: hero.subtitle === undefined ? hero.title : `${hero.title} · ${hero.subtitle}`,
    meta: m.recordings_slot({ start: new Date(hero.start), end: new Date(hero.end) }),
  };
};

/** The hero's room in em, kept whatever it shows, so the rows under it never move. */
const HERO_MIN_EM = 16.5;

/** The longest the hero's words run, in em: the picture stays in view to the right. */
const HERO_TEXT_EM = 52;

/** Focus keys of the hero's own buttons, apart from recording ids. */
const START_KEY = "hero:start";
const LIVE_KEY = "hero:live";

/** The card in focus, unless it is the hero's own recording (that keeps the hero as it is). */
const useFocusedCard = (
  spotlight: Spotlight,
  hero: Hero | undefined,
  entries: readonly RecordingEntry[],
): RecordingEntry | undefined => {
  const spotlit = useSpotlit(spotlight);
  return spotlit === hero?.recordingId ? undefined : entries.find((entry) => entry.id === spotlit);
};

/** The picture behind Home: the focused card's, else the hero's. */
const HomeBackdrop = ({
  spotlight,
  hero,
  entries,
}: {
  readonly spotlight: Spotlight;
  readonly hero: Hero | undefined;
  readonly entries: readonly RecordingEntry[];
}) => {
  const focused = useFocusedCard(spotlight, hero, entries);
  return <Backdrop subject={focused ?? entries.find((entry) => entry.id === hero?.recordingId)} />;
};

/**
 * The words over the backdrop and the hero's buttons, following the card in focus (the
 * spotlight): with the backdrop, the only part of Home that redraws as focus moves along a row.
 */
const HomeHero = ({
  spotlight,
  hero,
  entries,
  channelNames,
  now,
  target,
  onOpening,
}: {
  readonly spotlight: Spotlight;
  readonly hero: Hero | undefined;
  readonly entries: readonly RecordingEntry[];
  /** Channel names of the recordings in Continue watching, by recording. */
  readonly channelNames: ReadonlyMap<string, string>;
  readonly now: number;
  /** What asks for focus now (useReturnFocus). */
  readonly target: string | undefined;
  readonly onOpening: (key: string) => void;
}) => {
  const { colors, em, fonts } = useTheme();
  const router = useRouter();
  const focused = useFocusedCard(spotlight, hero, entries);
  const words: Words | undefined =
    focused !== undefined
      ? {
          recording: focused.state === "recording",
          eyebrow: channelNames.get(focused.id) ?? "",
          title:
            focused.subtitle === undefined
              ? focused.title
              : `${focused.title} · ${focused.subtitle}`,
          meta: m.recordings_slot({
            start: new Date(epochMs(focused.start)),
            end: new Date(epochMs(focused.end)),
          }),
        }
      : hero === undefined
        ? undefined
        : heroWords(hero, now);
  const running = hero?.kind === "recording";
  const heroMarks =
    hero === undefined
      ? undefined
      : windowMarks({ from: hero.capturedFrom, until: hero.recordingUntil }, hero, now).marks;
  const play = (key: string, params: Record<string, string>) => {
    onOpening(key);
    router.push({ pathname: "/player", params });
  };

  return (
    <View
      style={{
        gap: 0.7 * em,
        minHeight: HERO_MIN_EM * em,
        paddingLeft: CARD_LIFT_ROOM * em,
        maxWidth: HERO_TEXT_EM * em,
      }}
    >
      {words === undefined ? (
        <Text
          numberOfLines={2}
          style={{ fontFamily: fonts.fUiSemiBold, fontSize: 2 * em, color: colors.fg }}
        >
          {m.home_nothing_recording()}
        </Text>
      ) : (
        <>
          <View style={[styles.row, { gap: 0.7 * em, height: 2.1 * em }]}>
            {words.recording ? <Chip label={m.status_recording()} tone="rec" size={0.92} /> : null}
            <Text
              numberOfLines={1}
              style={{
                flexShrink: 1,
                fontFamily: fonts.fUi,
                fontSize: 1.15 * em,
                color: colors.fg2,
              }}
            >
              {words.eyebrow}
            </Text>
          </View>
          <Text
            numberOfLines={2}
            style={{
              fontFamily: fonts.fDisplay,
              fontSize: 3.2 * em,
              lineHeight: 3.1 * em,
              color: colors.fg,
            }}
          >
            {words.title.toUpperCase()}
          </Text>
          <Text
            numberOfLines={1}
            style={{ fontFamily: fonts.fUi, fontSize: 1.2 * em, color: colors.fg2 }}
          >
            {words.meta}
          </Text>
        </>
      )}
      {/*
          The hero's own ways in: faded out (their room kept, so nothing below moves) while a
          card has focus and the words above are that card's.
        */}
      {hero === undefined ? null : (
        <View
          style={{ gap: 0.9 * em, marginTop: 0.4 * em, opacity: focused === undefined ? 1 : 0 }}
        >
          {running && heroMarks !== undefined ? (
            <CaptureTimeline width={34 * em} marks={heroMarks} />
          ) : null}
          <View style={[styles.row, { gap: em }]}>
            {hero.kind === "next" ? null : (
              <FocusButton
                label={m.player_watch_from_start()}
                icon="start"
                size={1.2}
                preferredFocus={target === START_KEY}
                onFocus={() => spotlight.set(undefined)}
                onPress={() =>
                  play(
                    START_KEY,
                    playerParams({
                      _tag: "Recording",
                      recordingId: hero.recordingId,
                      from: "start",
                    }),
                  )
                }
              />
            )}
            {running ? (
              <FocusButton
                label={m.player_watch_live()}
                icon="live"
                size={1.2}
                preferredFocus={target === LIVE_KEY}
                onFocus={() => spotlight.set(undefined)}
                onPress={() => {
                  // The channel is being recorded: the recording from its live edge.
                  const live = channelPlayTarget(hero.channelId, entries, Date.now());
                  if (live !== undefined) play(LIVE_KEY, playerParams(live));
                }}
              />
            ) : null}
          </View>
        </View>
      )}
    </View>
  );
};

/** Home while it loads: the hero's words and buttons, and a row of cards, as bones. */
const HomeSkeleton = () => {
  const { em } = useTheme();
  return (
    <TvSkeleton current="home">
      <View
        style={{ gap: 0.7 * em, minHeight: HERO_MIN_EM * em, paddingLeft: CARD_LIFT_ROOM * em }}
      >
        <Bone width={18 * em} height={1.4 * em} style={{ marginVertical: 0.35 * em }} />
        <Bone width={40 * em} height={3.1 * em} />
        <Bone width={16 * em} height={1.4 * em} />
        <View style={[styles.row, { gap: em, marginTop: 0.4 * em }]}>
          <Bone width={17 * em} height={3.4 * em} />
          <Bone width={13 * em} height={3.4 * em} />
        </View>
      </View>
      <CardRowBones />
    </TvSkeleton>
  );
};

/**
 * TV home (Infuse, Torsher): the focused item fills the screen as a backdrop, its title and one
 * line on it, and for the home screen's own pick (the running recording, else the next or the
 * latest) one row of ways in. "Continue watching" runs underneath, "Needs attention" after it;
 * moving along a row brings that card's picture and words up. Back from a page, the player or a
 * sheet, focus returns to what opened it.
 */
export const TvHome = () => {
  const { colors, em, fonts } = useTheme();
  const router = useRouter();
  const now = useNow(30_000);
  const { model, recordings, loading, error, retry } = useHome(now);
  const todo = useTodoSheet(now);
  const spotlight = useSpotlight();
  const hero = model.hero;
  const heroKeys =
    hero === undefined
      ? []
      : [
          ...(hero.kind === "next" ? [] : [START_KEY]),
          ...(hero.kind === "recording" ? [LIVE_KEY] : []),
        ];
  const cardKeys = model.continueWatching.map((item) => item.recordingId);
  const todoKeys = todo.items.map((item) => item.id);
  const { target, opening } = useReturnFocus({
    keys: [...heroKeys, ...cardKeys, ...todoKeys],
    first: loading ? undefined : (heroKeys[0] ?? cardKeys[0] ?? todoKeys[0]),
    covered: todo.sheet !== null,
  });

  if (loading) return <HomeSkeleton />;
  // A failed refresh keeps what was loaded; only nothing at all is an error.
  if (error !== null && recordings.length === 0) {
    return <TvStatus current="home" title={m.error_unexpected()} onRetry={retry} />;
  }

  const f = formatters();
  const channelNames = new Map(
    model.continueWatching.map((item) => [item.recordingId, item.channelName] as const),
  );
  const play = (params: Record<string, string>) => router.push({ pathname: "/player", params });

  return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.bg }]}>
      <HomeBackdrop spotlight={spotlight} hero={hero} entries={recordings} />
      <Rail current="home" />
      <RailContent>
        {/* The hero stays put; only the rows under it scroll, so its title is never cut. */}
        <View
          style={[
            StyleSheet.absoluteFill,
            {
              paddingLeft: (3 - CARD_LIFT_ROOM) * em,
              paddingRight: 4 * em,
              // The eyebrow sits level with the logo in the rail.
              paddingTop: 2.75 * em,
              gap: 1.2 * em,
            },
          ]}
        >
          <HomeHero
            spotlight={spotlight}
            hero={hero}
            entries={recordings}
            channelNames={channelNames}
            now={now}
            target={target}
            onOpening={opening}
          />
          <ScrollView
            style={{ flex: 1, marginRight: -4 * em }}
            contentContainerStyle={{ gap: 1.6 * em, paddingBottom: 3 * em, paddingRight: 4 * em }}
            showsVerticalScrollIndicator={false}
          >
            {model.continueWatching.length === 0 ? null : (
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
                  {m.player_continue_watching()}
                </Text>
                <CardRow
                  items={model.continueWatching}
                  keyOf={(item) => item.recordingId}
                  renderCard={(item) => (
                    <RecordingCard
                      subject={
                        recordings.find((entry) => entry.id === item.recordingId) ?? {
                          channelId: item.channelId,
                        }
                      }
                      title={item.title}
                      meta={`${m.recordings_time_left({ seconds: item.secondsLeft })} · ${f.day(new Date(item.start))}`}
                      progress={item.progress}
                      preferredFocus={target === item.recordingId}
                      onFocus={() => spotlight.set(item.recordingId)}
                      onPress={() => {
                        opening(item.recordingId);
                        router.push(recordingHref(item.recordingId));
                      }}
                      // A long press resumes straight away.
                      onLongPress={() => {
                        opening(item.recordingId);
                        play(
                          playerParams({
                            _tag: "Recording",
                            recordingId: item.recordingId,
                            from: "resume",
                          }),
                        );
                      }}
                    />
                  )}
                />
              </View>
            )}
            {/* What needs fixing comes after what to watch: it is the exception. */}
            <View style={{ paddingLeft: CARD_LIFT_ROOM * em }}>
              <TodoRow
                items={todo.items}
                focusId={target}
                onOpen={(recordingId) => {
                  const item = todo.items.find(
                    (candidate) =>
                      candidate.kind === "recording" && candidate.entry.id === recordingId,
                  );
                  if (item !== undefined) opening(item.id);
                  todo.open(recordingId);
                }}
              />
            </View>
          </ScrollView>
        </View>
      </RailContent>
      {todo.sheet}
    </View>
  );
};

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center" },
});
