import {
  guideWindow,
  type Guide,
  type GuideConfig,
  type GuideCursor,
  type WindowCell,
  type WindowRow,
} from "./core/index.ts";
import { type GuideDay, MINUTE, pendingBlocks } from "@slipstream/domain";
import { formatters } from "@slipstream/i18n";
import { useEffect, useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import Svg, { Path } from "react-native-svg";
import type { AppProgramme, ChannelInfo } from "../../data/guide-data.ts";
import { useTheme, type Theme } from "../../theme/theme.ts";
import { Bone, Skeleton } from "../../ui/Skeleton.tsx";
import { cellRect, showsTimeLine, type GuideLayout } from "./layout.ts";

interface CellProps {
  readonly cell: WindowCell<AppProgramme>;
  readonly layout: GuideLayout;
  readonly origin: number;
  readonly viewStart: number;
  readonly now: number;
  readonly theme: Theme;
}

/**
 * The marker before a title: recording dot, scheduled ring, conflict triangle, or the neutral
 * check of an airing the viewer already has. All take the same slot, so no geometry changes.
 */
const Mark = ({
  mark,
  size,
  theme,
  focused,
}: {
  readonly mark: AppProgramme["mark"];
  readonly size: number;
  readonly theme: Theme;
  readonly focused: boolean;
}) => {
  if (mark === undefined) return null;
  const { colors } = theme;
  const cell = theme.tokens.components.guideCell;
  if (mark === "repeat") {
    return (
      <Svg width={size * 1.2} height={size * 1.2} viewBox="0 0 24 24">
        <Path
          d="M4.5 12.5 9.5 17.5 19.5 6.5"
          stroke={focused ? cell.focusFg : colors.fg3}
          strokeWidth={3}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
      </Svg>
    );
  }
  if (mark === "conflict") {
    return (
      <Svg width={size * 1.2} height={size * 1.2} viewBox="0 0 24 24">
        <Path d="M12 2.5 22.5 21h-21z" fill={focused ? cell.focusFg : colors.warn} />
      </Svg>
    );
  }
  const color = focused ? cell.focusFg : colors.live;
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: mark === "recording" ? color : "transparent",
        borderWidth: mark === "scheduled" ? 0.22 * size : 0,
        borderColor: color,
      }}
    />
  );
};

/** One programme cell (`.cell` with `.past`, `.airing`, `.clip-l` and `.is-focus`). */
const Cell = ({ cell, layout, origin, viewStart, now, theme }: CellProps) => {
  const { fonts } = theme;
  const tokens = theme.tokens.components.guideCell;
  const { em } = layout;
  const { programme, focused } = cell;
  const rect = cellRect(cell, layout, origin, viewStart);
  const past = programme.end <= now;
  const airing = programme.start <= now && programme.end > now;
  const background = focused
    ? tokens.focusBg
    : past
      ? "transparent"
      : airing
        ? tokens.airingBg
        : tokens.bg;
  const titleColor = focused ? tokens.focusFg : past ? tokens.pastFg : theme.colors.fg;
  const timeColor = focused ? tokens.focusMeta : tokens.meta;
  const radius = 0.5 * em;
  return (
    <View
      style={{
        position: "absolute",
        left: rect.left,
        width: rect.width,
        top: 0.3 * em,
        bottom: 0.3 * em,
        backgroundColor: background,
        borderRadius: radius,
        borderTopLeftRadius: cell.clippedStart ? 0 : radius,
        borderBottomLeftRadius: cell.clippedStart ? 0 : radius,
        borderWidth: past && !focused ? 1 : 0,
        borderColor: tokens.pastBorder,
        paddingVertical: 0.4 * em,
        paddingLeft: 0.75 * em + rect.textInset,
        paddingRight: 0.75 * em,
        justifyContent: "center",
        gap: 0.15 * em,
        overflow: "hidden",
        zIndex: focused ? 3 : 2,
      }}
    >
      <View style={[styles.row, { gap: 0.4 * em }]}>
        <Mark mark={programme.mark} size={0.6 * em} theme={theme} focused={focused} />
        <Text
          numberOfLines={1}
          style={{
            flexShrink: 1,
            fontFamily: past && !focused ? fonts.fUiMedium : fonts.fUiSemiBold,
            fontSize: 1.1 * em,
            color: titleColor,
          }}
        >
          {programme.title}
        </Text>
      </View>
      {showsTimeLine(cell) ? (
        <Text
          numberOfLines={1}
          style={{ fontFamily: fonts.fMono, fontSize: 0.95 * em, color: timeColor }}
        >
          {formatters().timeRange(new Date(programme.start), new Date(programme.end))}
        </Text>
      ) : null}
      {airing ? (
        <View
          style={{
            position: "absolute",
            left: 0,
            bottom: 0,
            height: 0.22 * em,
            width: `${((now - programme.start) / (programme.end - programme.start)) * 100}%`,
            backgroundColor: focused ? tokens.focusProgress : tokens.progress,
          }}
        />
      ) : null}
    </View>
  );
};

