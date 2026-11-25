import {
  cellsInView,
  type Channel,
  epochMs,
  type GridScroll,
  gridView,
  type GuideDay,
  type GuideEntry,
  type GuideWindow,
  MINUTE,
  pendingBlocks,
  pillDay,
  type PlacedCell,
  placeRow,
  type ProgrammeMark,
  rulerTicks,
  sameGridView,
  scrollLeftFor,
  visibleDayAt,
  windowWidth,
  xOf,
} from "@slipstream/domain";
import { formatters, m } from "@slipstream/i18n";
import {
  memo,
  type ReactNode,
  type Ref,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Pressable, ScrollView, Text, useWindowDimensions, View } from "react-native";
import Animated, {
  Extrapolation,
  interpolate,
  type SharedValue,
  useAnimatedRef,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
} from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { useTheme } from "../../theme/theme.ts";
import { ChannelArt } from "../../ui/ChannelArt.tsx";
import { Bone, Skeleton } from "../../ui/Skeleton.tsx";

/** Pixels per minute: half an hour is a thumb's sweep (the web's phone density). */
const PHONE_PPM = 4;

/**
 * How far a sideways scroll goes before the JS side hears of it, dp: enough to draw the cells
 * near the view and name the day, without a render per frame.
 */
const REPORT_EVERY_DP = 48;

/** What the guide screen can ask of the grid. */
export interface PhoneGuideGridHandle {
  /** Scrolls so `time` shows with some context before it. */
  readonly scrollToTime: (time: number, animated: boolean) => void;
  /** The time at the left edge of the cells in view. */
  readonly timeInView: () => number;
}

interface Props {
  readonly channels: readonly Channel[];
  readonly rows: ReadonlyMap<string, readonly GuideEntry[]>;
  readonly marks: ReadonlyMap<string, ProgrammeMark>;
  readonly window: GuideWindow;
  readonly days: readonly GuideDay[];
  /** Days not loaded yet: skeleton cells hold their stretch until their programmes arrive. */
  readonly pending: readonly GuideDay[];
  /** The time now: the grid opens on it, with context before it. */
  readonly now: number;
  readonly onVisibleDay: (day: GuideDay) => void;
  readonly onOpen: (programme: GuideEntry, channel: Channel) => void;
  /** A finger came down on a programme: its details can start loading before the sheet opens. */
  readonly onTouch: (programme: GuideEntry) => void;
  readonly onChannel: (channel: Channel) => void;
}

/** The grid's measures in dp, shared with its skeleton so the loaded grid lands in place. */
const gridMetrics = (em: number) => ({
  channelWidth: 4.4 * em,
  rowHeight: 4.2 * em,
  rulerHeight: 2.1 * em,
  gap: 0.2 * em,
});

/** Cell widths of the skeleton's rows, in em, repeating: a believable schedule, not a pattern. */
const SKELETON_CELLS: readonly (readonly number[])[] = [
  [9, 5, 12, 7],
  [6, 6, 10, 8],
  [14, 9, 6],
  [11, 13],
  [7, 9, 8, 6],
  [16, 7],
  [5, 8, 11, 9],
  [10, 6, 12],
];

/** The guide while it loads: the channel column, the ruler and rows of cells in quiet blocks. */
export const PhoneGuideSkeleton = () => {
  const { em, colors, radii } = useTheme();
  const { height } = useWindowDimensions();
  const { channelWidth, rowHeight, rulerHeight, gap } = gridMetrics(em);
  const rows = Math.ceil(height / rowHeight);
  return (
    <Skeleton>
      <View
        style={{
          height: rulerHeight,
          borderBottomWidth: 1,
          borderColor: colors.line,
          flexDirection: "row",
          alignItems: "center",
          gap: 4 * em,
          paddingLeft: channelWidth + 0.4 * em,
        }}
      >
        {[0, 1, 2].map((index) => (
          <Bone key={index} width={3.6 * em} height={0.7 * em} />
        ))}
      </View>
      {Array.from({ length: rows }, (_, row) => (
        <View key={row} style={{ height: rowHeight, flexDirection: "row", alignItems: "center" }}>
          <View style={{ width: channelWidth, alignItems: "center", gap: 0.2 * em }}>
            <Bone width={3.4 * em} height={2.2 * em} radius={radii.rS} />
            <Bone width={0.9 * em} height={0.6 * em} />
          </View>
          <View style={{ flexDirection: "row", gap: 2 * gap, overflow: "hidden", flex: 1 }}>
            {(SKELETON_CELLS[row % SKELETON_CELLS.length] ?? []).map((width, index, all) => (
              // Keyed by where the cell starts in its row (the sum of the widths before it).
              <Bone
                key={all.slice(0, index).reduce((sum, before) => sum + before, 0)}
                width={width * em}
                height={rowHeight - 2 * gap}
                radius={radii.rS}
              />
            ))}
          </View>
        </View>
      ))}
    </Skeleton>
  );
};

