import { formatters, m } from "@slipstream/i18n";
import {
  defaultGuideConfig,
  digitDeadline,
  expireDigits,
  focusedCell,
  hasData,
  idleHold,
  initialCursor,
  isAtNow,
  relocate,
  step,
  typeDigit,
  type DigitEntry,
  type Guide,
  type GuideCursor,
} from "./core/index.ts";
import {
  type ChoiceOption,
  dayKey,
  type ProgrammeId,
  type RecordingChoice,
} from "@slipstream/domain";
import { useQuery } from "@tanstack/react-query";
import { useFocusEffect, useIsFocused, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BackHandler,
  Pressable,
  StyleSheet,
  Text,
  TVFocusGuideView,
  useTVEventHandler,
  useWindowDimensions,
  View,
  type TVRemoteEvent,
} from "react-native";
import { type AppProgramme, cellLabel } from "../../data/guide-data.ts";
import { useApiQueries, useGuideData } from "../../data/hooks.ts";
import { householdZone } from "../../data/zone.ts";
import { playerParams } from "../../player/playback.ts";
import { choiceTarget, pickProgramme } from "../../player/watch-choice.ts";
import { useTheme } from "../../theme/theme.ts";
import { Chip } from "../../ui/Chip.tsx";
import { useNow } from "../../ui/use-now.ts";
import { useDigitKeys } from "../digit-keys.ts";
import { Rail } from "../Rail.tsx";
import { RecordSheet } from "../../record/RecordSheet.tsx";
import { TvSkeleton, TvStatus } from "../TvStatus.tsx";
import { WatchChoiceSheet } from "../../player/WatchChoiceSheet.tsx";
import { GuideBones, GuideGrid } from "./GuideGrid.tsx";
import { guideLayout } from "./layout.ts";
import { HELD_REPEAT_MS, readPress, type RemoteEventLike, remoteToAction } from "./remote.ts";

/**
 * The one remote shortcut shown top right, the one nothing else reveals: hold OK to record.
 * Paging, days and digits work as on every TV guide and need no legend.
 */
const KEYS: readonly (readonly [string, () => string, () => string])[] = [
  ["hold-ok", () => m.guide_key_hold_ok(), () => m.guide_hint_record()],
];

/** How long the cursor rests on a programme before its description is asked for, ms. */
const DETAILS_AFTER_MS = 150;

/**
 * Keeps the cursor on the same channel and time when the guide data changes (a refresh from a
 * live event), and starts it at "now" once the first data arrives. Both happen while rendering
 * (React's "adjust state while rendering"), so the first frame with data already has a cursor.
 */
const useCursor = (guide: Guide<AppProgramme>, config: typeof defaultGuideConfig, now: number) => {
  const [cursor, setCursor] = useState<GuideCursor | undefined>(undefined);
  // The guide and config the cursor was last placed for.
  const [placedFor, setPlacedFor] = useState<
    { readonly guide: Guide<AppProgramme>; readonly config: typeof defaultGuideConfig } | undefined
  >(undefined);
  if (hasData(guide) && (placedFor?.guide !== guide || placedFor.config !== config)) {
    setPlacedFor({ guide, config });
    setCursor(
      cursor === undefined || placedFor === undefined
        ? initialCursor(guide, config, now)
        : relocate(placedFor.guide, guide, config, cursor),
    );
  }
  return [cursor, setCursor] as const;
};

/**
 * TV guide (design doc "TV · Guide"). The grid is one focusable view: native focus stays on it
 * while the guide core's cursor handles every key. OK plays the focused programme, holding
 * OK opens the record options, CH +/- page, rewind and fast-forward change the day, digits jump
 * to a channel, Back returns to now and then leaves.
 */