interface RowProps {
  readonly row: WindowRow<AppProgramme>;
  readonly layout: GuideLayout;
  readonly origin: number;
  readonly viewStart: number;
  readonly now: number;
  readonly theme: Theme;
}

/** The programme track of one channel. */
const TrackRow = ({ row, layout, origin, viewStart, now, theme }: RowProps) => (
  <View
    style={{
      position: "absolute",
      top: row.row * layout.rowHeight,
      left: 0,
      height: layout.rowHeight,
      right: 0,
    }}
  >
    {row.cells.map((cell) => (
      <Cell
        key={cell.programme.id}
        cell={cell}
        layout={layout}
        origin={origin}
        viewStart={viewStart}
        now={now}
        theme={theme}
      />
    ))}
  </View>
);

/** Props for {@link GuideGrid}. */
export interface GuideGridProps {
  readonly guide: Guide<AppProgramme>;
  readonly info: ReadonlyMap<string, ChannelInfo>;
  readonly config: GuideConfig;
  readonly cursor: GuideCursor;
  readonly layout: GuideLayout;
  readonly now: number;
  /** The days not loaded yet: skeleton cells stand in their stretch, never an empty track. */
  readonly pending: readonly GuideDay[];
}

/** One skeleton cell where a day still loads: an hour and a half, as on the phone. */
const PENDING_BLOCK_MS = 90 * MINUTE;

/**
 * The guide grid below the header: ruler, channel column, programme tracks and the now line.
 * Only the window around the viewport is rendered; the whole track is translated on the UI
 * thread so cursor moves scroll smoothly without re-laying out cells.
 */
