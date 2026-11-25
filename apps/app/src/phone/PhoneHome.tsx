import type { RecordingEntry } from "@slipstream/api";
import { formatters, m } from "@slipstream/i18n";
import { useRouter } from "expo-router";
import { Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useHome } from "../data/hooks.ts";
import { windowMarks } from "../data/capture-marks.ts";
import { channelPlayTarget, playerParams } from "../player/playback.ts";
import { TodoRow } from "../recordings/TodoRow.tsx";
import { useTodoSheet } from "../recordings/use-todo-sheet.tsx";
import { useTheme } from "../theme/theme.ts";
import { Artwork } from "../ui/Artwork.tsx";
import { BrandMark } from "../ui/BrandMark.tsx";
import { CaptureTimeline } from "../ui/CaptureTimeline.tsx";
import { Chip } from "../ui/Chip.tsx";
import { FocusButton } from "../ui/FocusButton.tsx";
import { StatusScreen } from "../ui/StatusScreen.tsx";
import { useNow } from "../ui/use-now.ts";
import { Thumb } from "./Thumb.tsx";
import { HomeSkeleton } from "./PhoneSkeletons.tsx";

/**
 * Phone home (the TV's home for one hand): the running recording leads with its picture and
 * both ways in, "Continue watching" as a row of pictures, "Needs attention" after it, and the
 * tab bar at the thumb.
 */
