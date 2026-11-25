import type { RecordingEntry } from "@slipstream/api";
import type { Channel, ChoiceOption, Programme, RecordingChoice } from "@slipstream/domain";
import { m } from "@slipstream/i18n";
import { useRouter } from "expo-router";
import { type ReactNode, useCallback, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useDerivedValue,
  withTiming,
} from "react-native-reanimated";
import {
  choiceTarget,
  pickProgramme,
  pickRecording,
  type WatchPick,
} from "../player/watch-choice.ts";
import { playerParams } from "../player/playback.ts";
import { RecordingSheet } from "../recordings/RecordingSheet.tsx";
import { useTheme } from "../theme/theme.ts";
import { useReturnFocus } from "../tv/library/use-tv-navigation.ts";
import { Rail, RailContent } from "../tv/Rail.tsx";
import { RecordingCard } from "../tv/RecordingCard.tsx";
import { CARD_EM, CARD_LIFT_ROOM } from "../tv/rail-metrics.ts";
import { RecordSheet } from "../record/RecordSheet.tsx";
import { WatchChoiceSheet } from "../player/WatchChoiceSheet.tsx";
import { ChannelArt } from "../ui/ChannelArt.tsx";
import { Chip } from "../ui/Chip.tsx";
import { FocusButton } from "../ui/FocusButton.tsx";
import { Bone, Skeleton } from "../ui/Skeleton.tsx";
import { programmeMeta, recordingText } from "./result-text.ts";
import { SearchField } from "./SearchField.tsx";
import { channelTarget, pickedProgramme, useRecentSearches, useSearch } from "./use-search.ts";

/** A channel tile's width in em. */
const TILE_EM = 12;

/** The focus key of the search field, apart from the results'. */
const FIELD_KEY = "field";

/** Focus keys of the results, apart from each other. */
const channelKey = (id: string) => "channel:" + id;
const programmeKey = (id: string) => "programme:" + id;
const recordingKey = (id: string) => "recording:" + id;
const recentKey = (query: string) => "recent:" + query;

/** A titled row of results running to the screen's right edge. */
const ResultRow = ({
  title,
  children,
}: {
  readonly title: string;
  readonly children: ReactNode;
}) => {
  const { colors, em, fonts } = useTheme();
  return (
    <View style={{ gap: 0.4 * em }}>
      <Text
        style={{
          fontFamily: fonts.fUiSemiBold,
          fontSize: 1.25 * em,
          color: colors.fg,
          paddingLeft: CARD_LIFT_ROOM * em,
        }}
      >
        {title}
      </Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={{ marginRight: -4 * em }}
        contentContainerStyle={{
          gap: 1.4 * em,
          padding: CARD_LIFT_ROOM * em,
          paddingRight: 4 * em,
        }}
      >
        {children}
      </ScrollView>
    </View>
  );
};

/** A channel as a logo tile (`.card` without a picture): it lifts and rings in amber on focus. */
const ChannelTile = ({
  channel,
  preferredFocus,
  onPress,
}: {
  readonly channel: Channel;
  readonly preferredFocus: boolean;
  readonly onPress: () => void;
}) => {
  const { colors, em, fonts, motion } = useTheme();
  const [focused, setFocused] = useState(false);
  const lift = useDerivedValue(() =>
    withTiming(focused ? 1 : 0, {
      duration: motion.tFocus,
      easing: Easing.bezier(...motion.easing),
    }),
  );
  const scale = motion.cardFocusScale;
  const tileStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 1 + lift.value * (scale - 1) }],
  }));
  return (
    <Pressable
      onPress={onPress}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      hasTVPreferredFocus={preferredFocus}
      accessibilityRole="button"
      accessibilityLabel={channel.name}
      style={{ width: TILE_EM * em, gap: 0.55 * em }}
    >
      <Animated.View
        style={[
          {
            aspectRatio: 16 / 9,
            borderRadius: 0.7 * em,
            backgroundColor: colors.raised,
            overflow: "hidden",
            borderWidth: 0.17 * em,
            borderColor: focused ? colors.brand : "transparent",
          },
          tileStyle,
        ]}
      >
        <ChannelArt channelId={channel.id} height={2.6 * em} />
      </Animated.View>
      <Text
        numberOfLines={1}
        style={{
          fontFamily: fonts.fUiSemiBold,
          fontSize: 1.1 * em,
          color: focused ? colors.fg : colors.fg2,
        }}
      >
        {channel.number === undefined ? channel.name : `${channel.number} · ${channel.name}`}
      </Text>
    </Pressable>
  );
};