/** What one cell is drawn from; everything but `cell` is stable across scrolls. */
interface CellProps {
  readonly cell: PlacedCell;
  readonly channel: Channel;
  readonly top: number;
  readonly height: number;
  readonly scrollX: SharedValue<number>;
  readonly onOpen: (programme: GuideEntry, channel: Channel) => void;
  readonly onTouch: (programme: GuideEntry) => void;
}

/**
 * Whether a cell would draw the same: a scroll or a clock tick places the row again (new cell
 * objects), but a cell whose programme, place, state and marker are unchanged keeps its view.
 */
const sameCell = (before: CellProps, after: CellProps): boolean =>
  before.channel === after.channel &&
  before.top === after.top &&
  before.height === after.height &&
  before.scrollX === after.scrollX &&
  before.onOpen === after.onOpen &&
  before.onTouch === after.onTouch &&
  before.cell.programme === after.cell.programme &&
  before.cell.x === after.cell.x &&
  before.cell.width === after.cell.width &&
  before.cell.when === after.cell.when &&
  before.cell.size === after.cell.size &&
  before.cell.mark?.state === after.cell.mark?.state &&
  // The progress bar moves only while it airs.
  (after.cell.when !== "airing" || before.cell.progress === after.cell.progress);

/** A ruler label; it fades as its start slides under the channel column, never cut. */
const RulerLabel = ({
  x,
  strong,
  scrollX,
  children,
}: {
  readonly x: number;
  readonly strong: boolean;
  readonly scrollX: SharedValue<number>;
  readonly children: string;
}) => {
  const { colors, em, fonts } = useTheme();
  const fade = useAnimatedStyle(() => ({
    opacity: interpolate(scrollX.value, [x - 2, x + 6], [1, 0], Extrapolation.CLAMP),
  }));
  return (
    <Animated.Text
      numberOfLines={1}
      style={[
        fade,
        {
          position: "absolute",
          left: x + 0.4 * em,
          top: 0.55 * em,
          fontFamily: strong ? fonts.fMonoSemiBold : fonts.fMono,
          fontSize: 0.75 * em,
          color: strong ? colors.fg : colors.fg3,
        },
      ]}
    >
      {children}
    </Animated.Text>
  );
};

/**
 * A cell's words: they follow the view's left edge on the UI thread when the cell has room for
 * that (`slide`), and stay put otherwise, so only long cells run an animation while scrolling.
 */
const CellWords = ({
  x,
  slide,
  scrollX,
  gap,
  children,
}: {
  readonly x: number;
  readonly slide: number;
  readonly scrollX: SharedValue<number>;
  readonly gap: number;
  readonly children: ReactNode;
}) =>
  slide > 0 ? (
    <FollowingWords x={x} slide={slide} scrollX={scrollX} gap={gap}>
      {children}
    </FollowingWords>
  ) : (
    <View style={{ gap }}>{children}</View>
  );

const FollowingWords = ({
  x,
  slide,
  scrollX,
  gap,
  children,
}: {
  readonly x: number;
  readonly slide: number;
  readonly scrollX: SharedValue<number>;
  readonly gap: number;
  readonly children: ReactNode;
}) => {
  const follow = useAnimatedStyle(() => ({
    transform: [{ translateX: Math.min(Math.max(scrollX.value - x, 0), slide) }],
  }));
  return <Animated.View style={[follow, { gap }]}>{children}</Animated.View>;
};

