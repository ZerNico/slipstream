import type { RecordingEntry } from "@slipstream/api";
import { epochMs } from "@slipstream/domain";
import { formatters, m } from "@slipstream/i18n";
import { useRouter } from "expo-router";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import type { ArtworkSubject } from "../data/artwork.ts";
import { tvGuideDays, useHome, useWarmGuide } from "../data/hooks.ts";
import { windowMarks } from "../data/capture-marks.ts";
import type { Hero, OnNowItem } from "../data/home.ts";
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
  /** The chip before the eyebrow: recording, or on air (an On now card). */
  readonly chip: "rec" | "live" | undefined;
  readonly title: string;
  readonly meta: string;
}

/** The hero's words for the home screen's pick (running, next or latest recording). */
const heroWords = (hero: Hero, now: number): Words => {
  const running = hero.kind === "recording";
  return {
    chip: running ? "rec" : undefined,
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
const GUIDE_KEY = "hero:guide";

/** The focus key of an On now card: its channel's, apart from recording ids. */
const nowKey = (item: OnNowItem) => `now:${item.channel.id}`;

/** A focused card: a recording (Continue watching) or a channel on air (On now). */
type Focused =
  | { readonly kind: "recording"; readonly entry: RecordingEntry }
  | { readonly kind: "now"; readonly item: OnNowItem };

/** What the focused card's picture is. */
const subjectOf = (focused: Focused): ArtworkSubject =>
  focused.kind === "recording" ? focused.entry : focused.item.programme;

/** The card in focus, unless it is the hero's own recording (that keeps the hero as it is). */
const useFocusedCard = (
  spotlight: Spotlight,
  hero: Hero | undefined,
  entries: readonly RecordingEntry[],
  onNow: readonly OnNowItem[],
): Focused | undefined => {
  const spotlit = useSpotlit(spotlight);
  if (spotlit === undefined || spotlit === hero?.recordingId) return undefined;
  const entry = entries.find((candidate) => candidate.id === spotlit);
  if (entry !== undefined) return { kind: "recording", entry };
  const item = onNow.find((candidate) => nowKey(candidate) === spotlit);
  return item === undefined ? undefined : { kind: "now", item };
};

/** The picture behind Home: the focused card's, else the hero's. */
const HomeBackdrop = ({
  spotlight,
  hero,
  entries,
  onNow,
}: {
  readonly spotlight: Spotlight;
  readonly hero: Hero | undefined;
  readonly entries: readonly RecordingEntry[];
  readonly onNow: readonly OnNowItem[];
}) => {
  const focused = useFocusedCard(spotlight, hero, entries, onNow);
  return (
    <Backdrop
      subject={
        focused === undefined
          ? entries.find((entry) => entry.id === hero?.recordingId)
          : subjectOf(focused)
      }
    />
  );
};

/** The hero's words for a focused card. */
const focusedWords = (focused: Focused, channelNames: ReadonlyMap<string, string>): Words => {
  if (focused.kind === "now") {
    const { channel, programme } = focused.item;
    return {
      chip: "live",
      eyebrow: channel.name,
      title:
        programme.subtitle === undefined
          ? programme.title
          : `${programme.title} · ${programme.subtitle}`,
      meta: m.recordings_slot({
        start: new Date(epochMs(programme.start)),
        end: new Date(epochMs(programme.end)),
      }),
    };
  }
  const { entry } = focused;
  return {
    chip: entry.state === "recording" ? "rec" : undefined,
    eyebrow: channelNames.get(entry.id) ?? "",
    title: entry.subtitle === undefined ? entry.title : `${entry.title} · ${entry.subtitle}`,
    meta: m.recordings_slot({
      start: new Date(epochMs(entry.start)),
      end: new Date(epochMs(entry.end)),
    }),
  };
};

/**
 * The words over the backdrop and the hero's buttons, following the card in focus (the
 * spotlight): with the backdrop, the only part of Home that redraws as focus moves along a row.
 */
const HomeHero = ({
  spotlight,
  hero,
  entries,
  onNow,
  channelNames,
  now,
  target,
  onOpening,
}: {
  readonly spotlight: Spotlight;
  readonly hero: Hero | undefined;
  readonly entries: readonly RecordingEntry[];
  readonly onNow: readonly OnNowItem[];
  /** Channel names of the recordings in Continue watching, by recording. */
  readonly channelNames: ReadonlyMap<string, string>;
  readonly now: number;
  /** What asks for focus now (useReturnFocus). */
  readonly target: string | undefined;
  readonly onOpening: (key: string) => void;
}) => {
  const { colors, em, fonts } = useTheme();
  const router = useRouter();
  const focused = useFocusedCard(spotlight, hero, entries, onNow);
  // Nothing recorded, running or coming: the hero says so and leads to the guide.
  const words: Words =
    focused !== undefined
      ? focusedWords(focused, channelNames)
      : hero === undefined
        ? {
            chip: undefined,
            eyebrow: "",
            title: m.recordings_empty(),
            meta: m.recordings_empty_hint(),
          }
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
      <View style={[styles.row, { gap: 0.7 * em, height: 2.1 * em }]}>
        {words.chip === "rec" ? (
          <Chip label={m.status_recording()} tone="rec" size={0.92} />
        ) : words.chip === "live" ? (
          <Chip label={m.status_live()} tone="live" size={0.92} />
        ) : null}
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
      {/*
          The hero's own ways in: faded out (their room kept, so nothing below moves) while a
          card has focus and the words above are that card's.
        */}
      {hero === undefined ? (
        <View style={[styles.row, { marginTop: 0.4 * em, opacity: focused === undefined ? 1 : 0 }]}>
          <FocusButton
            label={m.action_open_guide()}
            icon="guide"
            size={1.2}
            preferredFocus={target === GUIDE_KEY}
            onFocus={() => spotlight.set(undefined)}
            onPress={() => {
              onOpening(GUIDE_KEY);
              router.navigate("/guide");
            }}
          />
        </View>
      ) : (
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
 * latest; with none, the way to the guide) one row of ways in. "Continue watching" runs
 * underneath, then "On now" (every channel's programme on air, as on the web), "Needs attention" after it;
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
  // The guide's first days load while Home shows, so the guide opens with its programmes.
  useWarmGuide(now, tvGuideDays);
  const hero = model.hero;
  const heroKeys =
    hero === undefined
      ? [GUIDE_KEY]
      : [
          ...(hero.kind === "next" ? [] : [START_KEY]),
          ...(hero.kind === "recording" ? [LIVE_KEY] : []),
        ];
  const cardKeys = model.continueWatching.map((item) => item.recordingId);
  const nowKeys = model.onNow.map(nowKey);
  const todoKeys = todo.items.map((item) => item.id);
  const { target, opening } = useReturnFocus({
    keys: [...heroKeys, ...cardKeys, ...nowKeys, ...todoKeys],
    first: loading ? undefined : (heroKeys[0] ?? cardKeys[0] ?? nowKeys[0] ?? todoKeys[0]),
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
      <HomeBackdrop spotlight={spotlight} hero={hero} entries={recordings} onNow={model.onNow} />
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
            onNow={model.onNow}
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
            {/* What airs now, as on the web's Home: OK watches the channel live. */}
            {model.onNow.length === 0 ? null : (
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
                  {m.guide_on_now()}
                </Text>
                <CardRow
                  items={model.onNow}
                  keyOf={nowKey}
                  renderCard={(item) => (
                    <RecordingCard
                      subject={item.programme}
                      title={item.programme.title}
                      meta={item.channel.name}
                      progress={item.progress}
                      preferredFocus={target === nowKey(item)}
                      onFocus={() => spotlight.set(nowKey(item))}
                      onPress={() => {
                        // Live, or the recording running on the channel from its live edge.
                        const live = channelPlayTarget(item.channel.id, recordings, Date.now());
                        if (live === undefined) return;
                        opening(nowKey(item));
                        play(playerParams(live));
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