/** Two rows of cards in the loaded shape while the first answer to a query is on its way. */
const ResultsSkeleton = () => {
  const { em } = useTheme();
  return (
    <Skeleton>
      <View style={{ gap: 1.6 * em }}>
        {[0, 1].map((row) => (
          <View key={row} style={{ gap: 0.4 * em, paddingLeft: CARD_LIFT_ROOM * em }}>
            <Bone width={10 * em} height={1.25 * em} />
            <View
              style={{ flexDirection: "row", gap: 1.4 * em, paddingVertical: CARD_LIFT_ROOM * em }}
            >
              {[0, 1, 2, 3].map((card) => (
                <View key={card} style={{ width: CARD_EM * em, gap: 0.55 * em }}>
                  <Bone width={CARD_EM * em} height={(CARD_EM * em * 9) / 16} radius={0.7 * em} />
                  <Bone width="75%" height={1.1 * em} />
                  <Bone width="50%" height={em} />
                </View>
              ))}
            </View>
          </View>
        ))}
      </View>
    </Skeleton>
  );
};

/**
 * TV search: the field at the top (OK opens the system keyboard and its voice input), recent
 * searches as chips while it is empty, and results in rows as you type: channels as logo tiles
 * (OK watches live), programmes on now and coming up (OK watches when it is on, else opens the record
 * options, as in the guide), and recordings (OK plays, or opens one
 * with nothing to play yet). The previous answer stays while the next loads.
 */
