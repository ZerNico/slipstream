import { m } from "@slipstream/i18n";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "../../../../theme/theme.ts";

/** A filter chip: pressed fills it light; an optional count after the label. */
const FilterChip = ({
  label,
  count,
  pressed,
  onPress,
}: {
  readonly label: string;
  readonly count?: number | undefined;
  readonly pressed: boolean;
  readonly onPress: () => void;
}) => {
  const { colors, em, fonts } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={count === undefined ? label : `${label} ${count}`}
      accessibilityState={{ selected: pressed }}
      onPress={onPress}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 0.35 * em,
        height: 2.75 * em,
        paddingHorizontal: 0.9 * em,
        borderRadius: 1.4 * em,
        borderWidth: 1,
        borderColor: pressed ? colors.fg : colors.borderStrong,
        backgroundColor: pressed ? colors.fg : "transparent",
      }}
    >
      <Text
        style={{
          fontFamily: fonts.fUiSemiBold,
          fontSize: 0.9 * em,
          color: pressed ? colors.bg : colors.fg,
        }}
      >
        {label}
      </Text>
      {count === undefined ? null : (
        <Text
          style={{
            fontFamily: fonts.fUi,
            fontSize: 0.85 * em,
            color: pressed ? colors.bg : colors.fg3,
          }}
        >
          {String(count)}
        </Text>
      )}
    </Pressable>
  );
};

/** What the chips filter by on the phone. */
export interface PhoneFilter {
  readonly view: "all" | "visible" | "hidden";
  readonly noGuide: boolean;
  readonly favourites: boolean;
}

/**
 * The lineup's chips in one row that scrolls sideways: Visible and Hidden (one or neither), No
 * guide and Favourites, each with its count.
 */
export const FilterChips = ({
  filter,
  counts,
  onChange,
}: {
  readonly filter: PhoneFilter;
  readonly counts: {
    readonly visible: number;
    readonly hidden: number;
    readonly noGuide: number;
    readonly favourites: number;
  };
  readonly onChange: (next: PhoneFilter) => void;
}) => {
  const { em } = useTheme();
  const view = (next: "visible" | "hidden") =>
    onChange({ ...filter, view: filter.view === next ? "all" : next });
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ gap: 0.5 * em, paddingHorizontal: em, paddingBottom: 0.6 * em }}
    >
      <FilterChip
        label={m.lineup_view_visible()}
        count={counts.visible}
        pressed={filter.view === "visible"}
        onPress={() => view("visible")}
      />
      <FilterChip
        label={m.lineup_view_hidden()}
        count={counts.hidden}
        pressed={filter.view === "hidden"}
        onPress={() => view("hidden")}
      />
      <FilterChip
        label={m.lineup_no_guide()}
        count={counts.noGuide}
        pressed={filter.noGuide}
        onPress={() => onChange({ ...filter, noGuide: !filter.noGuide })}
      />
      <FilterChip
        label={m.lineup_favourites()}
        count={counts.favourites}
        pressed={filter.favourites}
        onPress={() => onChange({ ...filter, favourites: !filter.favourites })}
      />
    </ScrollView>
  );
};

/** One action of the select bar. */
const BarAction = ({
  label,
  danger = false,
  disabled,
  onPress,
}: {
  readonly label: string;
  readonly danger?: boolean;
  readonly disabled: boolean;
  readonly onPress: () => void;
}) => {
  const { colors, em, fonts } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        flex: 1,
        minHeight: 3 * em,
        alignItems: "center",
        justifyContent: "center",
        borderRadius: 0.6 * em,
        backgroundColor: pressed ? colors.raised : "transparent",
        opacity: disabled ? 0.4 : 1,
      })}
    >
      <Text
        numberOfLines={1}
        adjustsFontSizeToFit
        style={{
          fontFamily: fonts.fUiSemiBold,
          fontSize: 0.85 * em,
          color: danger ? colors.liveText : colors.fg,
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
};

/** Which bulk action was chosen. */
export type BulkAction = "hide" | "number" | "top" | "favourite" | "remove";

/**
 * The bar at the bottom in select mode: Hide (Show when all are hidden), Move to…, To top,
 * Favourite and Remove for the chosen channels. With nothing chosen its actions are off.
 */
export const SelectBar = ({
  count,
  allHidden,
  allFavourite,
  onAction,
}: {
  readonly count: number;
  /** Every chosen channel is hidden: the first action shows them instead. */
  readonly allHidden: boolean;
  /** Every chosen channel is a favourite: Favourite takes them out instead. */
  readonly allFavourite: boolean;
  readonly onAction: (action: BulkAction) => void;
}) => {
  const { colors, em } = useTheme();
  const insets = useSafeAreaInsets();
  const off = count === 0;
  return (
    <View
      style={{
        flexDirection: "row",
        gap: 0.2 * em,
        paddingHorizontal: 0.5 * em,
        paddingTop: 0.4 * em,
        paddingBottom: insets.bottom + 0.4 * em,
        backgroundColor: colors.surface,
        borderTopWidth: 1,
        borderTopColor: colors.line,
      }}
    >
      <BarAction
        label={allHidden ? m.lineup_show() : m.lineup_hide()}
        disabled={off}
        onPress={() => onAction("hide")}
      />
      <BarAction label={m.lineup_move_short()} disabled={off} onPress={() => onAction("number")} />
      <BarAction label={m.lineup_to_top()} disabled={off} onPress={() => onAction("top")} />
      <BarAction
        label={allFavourite ? m.lineup_remove_favourite() : m.lineup_favourite()}
        disabled={off}
        onPress={() => onAction("favourite")}
      />
      <BarAction
        label={m.lineup_remove()}
        danger
        disabled={off}
        onPress={() => onAction("remove")}
      />
    </View>
  );
};