/** One programme on a row; a long one keeps its title in view while the row scrolls. */
const Cell = memo(function Cell({
  cell,
  channel,
  top,
  height,
  scrollX,
  onOpen,
  onTouch,
}: CellProps) {
  const past = cell.when === "past";
  const { colors, em, fonts, radii } = useTheme();
  const f = formatters();
  const pad = 0.6 * em;
  const room = cell.width - 2 * pad;
  // The title follows the left edge of the view until it would leave the cell; a cell too
  // short for that keeps it still, with no animation to run on every frame of a scroll.
  const slide = Math.max(0, room - 4.5 * em);
  const airing = cell.when === "airing";
  const dot =
    cell.mark?.state === "recording"
      ? colors.liveSolid
      : cell.mark?.state === "conflict"
        ? colors.warn
        : cell.mark?.state === "scheduled"
          ? colors.brand
          : undefined;
  const { programme } = cell;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${programme.title}, ${m.guide_cell_time({
        start: new Date(epochMs(programme.start)),
        end: new Date(epochMs(programme.end)),
      })}`}
      onPressIn={() => onTouch(programme)}
      onPress={() => onOpen(programme, channel)}
      style={({ pressed }) => ({
        position: "absolute",
        left: cell.x,
        top,
        width: cell.width,
        height,
        borderRadius: radii.rS,
        backgroundColor: pressed ? colors.borderStrong : airing ? colors.raised : colors.surface,
        paddingHorizontal: cell.size === "micro" ? 0 : pad,
        justifyContent: "center",
        overflow: "hidden",
      })}
    >
      {cell.size === "micro" ? null : (
        <CellWords x={cell.x} slide={slide} scrollX={scrollX} gap={0.15 * em}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 0.35 * em }}>
            {dot === undefined ? null : (
              <View
                style={{
                  width: 0.5 * em,
                  height: 0.5 * em,
                  borderRadius: 0.25 * em,
                  backgroundColor: dot,
                }}
              />
            )}
            <Text
              numberOfLines={1}
              style={{
                flexShrink: 1,
                maxWidth: Math.max(0, room),
                fontFamily: fonts.fUiSemiBold,
                fontSize: 0.88 * em,
                color: past ? colors.fg3 : colors.fg,
              }}
            >
              {programme.title}
            </Text>
          </View>
          {cell.size === "full" ? (
            <Text
              numberOfLines={1}
              style={{
                maxWidth: Math.max(0, room),
                fontFamily: fonts.fUi,
                fontSize: 0.75 * em,
                color: colors.fg3,
              }}
            >
              {f.time(new Date(epochMs(programme.start)))}
            </Text>
          ) : null}
        </CellWords>
      )}
      {airing ? (
        <View
          style={{
            position: "absolute",
            left: 0,
            bottom: 0,
            height: 0.18 * em,
            width: `${Math.round(cell.progress * 100)}%`,
            backgroundColor: colors.brand,
          }}
        />
      ) : null}
    </Pressable>
  );
}, sameCell);

/**
 * The channel column: fixed while the cells scroll sideways; a tap watches the channel. Its own
 * memoised part, so a sideways scroll that places new cells leaves every logo alone.
 */
const ChannelColumn = memo(function ChannelColumn({
  channels,
  onChannel,
}: {
  readonly channels: readonly Channel[];
  readonly onChannel: (channel: Channel) => void;
}) {
  const { colors, em, fonts, radii } = useTheme();
  const { channelWidth, rowHeight } = gridMetrics(em);
  return (
    <View style={{ width: channelWidth }}>
      {channels.map((channel) => (
        <Pressable
          key={channel.id}
          accessibilityRole="button"
          accessibilityLabel={m.guide_watch_channel_live({ channel: channel.name })}
          onPress={() => onChannel(channel)}
          style={({ pressed }) => ({
            height: rowHeight,
            alignItems: "center",
            justifyContent: "center",
            gap: 0.2 * em,
            opacity: pressed ? 0.6 : 1,
          })}
        >
          <View
            style={{
              width: 3.4 * em,
              height: 2.2 * em,
              borderRadius: radii.rS,
              backgroundColor: colors.surface,
              overflow: "hidden",
            }}
          >
            <ChannelArt channelId={channel.id} height={1.3 * em} />
          </View>
          <Text
            numberOfLines={1}
            style={{ fontFamily: fonts.fMono, fontSize: 0.7 * em, color: colors.fg3 }}
          >
            {channel.number ?? ""}
          </Text>
        </Pressable>
      ))}
    </View>
  );
});

/**
 * The phone's timeline guide (the web's timeline on a phone): one continuous track across the
 * household's days up to where the guide data ends, the channel column fixed at the left, the
 * time ruler fixed on top and following the cells, and a now line. Only the cells near the
 * view are drawn; the ruler and the long titles follow the scroll on the native side.
 */
export const PhoneGuideGrid = ({
  ref,
  channels,
  rows,
  marks,
  window,
  days,
  pending,
  now,
  onVisibleDay,
  onOpen,
  onTouch,
  onChannel,
}: Props & { readonly ref?: Ref<PhoneGuideGridHandle> }) => {
  const { colors, em, fonts, radii } = useTheme();
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const { channelWidth, rowHeight, rulerHeight, gap } = gridMetrics(em);
  const trackWidth = windowWidth(window, PHONE_PPM);
  const viewWidth = screenWidth - channelWidth;
  // Where a time is scrolled to: the web's lead before it, never past the track's end.
  const leftFor = (time: number) =>
    Math.min(scrollLeftFor(window, time, PHONE_PPM), Math.max(0, trackWidth - viewWidth));
  // Where the grid opens; only the first render's value is used.
  const startX = leftFor(now);
  // Fixed at the first render: a new offset object would make Android jump back to it.
  const [initialOffset] = useState(() => ({ x: startX, y: 0 }));
  // Where the cells are scrolled, on the UI thread: the ruler and the long titles follow it there.
  const scrollX = useSharedValue(startX);
  const scroller = useAnimatedRef<Animated.ScrollView>();
  const x = useRef(startX);
  // The scroll the drawn part follows; it changes only when the drawn part would (`gridView`).
  const [scroll, setScroll] = useState<GridScroll>(() => ({
    left: startX,
    top: 0,
    width: viewWidth,
    height: screenHeight,
  }));
  const view = gridView(scroll, rowHeight, channels.length);
  const follow = (patch: Partial<GridScroll>) => {
    const next = { ...scroll, ...patch, width: viewWidth, height: screenHeight };
    if (!sameGridView(gridView(next, rowHeight, channels.length), view)) setScroll(next);
  };
  const lastDay = useRef<string | undefined>(undefined);
  const f = formatters();

  const timeAt = (left: number) => window.from + (left / PHONE_PPM) * MINUTE;
  const reportDay = (left: number) => {
    const day = visibleDayAt(days, window, left, viewWidth, PHONE_PPM);
    if (day.key !== lastDay.current) {
      lastDay.current = day.key;
      onVisibleDay(day);
    }
  };

  useImperativeHandle(ref, () => ({
    scrollToTime: (time, animated) => {
      const target = leftFor(time);
      // The cells and the day are moved to the target before the scroll starts: the scroll's own
      // reports come in steps and after the fact, so a day's jump would otherwise land on an
      // empty grid, fill it as the glide ends and only then name the new day.
      follow({ left: target });
      reportDay(target);
      // A long way jumps to most of a screen before the target and glides only the rest.
      const distance = target - x.current;
      if (animated && Math.abs(distance) > 1.5 * viewWidth) {
        scroller.current?.scrollTo({
          x: target - Math.sign(distance) * 0.75 * viewWidth,
          animated: false,
        });
      }
      scroller.current?.scrollTo({ x: target, animated });
    },
    timeInView: () => timeAt(x.current),
  }));

  // What a horizontal scroll does on the JS side, kept fresh for the one event created below.
  const onX = useRef<(left: number) => void>(() => undefined);
  useLayoutEffect(() => {
    onX.current = (left) => {
      x.current = left;
      follow({ left });
      reportDay(left);
    };
  });
  // Called from the UI thread; stable, so the handler below never goes stale.
  const [scrolled] = useState(() => (left: number) => onX.current(left));
  // The JS side hears of the scroll every REPORT_EVERY_DP and when it settles.
  const reported = useSharedValue(startX);
  const onScrollX = useAnimatedScrollHandler({
    onScroll: (event) => {
      scrollX.value = event.contentOffset.x;
      if (Math.abs(event.contentOffset.x - reported.value) > REPORT_EVERY_DP) {
        reported.value = event.contentOffset.x;
        scheduleOnRN(scrolled, event.contentOffset.x);
      }
    },
    onMomentumEnd: (event) => {
      reported.value = event.contentOffset.x;
      scheduleOnRN(scrolled, event.contentOffset.x);
    },
    onEndDrag: (event) => {
      reported.value = event.contentOffset.x;
      scheduleOnRN(scrolled, event.contentOffset.x);
    },
  });

  const rulerShift = useAnimatedStyle(() => ({ transform: [{ translateX: -scrollX.value }] }));

  // The rows in view placed whole, then only their cells in the drawn stretch (as the web does).
  const { rowFrom, rowTo, xFrom, xTo } = view;
  const placedRows = useMemo(
    () =>
      channels.map((channel, index) =>
        index < rowFrom || index >= rowTo
          ? []
          : placeRow(rows.get(channel.id) ?? [], window, now, PHONE_PPM, marks),
      ),
    [channels, rows, marks, window, now, rowFrom, rowTo],
  );
  const placed = placedRows.map((cells) => {
    const shown = cellsInView(cells, xFrom, xTo);
    return cells.slice(shown.from, shown.to);
  });

  // Days still loading, in the screens around the view: skeleton cells, never an empty stretch.
  const loading = pendingBlocks({
    days: pending,
    window,
    ppm: PHONE_PPM,
    near: { from: timeAt(xFrom), to: timeAt(xTo) },
    // One skeleton cell: an hour and a half.
    blockMs: 90 * MINUTE,
  });

  const nowX = now >= window.from && now < window.to ? xOf(window, now, PHONE_PPM) : undefined;
  const ticks = rulerTicks(window, PHONE_PPM, nowX, days);

  return (
    <View style={{ flex: 1 }}>
      {/* The ruler: fixed on top, its labels moving with the cells. */}
      <View
        style={{
          height: rulerHeight,
          flexDirection: "row",
          borderBottomWidth: 1,
          borderColor: colors.line,
        }}
      >
        <View style={{ width: channelWidth }} />
        <View style={{ flex: 1, overflow: "hidden" }}>
          <Animated.View style={[rulerShift, { width: trackWidth, height: rulerHeight }]}>
            {ticks.map((tick) =>
              tick.covered ? null : (
                <RulerLabel
                  key={tick.at}
                  x={tick.x}
                  strong={tick.day !== undefined}
                  scrollX={scrollX}
                >
                  {tick.day === undefined
                    ? f.time(new Date(tick.at))
                    : m.guide_day_pill({ day: pillDay(tick.day), date: tick.day.date })}
                </RulerLabel>
              ),
            )}
            {nowX === undefined ? null : (
              <View
                style={{
                  position: "absolute",
                  left: nowX - 2.2 * em,
                  top: 0.3 * em,
                  width: 4.4 * em,
                  paddingVertical: 0.15 * em,
                  borderRadius: radii.rS,
                  backgroundColor: colors.liveSolid,
                  alignItems: "center",
                }}
              >
                <Text
                  style={{
                    fontFamily: fonts.fMonoSemiBold,
                    fontSize: 0.72 * em,
                    color: colors.onLive,
                  }}
                >
                  {f.time(new Date(now))}
                </Text>
              </View>
            )}
          </Animated.View>
        </View>
      </View>
      <ScrollView
        style={{ flex: 1 }}
        scrollEventThrottle={64}
        onScroll={(event) => follow({ top: event.nativeEvent.contentOffset.y })}
      >
        <View style={{ flexDirection: "row" }}>
          <ChannelColumn channels={channels} onChannel={onChannel} />
          <Animated.ScrollView
            ref={scroller}
            horizontal
            showsHorizontalScrollIndicator={false}
            contentOffset={initialOffset}
            scrollEventThrottle={16}
            onScroll={onScrollX}
            onLayout={() => reportDay(x.current)}
          >
            <View style={{ width: trackWidth, height: channels.length * rowHeight }}>
              {/* The now line runs behind the cells, as on the web and the TV: it shows in the
                  gaps between them and never crosses a title. First, so cells draw over it. */}
              {nowX === undefined ? null : (
                <View
                  pointerEvents="none"
                  style={{
                    position: "absolute",
                    left: nowX - 1,
                    top: 0,
                    bottom: 0,
                    width: 2,
                    backgroundColor: colors.live,
                  }}
                />
              )}
              {placed.map((cells, index) => {
                const channel = channels[index];
                if (channel === undefined) return null;
                return cells.map((cell) => (
                  <Cell
                    key={cell.programme.id}
                    cell={cell}
                    channel={channel}
                    top={index * rowHeight + gap}
                    height={rowHeight - 2 * gap}
                    scrollX={scrollX}
                    onOpen={onOpen}
                    onTouch={onTouch}
                  />
                ));
              })}
              {loading.length === 0 ? null : (
                <Skeleton>
                  {channels.slice(rowFrom, rowTo).flatMap((channel, offset) =>
                    loading.map((block) => (
                      <Bone
                        key={`${channel.id}:${block.x}`}
                        width={block.width}
                        height={rowHeight - 2 * gap}
                        radius={radii.rS}
                        style={{
                          position: "absolute",
                          left: block.x,
                          top: (rowFrom + offset) * rowHeight + gap,
                        }}
                      />
                    )),
                  )}
                </Skeleton>
              )}
            </View>
          </Animated.ScrollView>
        </View>
      </ScrollView>
    </View>
  );
};
