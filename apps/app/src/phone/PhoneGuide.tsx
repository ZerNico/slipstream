import { type Channel, dayAt, type GuideDay, type GuideEntry, pillDay } from "@slipstream/domain";
import { m } from "@slipstream/i18n";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import { useCallback, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useApiQueries } from "../data/hooks.ts";
import { PickerSheet } from "../ui/PickerSheet.tsx";
import { channelPlayTarget, playerParams } from "../player/playback.ts";
import { useTheme } from "../theme/theme.ts";
import { RecordSheet } from "../record/RecordSheet.tsx";
import { FocusButton } from "../ui/FocusButton.tsx";
import { Icon } from "../ui/Icon.tsx";
import { StatusScreen } from "../ui/StatusScreen.tsx";
import { useNow } from "../ui/use-now.ts";
import {
  PhoneGuideGrid,
  type PhoneGuideGridHandle,
  PhoneGuideSkeleton,
} from "./guide/PhoneGuideGrid.tsx";
import { usePhoneGuide } from "./guide/use-phone-guide.ts";

/** How the switcher names a day: "Today", else "Wed 25". */
const dayLabel = (shown: GuideDay) =>
  shown.offset === 0
    ? m.guide_day_word({ day: "today" })
    : m.guide_day_pill({ day: pillDay(shown), date: shown.date });

/**
 * The day switcher (the web's ‹ Today 24 ›): the arrows step a day, the day itself opens every
 * day in a sheet. It names the day in view and moves the grid there.
 */
const DaySwitcher = ({
  days,
  day,
  onDay,
}: {
  readonly days: readonly GuideDay[];
  readonly day: GuideDay | undefined;
  readonly onDay: (day: GuideDay) => void;
}) => {
  const { colors, em, fonts } = useTheme();
  const [picking, setPicking] = useState(false);
  const index = day === undefined ? -1 : days.findIndex((candidate) => candidate.key === day.key);
  const previous = index > 0 ? days[index - 1] : undefined;
  const next = index >= 0 && index < days.length - 1 ? days[index + 1] : undefined;
  const arrow = (target: GuideDay | undefined, flip: boolean, words: string) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={words}
      accessibilityState={{ disabled: target === undefined }}
      disabled={target === undefined}
      hitSlop={0.4 * em}
      onPress={() => target !== undefined && onDay(target)}
      style={({ pressed }) => ({
        width: 2.4 * em,
        height: 2.4 * em,
        borderRadius: 1.2 * em,
        alignItems: "center",
        justifyContent: "center",
        opacity: target === undefined ? 0.3 : 1,
        backgroundColor: pressed ? colors.raised : "transparent",
        transform: flip ? [{ rotate: "180deg" }] : [],
      })}
    >
      <Icon name="chevronLeft" size={1.2 * em} color={colors.fg2} />
    </Pressable>
  );
  return (
    <View
      accessibilityRole="toolbar"
      accessibilityLabel={m.guide_days_label()}
      style={{
        flexDirection: "row",
        alignItems: "center",
        alignSelf: "flex-start",
        padding: 0.15 * em,
        borderRadius: 1.35 * em,
        borderWidth: 1,
        borderColor: colors.line,
      }}
    >
      {arrow(previous, false, m.guide_day_previous())}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={
          day === undefined ? m.guide_days_label() : m.guide_day_menu_label({ day: dayLabel(day) })
        }
        onPress={() => setPicking(true)}
        style={({ pressed }) => ({
          minWidth: 6.5 * em,
          height: 2.4 * em,
          paddingHorizontal: 0.6 * em,
          borderRadius: 1.2 * em,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: pressed ? colors.raised : "transparent",
        })}
      >
        <Text style={{ fontFamily: fonts.fUiSemiBold, fontSize: 0.92 * em, color: colors.fg }}>
          {day === undefined ? "" : dayLabel(day)}
        </Text>
      </Pressable>
      {arrow(next, true, m.guide_day_next())}
      {picking ? (
        <PickerSheet
          title={m.guide_days_label()}
          choices={days.map((candidate) => ({
            value: candidate.key,
            label: m.guide_day_pill({ day: pillDay(candidate), date: candidate.date }),
          }))}
          selected={day?.key ?? ""}
          onPick={(key) => {
            const picked = days.find((candidate) => candidate.key === key);
            if (picked !== undefined) onDay(picked);
          }}
          onClose={() => setPicking(false)}
        />
      ) : null}
    </View>
  );
};