export const TvSearch = () => {
  const { colors, em, fonts } = useTheme();
  const router = useRouter();
  const [query, setQuery] = useState("");
  const results = useSearch(query);
  const { recent, remember } = useRecentSearches();
  const [recordFor, setRecordFor] = useState<Programme | undefined>(undefined);
  const [recordingFor, setRecordingFor] = useState<RecordingEntry | undefined>(undefined);
  const [choice, setChoice] = useState<
    { readonly title: string; readonly choice: RecordingChoice } | undefined
  >(undefined);
  const closeRecord = useCallback(() => setRecordFor(undefined), []);
  const closeRecording = useCallback(() => setRecordingFor(undefined), []);
  const closeChoice = useCallback(() => setChoice(undefined), []);

  const { names, entries, now } = results;
  // Focus starts in the field; back from the player or a sheet it returns to the result.
  const { target, opening } = useReturnFocus({
    keys: [
      FIELD_KEY,
      ...recent.map(recentKey),
      ...results.channels.map((channel) => channelKey(channel.id)),
      ...results.onNow.map((programme) => programmeKey(programme.id)),
      ...results.comingUp.map((programme) => programmeKey(programme.id)),
      ...results.recordings.map((entry) => recordingKey(entry.id)),
    ],
    first: FIELD_KEY,
    covered: recordFor !== undefined || recordingFor !== undefined || choice !== undefined,
  });
  const channelName = (id: string) => names.get(id) ?? "";
  const play = (params: Record<string, string>) => {
    remember(query);
    router.push({ pathname: "/player", params });
  };
  const follow = (pick: WatchPick, title: string, sheet: () => void) => {
    remember(query);
    if (pick._tag === "Sheet") sheet();
    else if (pick._tag === "Choose") setChoice({ title, choice: pick.choice });
    else play(playerParams(pick.target));
  };
  const openProgramme = (programme: Programme) => {
    if (results.recordingsPending) return;
    follow(pickProgramme(pickedProgramme(programme), entries, now), programme.title, () =>
      setRecordFor(programme),
    );
  };
  const openRecording = (entry: RecordingEntry) =>
    follow(pickRecording(entry, entries, now), entry.title, () => setRecordingFor(entry));
  const pick = (picked: RecordingChoice, option: ChoiceOption) => {
    setChoice(undefined);
    play(playerParams(choiceTarget(picked.recordingId, option)));
  };

  const programmeRow = (title: string, programmes: readonly Programme[], live: boolean) =>
    programmes.length === 0 ? null : (
      <ResultRow title={title}>
        {programmes.map((programme) => (
          <RecordingCard
            key={programme.id}
            subject={programme}
            title={programme.title}
            meta={programmeMeta(programme, channelName(programme.channelId), now)}
            progress={0}
            badge={live ? <Chip label={m.status_live()} tone="live" size={0.85} /> : undefined}
            preferredFocus={target === programmeKey(programme.id)}
            onPress={() => {
              opening(programmeKey(programme.id));
              openProgramme(programme);
            }}
          />
        ))}
      </ResultRow>
    );

  const quiet = { fontFamily: fonts.fUi, fontSize: 1.2 * em, color: colors.fg2 };

  return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.bg }]}>
      <Rail current="search" />
      <RailContent>
        <View
          style={[
            StyleSheet.absoluteFill,
            {
              paddingLeft: (3 - CARD_LIFT_ROOM) * em,
              paddingRight: 4 * em,
              paddingTop: 2.75 * em,
              gap: 1.2 * em,
            },
          ]}
        >
          <View style={{ width: 44 * em, paddingLeft: CARD_LIFT_ROOM * em }}>
            <SearchField
              value={query}
              onChangeText={setQuery}
              onSubmit={() => remember(query)}
              preferredFocus={target === FIELD_KEY}
            />
          </View>
          <ScrollView
            style={{ flex: 1, marginRight: -4 * em }}
            contentContainerStyle={{ gap: 1.6 * em, paddingBottom: 3 * em, paddingRight: 4 * em }}
            showsVerticalScrollIndicator={false}
          >
            {results.searched === "" ? (
              recent.length === 0 ? (
                <Text style={[quiet, { paddingLeft: CARD_LIFT_ROOM * em }]}>
                  {m.search_start()}
                </Text>
              ) : (
                <View style={{ gap: 0.4 * em }}>
                  <Text
                    style={{
                      fontFamily: fonts.fUiSemiBold,
                      fontSize: 1.25 * em,
                      color: colors.fg,
                      paddingLeft: CARD_LIFT_ROOM * em,
                    }}
                  >
                    {m.search_recent()}
                  </Text>
                  <View
                    style={{
                      flexDirection: "row",
                      flexWrap: "wrap",
                      gap: 0.8 * em,
                      padding: CARD_LIFT_ROOM * em,
                    }}
                  >
                    {recent.map((entry) => (
                      <FocusButton
                        key={entry}
                        label={entry}
                        icon="clock"
                        preferredFocus={target === recentKey(entry)}
                        onPress={() => setQuery(entry)}
                      />
                    ))}
                  </View>
                </View>
              )
            ) : results.error !== null ? (
              <View style={{ gap: em, paddingLeft: CARD_LIFT_ROOM * em }}>
                <Text style={quiet}>{m.error_unexpected()}</Text>
                <FocusButton label={m.action_try_again()} onPress={results.retry} />
              </View>
            ) : results.pending ? (
              <ResultsSkeleton />
            ) : results.none ? (
              <Text style={[quiet, { paddingLeft: CARD_LIFT_ROOM * em }]}>
                {m.palette_none({ query: results.searched })}
              </Text>
            ) : (
              <>
                {results.channels.length === 0 ? null : (
                  <ResultRow title={m.channels_heading()}>
                    {results.channels.map((channel) => (
                      <ChannelTile
                        key={channel.id}
                        channel={channel}
                        preferredFocus={target === channelKey(channel.id)}
                        onPress={() => {
                          opening(channelKey(channel.id));
                          const params = channelTarget(channel, entries, now);
                          if (params !== undefined) play(params);
                        }}
                      />
                    ))}
                  </ResultRow>
                )}
                {programmeRow(m.guide_on_now(), results.onNow, true)}
                {programmeRow(m.search_coming_up(), results.comingUp, false)}
                {results.recordings.length === 0 ? null : (
                  <ResultRow title={m.nav_recordings()}>
                    {results.recordings.map((entry) => {
                      const text = recordingText(entry, names, now);
                      return (
                        <RecordingCard
                          key={entry.id}
                          subject={entry}
                          title={
                            entry.subtitle === undefined
                              ? entry.title
                              : `${entry.title} · ${entry.subtitle}`
                          }
                          meta={text.meta}
                          progress={text.progress}
                          badge={
                            entry.state === "recording" ? (
                              <Chip label={m.status_recording()} tone="rec" size={0.85} />
                            ) : undefined
                          }
                          preferredFocus={target === recordingKey(entry.id)}
                          onPress={() => {
                            opening(recordingKey(entry.id));
                            openRecording(entry);
                          }}
                        />
                      );
                    })}
                  </ResultRow>
                )}
              </>
            )}
          </ScrollView>
        </View>
      </RailContent>
      {recordFor === undefined ? null : (
        <RecordSheet
          programme={recordFor}
          channelName={channelName(recordFor.channelId)}
          recordings={entries}
          conflicts={results.conflicts}
          onClose={closeRecord}
        />
      )}
      {recordingFor === undefined ? null : (
        <RecordingSheet
          entry={recordingFor}
          entries={entries}
          channelName={channelName(recordingFor.channelId)}
          onClose={closeRecording}
        />
      )}
      {choice === undefined ? null : (
        <WatchChoiceSheet
          title={choice.title}
          choice={choice.choice}
          onPick={(option) => pick(choice.choice, option)}
          onClose={closeChoice}
        />
      )}
    </View>
  );
};