export const PhoneHome = () => {
  const { colors, em, fonts, radii } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const now = useNow(30_000);
  const { model, recordings, loading, error, retry } = useHome(now);
  const todo = useTodoSheet(now);

  if (loading) return <HomeSkeleton />;
  if (error !== null) {
    return (
      <StatusScreen
        title={m.error_unexpected()}
        actions={<FocusButton label={m.action_try_again()} onPress={retry} />}
      />
    );
  }
  const entries: readonly RecordingEntry[] = recordings;
  const byId = (id: string) => entries.find((entry) => entry.id === id);
  const hero = model.hero;
  const heroEntry = hero === undefined ? undefined : byId(hero.recordingId);
  const play = (params: Record<string, string>) => router.push({ pathname: "/player", params });
  const f = formatters();
  const side = 1.1 * em;
  const heroMarks =
    hero === undefined
      ? undefined
      : windowMarks({ from: hero.capturedFrom, until: hero.recordingUntil }, hero, now).marks;

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{
          paddingTop: insets.top + 0.8 * em,
          paddingBottom: 1.5 * em,
          gap: 1.6 * em,
        }}
      >
        <View style={[styles.row, { justifyContent: "space-between", paddingHorizontal: side }]}>
          <BrandMark size={2 * em} />
          {/* As tall as the mark, the button overhanging it, so the page sits as its skeleton did. */}
          <View style={{ height: 2 * em, justifyContent: "center" }}>
            <FocusButton
              label={m.nav_search()}
              icon="search"
              iconOnly
              variant="ghost"
              onPress={() => router.push("/search")}
            />
          </View>
        </View>
        {hero === undefined ? (
          <Text
            style={{
              fontFamily: fonts.fUiSemiBold,
              fontSize: 1.2 * em,
              color: colors.fg,
              paddingHorizontal: side,
            }}
          >
            {m.home_nothing_recording()}
          </Text>
        ) : (
          <View style={{ gap: 0.8 * em, paddingHorizontal: side }}>
            <View
              style={{
                aspectRatio: 16 / 9,
                borderRadius: radii.rL,
                overflow: "hidden",
                backgroundColor: colors.raised,
              }}
            >
              <Artwork subject={heroEntry ?? { channelId: hero.channelId }} logoHeight={3 * em} />
              {/* What the hero is: recording now, or the next one scheduled. */}
              <View
                style={{
                  position: "absolute",
                  top: 0.7 * em,
                  left: 0.7 * em,
                  // The translucent chip needs a dark ground to read over any picture.
                  borderRadius: 0.4 * em,
                  backgroundColor: colors.scrim,
                }}
              >
                {hero.kind === "recording" ? (
                  <Chip label={m.status_recording()} tone="rec" />
                ) : hero.kind === "next" ? (
                  <Chip label={m.status_scheduled()} tone="outline" />
                ) : null}
              </View>
            </View>
            <View style={{ gap: 0.35 * em }}>
              <Text
                numberOfLines={1}
                style={{ fontFamily: fonts.fUi, fontSize: 0.9 * em, color: colors.fg2 }}
              >
                {hero.channelName}
              </Text>
              <Text
                numberOfLines={2}
                style={{
                  fontFamily: fonts.fDisplay,
                  fontSize: 2 * em,
                  lineHeight: 2 * em,
                  color: colors.fg,
                }}
              >
                {[hero.title, hero.subtitle]
                  .filter((part) => part !== undefined)
                  .join(" · ")
                  .toUpperCase()}
              </Text>
              <Text
                numberOfLines={1}
                style={{ fontFamily: fonts.fUi, fontSize: 0.9 * em, color: colors.fg2 }}
              >
                {m.recordings_slot({ start: new Date(hero.start), end: new Date(hero.end) })}
              </Text>
            </View>
            {hero.kind === "recording" ? (
              heroMarks === undefined ? null : (
                <CaptureTimeline width={width - 2 * side} marks={heroMarks} />
              )
            ) : null}
            {/* Long labels (German) wrap the second button under the first, never off screen. */}
            <View style={[styles.row, { flexWrap: "wrap", gap: 0.6 * em }]}>
              {hero.kind === "next" ? null : (
                <FocusButton
                  label={m.player_from_start()}
                  icon="start"
                  variant="primary"
                  size={0.95}
                  onPress={() =>
                    play(
                      playerParams({
                        _tag: "Recording",
                        recordingId: hero.recordingId,
                        from: "start",
                      }),
                    )
                  }
                />
              )}
              {hero.kind === "recording" ? (
                <FocusButton
                  label={m.player_watch_live()}
                  icon="live"
                  size={0.95}
                  onPress={() => {
                    // The channel is being recorded: the recording from its live edge.
                    const target = channelPlayTarget(hero.channelId, recordings, Date.now());
                    if (target !== undefined) play(playerParams(target));
                  }}
                />
              ) : null}
            </View>
          </View>
        )}
        {model.continueWatching.length === 0 ? null : (
          <View style={{ gap: 0.7 * em }}>
            <Text
              style={{
                fontFamily: fonts.fUiSemiBold,
                fontSize: 1.1 * em,
                color: colors.fg,
                paddingHorizontal: side,
              }}
            >
              {m.player_continue_watching()}
            </Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ gap: 0.8 * em, paddingHorizontal: side }}
            >
              {model.continueWatching.map((item) => (
                <Pressable
                  key={item.recordingId}
                  accessibilityRole="button"
                  accessibilityLabel={item.title}
                  onPress={() =>
                    play(
                      playerParams({
                        _tag: "Recording",
                        recordingId: item.recordingId,
                        from: "resume",
                      }),
                    )
                  }
                  style={{ width: 13 * em, gap: 0.4 * em }}
                >
                  <Thumb
                    subject={byId(item.recordingId) ?? { channelId: item.channelId }}
                    progress={item.progress}
                    width={13 * em}
                  />
                  <Text
                    numberOfLines={1}
                    style={{ fontFamily: fonts.fUiSemiBold, fontSize: 0.9 * em, color: colors.fg }}
                  >
                    {item.title}
                  </Text>
                  <Text
                    numberOfLines={1}
                    style={{ fontFamily: fonts.fUi, fontSize: 0.8 * em, color: colors.fg3 }}
                  >
                    {`${m.recordings_time_left({ seconds: item.secondsLeft })} · ${f.day(new Date(item.start))}`}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>
        )}
        <View style={{ paddingHorizontal: side }}>
          <TodoRow items={todo.items} onOpen={todo.open} />
        </View>
      </ScrollView>
      {todo.sheet}
    </View>
  );
};

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center" },
});