/**
 * The phone guide (the web's timeline on a phone): every channel across the household's days on
 * one track, the day switcher following the scroll and moving it, Now to come back. A tap on a
 * programme opens its sheet (watch, record, the series); a tap on a channel watches it live, or
 * the recording running on it from its live edge.
 */
export const PhoneGuide = () => {
  const { colors, em, fonts } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const now = useNow(30_000);
  const [shownDay, setShownDay] = useState<string | undefined>(undefined);
  const guide = usePhoneGuide(now, shownDay);
  const grid = useRef<PhoneGuideGridHandle>(null);
  const queryClient = useQueryClient();
  const queries = useApiQueries();
  const [sheetFor, setSheetFor] = useState<
    { readonly programme: GuideEntry; readonly channelName: string } | undefined
  >(undefined);
  const closeSheet = useCallback(() => setSheetFor(undefined), []);

  const { recordings } = guide;
  const watchChannel = useCallback(
    (channel: Channel) => {
      const target = channelPlayTarget(channel.id, recordings, Date.now());
      if (target !== undefined) router.push({ pathname: "/player", params: playerParams(target) });
    },
    [recordings, router],
  );
  // Stable, so the grid's memoised cells don't all redraw when the screen does.
  // A finger on a programme starts loading what its sheet shows (the description), so it is
  // usually in by the time the finger lifts.
  const touch = useCallback(
    (programme: GuideEntry) => void queryClient.prefetchQuery(queries.programme(programme.id)),
    [queryClient, queries],
  );
  const open = useCallback((programme: GuideEntry, channel: Channel) => {
    void Haptics.selectionAsync();
    setSheetFor({ programme, channelName: channel.name });
  }, []);
  // Another day keeps the time of day in view (as on the web); today goes to now.
  const goToDay = (day: GuideDay) => {
    void Haptics.selectionAsync();
    if (day.offset === 0) {
      grid.current?.scrollToTime(Date.now(), true);
      return;
    }
    const inView = grid.current?.timeInView() ?? day.start;
    const offset = inView - dayAt(guide.days, inView).start;
    grid.current?.scrollToTime(day.start + offset, true);
  };

  const header = (
    <View style={{ paddingTop: insets.top + em, gap: 0.8 * em }}>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          paddingHorizontal: em,
        }}
      >
        <Text
          accessibilityRole="header"
          numberOfLines={1}
          style={{
            flexShrink: 1,
            fontFamily: fonts.fUiSemiBold,
            fontSize: 1.9 * em,
            color: colors.fg,
          }}
        >
          {m.nav_guide()}
        </Text>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 0.4 * em }}>
          <FocusButton
            label={m.nav_search()}
            icon="search"
            iconOnly
            variant="ghost"
            size={0.85}
            onPress={() => router.push("/search")}
          />
          <FocusButton
            label={m.guide_jump_now()}
            icon="live"
            size={0.85}
            onPress={() => {
              void Haptics.selectionAsync();
              grid.current?.scrollToTime(Date.now(), true);
            }}
          />
        </View>
      </View>
      <View style={{ paddingHorizontal: em, paddingBottom: 0.6 * em }}>
        <DaySwitcher
          days={guide.days}
          day={guide.days.find((day) => day.key === shownDay) ?? guide.days[0]}
          onDay={goToDay}
        />
      </View>
    </View>
  );

  if (guide.error !== null) {
    return (
      <StatusScreen
        title={m.error_unexpected()}
        actions={<FocusButton label={m.action_try_again()} onPress={guide.retry} />}
      />
    );
  }
  if (!guide.loading && guide.channels.length === 0) {
    return <StatusScreen title={m.guide_empty()} />;
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      {header}
      {guide.loading ? (
        <PhoneGuideSkeleton />
      ) : (
        <PhoneGuideGrid
          ref={grid}
          channels={guide.channels}
          rows={guide.rows}
          marks={guide.marks}
          window={guide.window}
          days={guide.days}
          pending={guide.pending}
          now={now}
          onVisibleDay={(day) => setShownDay(day.key)}
          onOpen={open}
          onTouch={touch}
          onChannel={watchChannel}
        />
      )}
      {sheetFor === undefined ? null : (
        <RecordSheet
          programme={sheetFor.programme}
          channelName={sheetFor.channelName}
          recordings={guide.recordings}
          conflicts={guide.conflicts}
          onClose={closeSheet}
        />
      )}
    </View>
  );
};