export const GuideGrid = ({
  guide,
  info,
  config,
  cursor,
  layout,
  now,
  pending,
}: GuideGridProps) => {
  const theme = useTheme();
  const { colors, fonts, motion } = theme;
  const { em } = layout;
  const origin = guide.start;
  const window = useMemo(() => guideWindow(guide, config, cursor), [guide, config, cursor]);
  // Measured from the origin like the cells, so a day's programmes land where its blocks were.
  const loading = pendingBlocks({
    days: pending,
    window: { from: origin, to: Math.max(guide.end, ...pending.map((day) => day.end)) },
    ppm: layout.pxPerMs * MINUTE,
    near: { from: window.from, to: window.to },
    blockMs: PENDING_BLOCK_MS,
  });
  const scrollX = useSharedValue((cursor.viewStart - origin) * layout.pxPerMs);
  const scrollY = useSharedValue(cursor.topRow * layout.rowHeight);

  useEffect(() => {
    const timing = { duration: motion.tPanel, easing: Easing.bezier(...motion.easing) };
    scrollX.value = withTiming((cursor.viewStart - origin) * layout.pxPerMs, timing);
    scrollY.value = withTiming(cursor.topRow * layout.rowHeight, timing);
  }, [cursor.viewStart, cursor.topRow, origin, layout, motion, scrollX, scrollY]);

  const trackStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: -scrollX.value }, { translateY: -scrollY.value }],
  }));
  const rulerStyle = useAnimatedStyle(() => ({ transform: [{ translateX: -scrollX.value }] }));
  const channelStyle = useAnimatedStyle(() => ({ transform: [{ translateY: -scrollY.value }] }));
  const nowX = (now - origin) * layout.pxPerMs;
  const gridHeight = guide.channels.length * layout.rowHeight;
  const divider = { borderBottomWidth: 1, borderColor: colors.line };

  return (
    <View
      style={{
        position: "absolute",
        top: layout.headerHeight,
        left: layout.inset,
        right: 0,
        bottom: 0,
      }}
    >
      <View
        style={{
          height: layout.rulerHeight,
          marginLeft: layout.channelWidth,
          overflow: "hidden",
          ...divider,
        }}
      >
        <Animated.View style={[StyleSheet.absoluteFill, rulerStyle]}>
          {window.ticks.map((tick) => (
            <View
              key={tick}
              style={{
                position: "absolute",
                left: (tick - origin) * layout.pxPerMs,
                bottom: 0.5 * em,
                paddingLeft: 0.4 * em,
                borderLeftWidth: 1,
                borderColor: colors.line,
              }}
            >
              <Text style={{ fontFamily: fonts.fMono, fontSize: 0.95 * em, color: colors.fg3 }}>
                {formatters().time(new Date(tick))}
              </Text>
            </View>
          ))}
          <View
            style={{
              position: "absolute",
              left: nowX,
              bottom: 0.3 * em,
              transform: [{ translateX: -2.2 * em }],
              backgroundColor: colors.liveSolid,
              borderRadius: 0.35 * em,
              paddingHorizontal: 0.45 * em,
              paddingVertical: 0.2 * em,
              zIndex: 2,
            }}
          >
            <Text
              style={{ fontFamily: fonts.fMonoSemiBold, fontSize: 0.95 * em, color: colors.onLive }}
            >
              {formatters().time(new Date(now))}
            </Text>
          </View>
        </Animated.View>
      </View>
      <View style={[styles.row, { flex: 1, alignItems: "stretch" }]}>
        <View style={{ width: layout.channelWidth, overflow: "hidden" }}>
          <Animated.View style={channelStyle}>
            {window.rows.map((row) => {
              const channel = info.get(row.channel.id);
              return (
                <View
                  key={row.channel.id}
                  style={[
                    styles.row,
                    {
                      position: "absolute",
                      top: row.row * layout.rowHeight,
                      left: 0,
                      right: 0,
                      height: layout.rowHeight,
                      gap: 0.8 * em,
                      paddingRight: em,
                      ...divider,
                    },
                  ]}
                >
                  <Text
                    style={{
                      width: 2.2 * em,
                      fontFamily: fonts.fMono,
                      fontSize: 0.95 * em,
                      color: colors.fg3,
                    }}
                  >
                    {row.channel.number >= 0 ? row.channel.number : ""}
                  </Text>
                  <View
                    style={{
                      width: 2.6 * em,
                      height: 1.9 * em,
                      borderRadius: 0.35 * em,
                      backgroundColor: colors.raised,
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <Text
                      numberOfLines={1}
                      style={{
                        fontFamily: fonts.fUiSemiBold,
                        fontSize: 0.8 * em,
                        color: colors.fg2,
                      }}
                    >
                      {channel?.mark ?? ""}
                    </Text>
                  </View>
                  <Text
                    numberOfLines={1}
                    style={{
                      flex: 1,
                      fontFamily: fonts.fUiMedium,
                      fontSize: 1.1 * em,
                      color: row.row === cursor.row ? colors.fg : colors.fg2,
                    }}
                  >
                    {channel?.name ?? row.channel.id}
                  </Text>
                </View>
              );
            })}
          </Animated.View>
        </View>
        <View style={{ flex: 1, overflow: "hidden" }}>
          <Animated.View style={[StyleSheet.absoluteFill, trackStyle]}>
            <View
              style={{
                position: "absolute",
                left: nowX,
                top: 0,
                height: gridHeight,
                width: 2,
                backgroundColor: colors.live,
                zIndex: 1,
              }}
            />
            {window.rows.map((row) => (
              <TrackRow
                key={row.channel.id}
                row={row}
                layout={layout}
                origin={origin}
                viewStart={cursor.viewStart}
                now={now}
                theme={theme}
              />
            ))}
            {loading.length === 0 ? null : (
              <Skeleton style={StyleSheet.absoluteFill}>
                {window.rows.flatMap((row) =>
                  loading.map((block) => (
                    <Bone
                      key={`${row.channel.id}:${block.x}`}
                      width={block.width}
                      height={layout.rowHeight - 0.6 * em}
                      radius={0.5 * em}
                      style={{
                        position: "absolute",
                        left: block.x,
                        top: row.row * layout.rowHeight + 0.3 * em,
                      }}
                    />
                  )),
                )}
              </Skeleton>
            )}
          </Animated.View>
        </View>
      </View>
    </View>
  );
};

/**
 * Each placeholder row's programmes as [start, width] fractions of the track: varied, like a
 * schedule.
 */
const BONE_CELLS: readonly (readonly (readonly [number, number])[])[] = [
  [
    [0, 0.3],
    [0.3, 0.45],
    [0.75, 0.25],
  ],
  [
    [0, 0.55],
    [0.55, 0.45],
  ],
  [
    [0, 0.2],
    [0.2, 0.35],
    [0.55, 0.45],
  ],
  [
    [0, 0.4],
    [0.4, 0.6],
  ],
];

/**
 * The guide while it loads (inside a full-screen TvSkeleton): the header's lines and the grid's
 * rows in the loaded guide's geometry, so the programmes arrive in place.
 */
export const GuideBones = ({ layout }: { readonly layout: GuideLayout }) => {
  const { em } = layout;
  const rowsTop = layout.headerHeight + layout.rulerHeight;
  // The ruler's half-hour labels: the loaded guide shows three hours across the track.
  const slot = layout.trackWidth / 6;
  return (
    <>
      {Array.from({ length: 6 }, (_, tick) => (
        <Bone
          key={`tick:${tick}`}
          width={3 * em}
          height={0.95 * em}
          style={{
            position: "absolute",
            top: rowsTop - 0.5 * em - 1.2 * em,
            left: layout.inset + layout.channelWidth + tick * slot + 0.4 * em,
          }}
        />
      ))}
      <View style={{ position: "absolute", top: 2.7 * em, left: 4 * em, gap: 0.5 * em }}>
        <Bone width={18 * em} height={1.15 * em} />
        <Bone width={36 * em} height={3.4 * em} />
      </View>
      <Bone
        width={12 * em}
        height={2.6 * em}
        style={{ position: "absolute", top: 2.7 * em, right: 4 * em }}
      />
      {Array.from({ length: layout.visibleRows }, (_, row) => {
        const cells = BONE_CELLS[row % BONE_CELLS.length] ?? [];
        return (
          <View
            key={row}
            style={{
              position: "absolute",
              top: rowsTop + row * layout.rowHeight,
              left: layout.inset,
              right: 0,
              height: layout.rowHeight,
            }}
          >
            <Bone
              width={layout.channelWidth - 2 * em}
              height={1.9 * em}
              style={{ position: "absolute", top: 1.2 * em, left: 0 }}
            />
            {cells.map(([start, share]) => (
              <Bone
                key={start}
                width={Math.max(0, share * layout.trackWidth - layout.gap)}
                height={layout.rowHeight - 0.6 * em}
                radius={0.5 * em}
                style={{
                  position: "absolute",
                  top: 0.3 * em,
                  left: layout.channelWidth + start * layout.trackWidth,
                }}
              />
            ))}
          </View>
        );
      })}
    </>
  );
};

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center" },
});
