import { m } from "@slipstream/i18n";
import { useRouter, type Href } from "expo-router";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, TVFocusGuideView, View } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useDerivedValue,
  withTiming,
} from "react-native-reanimated";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";
import { useTheme } from "../theme/theme.ts";
import { BrandMark } from "../ui/BrandMark.tsx";
import { Icon, type IconName } from "../ui/Icon.tsx";
import { useToTabRoot } from "./library/use-tv-navigation.ts";
import { RAIL_COLLAPSED_EM } from "./rail-metrics.ts";

/** A destination in the TV navigation rail. */
export type RailItem = "home" | "guide" | "recordings" | "search" | "settings";

const items: readonly {
  readonly id: RailItem;
  readonly icon: IconName;
  readonly label: () => string;
  readonly href: Href;
}[] = [
  { id: "home", icon: "home", label: () => m.nav_home(), href: "/" },
  { id: "guide", icon: "guide", label: () => m.nav_guide(), href: "/guide" },
  { id: "recordings", icon: "rec", label: () => m.nav_recordings(), href: "/recordings" },
  { id: "search", icon: "search", label: () => m.nav_search(), href: "/search" },
  { id: "settings", icon: "gear", label: () => m.nav_settings(), href: "/settings" },
];

/** Expanded width with labels, room for the longest ("Einstellungen", "Recordings"). */
const RAIL_EXPANDED_EM = 15;

/** One rail entry: an icon, and its label while the rail is expanded. */
const RailButton = ({
  icon,
  label,
  current,
  expanded,
  preferredFocus,
  onFocus,
  onBlur,
  onPress,
}: {
  readonly icon: IconName;
  readonly label: string;
  readonly current: boolean;
  readonly expanded: boolean;
  readonly preferredFocus: boolean;
  readonly onFocus: () => void;
  readonly onBlur: () => void;
  readonly onPress: () => void;
}) => {
  const { colors, em, fonts } = useTheme();
  const [focused, setFocused] = useState(false);
  const fg = focused ? colors.onBrand : current ? colors.fg : colors.fg3;
  return (
    <Pressable
      onPress={onPress}
      onFocus={() => {
        setFocused(true);
        onFocus();
      }}
      onBlur={() => {
        setFocused(false);
        onBlur();
      }}
      hasTVPreferredFocus={preferredFocus}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: current }}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 0.9 * em,
        height: 3.2 * em,
        paddingHorizontal: 0.9 * em,
        borderRadius: 1.6 * em,
        backgroundColor: focused ? colors.brand : "transparent",
      }}
    >
      {/* Where you are: a short amber bar before the icon, not a grey disc behind it. */}
      <View
        style={{
          position: "absolute",
          left: 0.05 * em,
          width: 0.22 * em,
          height: 1.3 * em,
          borderRadius: 0.11 * em,
          backgroundColor: current && !focused ? colors.brand : "transparent",
        }}
      />
      <Icon name={icon} size={1.5 * em} color={fg} />
      {expanded ? (
        <Text
          numberOfLines={1}
          style={{ fontFamily: fonts.fUiSemiBold, fontSize: 1.1 * em, color: fg }}
        >
          {label}
        </Text>
      ) : null}
    </Pressable>
  );
};

/**
 * The TV navigation rail (`.rail`, Google TV, Torsher): a column of quiet icons, the current one
 * marked by a short amber bar; while any item has focus it opens to labelled items over a shade
 * that fades out to the right, so the screen behind stays in view. Left from a screen's content
 * reaches it, Right goes back to the content (`RailContent`). The current item, pressed on a page
 * inside its tab (a recording, Scheduled), goes back to the tab's first screen.
 */
export const Rail = ({
  current,
  takeFocus = false,
  onCurrent,
}: {
  readonly current: RailItem;
  /** The current item takes focus as the rail shows (the guide's Back). */
  readonly takeFocus?: boolean;
  /** What the current item does instead of going to its tab's first screen. */
  readonly onCurrent?: (() => void) | undefined;
}) => {
  const { colors, em, motion } = useTheme();
  const router = useRouter();
  const toTabRoot = useToTabRoot();
  const [expanded, setExpanded] = useState(false);
  const collapseTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Moving between items blurs one before focusing the next; wait a beat before collapsing.
  const onFocus = () => {
    if (collapseTimer.current !== undefined) clearTimeout(collapseTimer.current);
    setExpanded(true);
  };
  const onBlur = () => {
    collapseTimer.current = setTimeout(() => setExpanded(false), 80);
  };
  useEffect(
    () => () => {
      if (collapseTimer.current !== undefined) clearTimeout(collapseTimer.current);
    },
    [],
  );

  const progress = useDerivedValue(() =>
    withTiming(expanded ? 1 : 0, {
      duration: motion.tPanel,
      easing: Easing.bezier(...motion.easing),
    }),
  );
  const collapsed = RAIL_COLLAPSED_EM * em;
  const full = RAIL_EXPANDED_EM * em;
  const widthStyle = useAnimatedStyle(() => ({
    width: collapsed + (full - collapsed) * progress.value,
  }));

  return (
    <>
      {expanded ? (
        <Svg
          pointerEvents="none"
          style={{ position: "absolute", top: 0, bottom: 0, left: 0, zIndex: 4 }}
          width={3 * full}
          height="100%"
        >
          <Defs>
            <LinearGradient id="railShade" x1="0" y1="0" x2="1" y2="0">
              <Stop offset="0" stopColor={colors.bg} stopOpacity="1" />
              <Stop offset="0.42" stopColor={colors.bg} stopOpacity="0.97" />
              <Stop offset="1" stopColor={colors.bg} stopOpacity="0" />
            </LinearGradient>
          </Defs>
          <Rect x="0" y="0" width="100%" height="100%" fill="url(#railShade)" />
        </Svg>
      ) : null}
      <Animated.View
        style={[
          {
            position: "absolute",
            top: 0,
            bottom: 0,
            left: 0,
            paddingTop: 2.7 * em,
            paddingLeft: 1.2 * em,
            zIndex: 5,
          },
          widthStyle,
        ]}
      >
        {/* On the icons' axis: 1.2 em rail inset + 0.9 em button inset + half a 1.5 em icon. */}
        <View style={{ paddingLeft: 0.55 * em, marginBottom: 2.2 * em }}>
          <BrandMark size={2.2 * em} />
        </View>
        <TVFocusGuideView autoFocus style={{ gap: 0.6 * em, paddingRight: 1.2 * em }}>
          {items.map((item) => (
            <RailButton
              key={item.id}
              icon={item.icon}
              label={item.label()}
              current={item.id === current}
              expanded={expanded}
              preferredFocus={takeFocus && item.id === current}
              onFocus={onFocus}
              onBlur={onBlur}
              onPress={() => {
                if (item.id === current) (onCurrent ?? toTabRoot)();
                else router.navigate(item.href);
              }}
            />
          ))}
        </TVFocusGuideView>
      </Animated.View>
    </>
  );
};

/**
 * A TV screen's content right of the collapsed rail. It remembers what had focus in it, so
 * Right from the rail comes back to that card or button rather than whatever lines up with the
 * rail's item. Its left edge is the rail's, so the content keeps its own margin from there.
 */
export const RailContent = ({ children }: { readonly children: ReactNode }) => {
  const { em } = useTheme();
  return (
    <TVFocusGuideView autoFocus style={[StyleSheet.absoluteFill, { left: RAIL_COLLAPSED_EM * em }]}>
      {children}
    </TVFocusGuideView>
  );
};