export const TvGuide = () => {
  const { colors, em, fonts } = useTheme();
  const router = useRouter();
  const { width, height } = useWindowDimensions();
  const now = useNow(30_000);
  const screenFocused = useIsFocused();
  // The cursor's household day: the guide loads it and its neighbours (today to begin with).
  const [focusDay, setFocusDay] = useState<string | undefined>(undefined);
  const data = useGuideData(now, focusDay);
  const queries = useApiQueries();
  const { guide, info } = data;
  const layout = useMemo(
    () => guideLayout(width, height, em, defaultGuideConfig.visibleSpan),
    [width, height, em],
  );
  const config = useMemo(
    () => ({ ...defaultGuideConfig, visibleRows: layout.visibleRows }),
    [layout.visibleRows],
  );
  const [cursor, setCursor] = useCursor(guide, config, now);
  const [sheetFor, setSheetFor] = useState<AppProgramme | undefined>(undefined);
  const [digits, setDigits] = useState<DigitEntry | undefined>(undefined);
  const digitsRef = useRef<DigitEntry | undefined>(undefined);
  const hold = useRef(idleHold);
  const closeSheet = useCallback(() => setSheetFor(undefined), []);
  const [choice, setChoice] = useState<
    { readonly title: string; readonly choice: RecordingChoice } | undefined
  >(undefined);
  const closeChoice = useCallback(() => setChoice(undefined), []);
  // The rail shows over the grid only after Back at now (design doc "TV · Guide"); Right or
  // the guide's own item in it goes back to the grid.
  const [railOpen, setRailOpen] = useState(false);
  const closeRail = useCallback(() => setRailOpen(false), []);
  const active = screenFocused && sheetFor === undefined && choice === undefined && !railOpen;

  // A held arrow: Android sends it going down once past its long press, so the guide repeats it
  // until it comes up, through the same acceleration as a remote's own repeats.
  const repeating = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const stopRepeating = useCallback(() => {
    if (repeating.current !== undefined) clearInterval(repeating.current);
    repeating.current = undefined;
  }, []);
  useEffect(() => {
    if (!active) stopRepeating();
  }, [active, stopRepeating]);
  useEffect(() => stopRepeating, [stopRepeating]);

  const onRemote = useCallback(
    (event: TVRemoteEvent) => {
      const press = readPress(event);
      if (press?.phase === "up") stopRepeating();
      if (railOpen) {
        if (press?.key === "right" && press.phase === "down") setRailOpen(false);
        return;
      }
      if (!active) return;
      const move = (input: RemoteEventLike) => {
        const result = remoteToAction(hold.current, input, Date.now());
        hold.current = result.hold;
        const action = result.action;
        if (action !== undefined) {
          setCursor((current) =>
            current === undefined ? current : step(guide, config, current, action),
          );
        }
      };
      move(event);
      if (press?.held === true && press.phase === "down") {
        stopRepeating();
        const again = { eventType: press.key, eventKeyAction: 0 };
        repeating.current = setInterval(() => move(again), HELD_REPEAT_MS);
      }
    },
    [railOpen, active, guide, config, setCursor, stopRepeating],
  );
  useTVEventHandler(onRemote);

  // Digit keys (forwarded by the with-digit-keys plugin) collect into a channel number.
  const numbers = useMemo(() => guide.channels.map((channel) => channel.number), [guide]);
  const jumpTo = useCallback(
    (number: number) =>
      setCursor((current) =>
        current === undefined ? current : step(guide, config, current, { _tag: "Channel", number }),
      ),
    [guide, config, setCursor],
  );
  const onDigit = useCallback(
    (digit: number) => {
      const result = typeDigit(digitsRef.current, digit, Date.now(), undefined, numbers);
      digitsRef.current = result.entry;
      setDigits(result.entry);
      if (result.commit !== undefined) jumpTo(result.commit);
    },
    [numbers, jumpTo],
  );
  useDigitKeys(onDigit, active);
  useEffect(() => {
    if (digits === undefined) return;
    const timer = setTimeout(
      () => {
        const result = expireDigits(digits, Date.now());
        digitsRef.current = result.entry;
        setDigits(result.entry);
        if (result.commit !== undefined) jumpTo(result.commit);
      },
      Math.max(0, digitDeadline(digits) - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [digits, jumpTo]);

  // The Back handler reads the latest cursor without re-subscribing on every move.
  const latest = useRef(cursor);
  useEffect(() => {
    latest.current = cursor;
  }, [cursor]);
  // Back returns to now, then opens the rail; Back from the rail leaves for Home.
  const railOpenRef = useRef(railOpen);
  useEffect(() => {
    railOpenRef.current = railOpen;
  }, [railOpen]);
  useFocusEffect(
    useCallback(() => {
      const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
        if (railOpenRef.current) return false;
        const at = Date.now();
        const current = latest.current;
        if (current !== undefined && !isAtNow(guide, config, current, at)) {
          setCursor((value) =>
            value === undefined ? value : step(guide, config, value, { _tag: "Now", now: at }),
          );
          return true;
        }
        setRailOpen(true);
        return true;
      });
      return () => {
        subscription.remove();
        // Back here later: the grid has focus, not the rail.
        setRailOpen(false);
      };
    }, [guide, config, setCursor]),
  );

  // Before any early return: the hooks below run on every render.
  const programmeId =
    cursor === undefined ? undefined : focusedCell(guide, cursor)?.programme?.programmeId;
  const anchorDay = cursor === undefined ? undefined : dayKey(cursor.anchor, householdZone());
  // The day the cursor moved to, for the next render's loading (React's "adjust state while
  // rendering": no effect, so the neighbours are asked for in the same pass).
  if (anchorDay !== undefined && anchorDay !== focusDay) setFocusDay(anchorDay);
  // The focused programme's description, asked once the cursor rests on it: a held arrow passes
  // cells by without a request for each. Shown only for the programme it belongs to.
  const [resting, setResting] = useState<ProgrammeId | undefined>(undefined);
  useEffect(() => {
    const timer = setTimeout(() => setResting(programmeId), DETAILS_AFTER_MS);
    return () => clearTimeout(timer);
  }, [programmeId]);
  const details = useQuery(queries.programme(resting));
  const description =
    details.data !== undefined && details.data.id === programmeId
      ? details.data.description
      : undefined;

  if (data.loading) {
    return (
      <TvSkeleton current="guide" fullScreen>
        <GuideBones layout={layout} />
      </TvSkeleton>
    );
  }
  if (data.error !== null && !hasData(guide)) {
    return <TvStatus current="guide" title={m.error_unexpected()} onRetry={data.retry} />;
  }
  if (cursor === undefined) return <TvStatus current="guide" title={m.guide_empty()} />;

  const focused = focusedCell(guide, cursor);
  const programme = focused?.programme;
  const channel = focused === undefined ? undefined : info.get(focused.channel.id);
  const airing = programme !== undefined && programme.start <= now && programme.end > now;
  const f = formatters();

  // The domain's pick (playTargetFor) over all of this profile's recordings; an ended
  // programme without one plays its captured range. A started recording asks Resume or From
  // start first, as on the web. Before it starts, OK opens the record options.
  const watch = () => {
    if (programme === undefined) return;
    const pick = pickProgramme(programme, data.recordings, now);
    if (pick._tag === "Sheet") setSheetFor(programme);
    else if (pick._tag === "Choose") setChoice({ title: programme.title, choice: pick.choice });
    else router.push({ pathname: "/player", params: playerParams(pick.target) });
  };
  const pick = (picked: RecordingChoice, option: ChoiceOption) => {
    setChoice(undefined);
    router.push({
      pathname: "/player",
      params: playerParams(choiceTarget(picked.recordingId, option)),
    });
  };

  return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.bg }]}>
      <View
        style={{
          position: "absolute",
          top: 2.7 * em,
          left: 4 * em,
          right: 4 * em,
          height: layout.headerHeight - 2.7 * em,
          flexDirection: "row",
          gap: 3 * em,
        }}
      >
        <View style={{ flex: 1 }}>
          <View style={[styles.row, { gap: 0.7 * em }]}>
            {airing ? <Chip label={m.status_live()} tone="live" size={0.92} /> : null}
            {programme?.mark === "recording" ? (
              <Chip label={m.status_recording()} tone="rec" size={0.92} />
            ) : null}
            {programme?.mark === "scheduled" ? (
              <Chip label={m.status_scheduled()} tone="outline" size={0.92} />
            ) : null}
            {programme?.mark === "conflict" ? (
              <Chip label={m.status_conflict()} tone="warn" size={0.92} />
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
              {[
                channel?.name,
                programme === undefined
                  ? undefined
                  : f.timeRange(new Date(programme.start), new Date(programme.end)),
              ]
                .filter((part) => part !== undefined)
                .join(" · ")}
            </Text>
          </View>
          <Text
            numberOfLines={1}
            style={{
              fontFamily: fonts.fDisplay,
              fontSize: 3.4 * em,
              lineHeight: 3.4 * em,
              marginTop: 0.5 * em,
              color: colors.fg,
            }}
          >
            {(programme?.title ?? m.guide_empty()).toUpperCase()}
          </Text>
          {description === undefined ? null : (
            <Text
              numberOfLines={2}
              style={{
                fontFamily: fonts.fUi,
                fontSize: 1.1 * em,
                color: colors.fg2,
                marginTop: 0.7 * em,
              }}
            >
              {description}
            </Text>
          )}
        </View>
        <View style={{ width: 26 * em, alignItems: "flex-end", gap: 0.3 * em }}>
          <Text
            style={{
              fontFamily: fonts.fDisplayBold,
              fontSize: 2.6 * em,
              lineHeight: 2.6 * em,
              color: colors.fg,
            }}
          >
            {f.day(new Date(cursor.anchor)).toUpperCase()}
          </Text>
          <Text style={{ fontFamily: fonts.fUi, fontSize: em, color: colors.fg3 }}>
            {m.guide_now({ now: new Date(now) })}
          </Text>
          <View
            style={[
              styles.row,
              { flexWrap: "wrap", justifyContent: "flex-end", gap: 1.1 * em, marginTop: em },
            ]}
          >
            {KEYS.map(([id, cap, label]) => (
              <View key={id} style={[styles.row, { gap: 0.35 * em }]}>
                <View
                  style={{
                    borderWidth: 1,
                    borderColor: colors.borderStrong,
                    borderRadius: 0.35 * em,
                    paddingHorizontal: 0.45 * em,
                  }}
                >
                  <Text style={{ fontFamily: fonts.fMono, fontSize: 0.92 * em, color: colors.fg }}>
                    {cap()}
                  </Text>
                </View>
                <Text style={{ fontFamily: fonts.fUi, fontSize: em, color: colors.fg2 }}>
                  {label()}
                </Text>
              </View>
            ))}
          </View>
        </View>
      </View>
      <TVFocusGuideView
        autoFocus
        trapFocusUp
        trapFocusDown
        trapFocusLeft
        trapFocusRight
        style={StyleSheet.absoluteFill}
      >
        <Pressable
          onPress={watch}
          onLongPress={() => {
            if (programme !== undefined) setSheetFor(programme);
          }}
          hasTVPreferredFocus={!railOpen}
          accessibilityLabel={programme === undefined ? m.guide_empty() : cellLabel(programme)}
          style={StyleSheet.absoluteFill}
        >
          <GuideGrid
            guide={guide}
            info={info}
            config={config}
            cursor={cursor}
            layout={layout}
            now={now}
          />
        </Pressable>
      </TVFocusGuideView>
      {railOpen ? <Rail current="guide" takeFocus onCurrent={closeRail} /> : null}
      {digits === undefined ? null : (
        <View
          style={{
            position: "absolute",
            top: layout.headerHeight,
            right: 4 * em,
            paddingHorizontal: 1.2 * em,
            paddingVertical: 0.6 * em,
            borderRadius: 0.6 * em,
            backgroundColor: colors.raised,
            zIndex: 6,
          }}
        >
          <Text style={{ fontFamily: fonts.fMonoSemiBold, fontSize: 2 * em, color: colors.fg }}>
            {m.guide_channel_entry({ digits: digits.digits })}
          </Text>
        </View>
      )}
      {sheetFor === undefined ? null : (
        <RecordSheet
          programme={sheetFor.source}
          channelName={info.get(sheetFor.channelId)?.name ?? ""}
          recordings={data.recordings}
          conflicts={data.conflicts}
          onClose={closeSheet}
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

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center" },
});
