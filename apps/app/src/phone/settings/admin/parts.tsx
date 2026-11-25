import { Children, Fragment, isValidElement, type ReactNode } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "../../../theme/theme.ts";
import { Icon, type IconName } from "../../../ui/Icon.tsx";
import { Bone, Skeleton } from "../../../ui/Skeleton.tsx";
import { BackHeader } from "../../BackHeader.tsx";
import { Hairline, Panel } from "../../ui/settings.tsx";
import { type GroupShape, HEADING_EM, ROW_EM, ROW_TWO_LINES_EM } from "./metrics.ts";

/*
 * The building blocks of the phone's server settings pages, as grouped lists like a phone's own
 * settings: a page with Back and its title, groups with a heading, rows separated by hairlines,
 * and the skeleton in the same measures. Panels, steppers and pickers are the shared ones.
 */

/** A settings page: Back and the title at the top, the groups scrolling under it. */
export const SettingsPage = ({
  title,
  children,
}: {
  readonly title: string;
  readonly children: ReactNode;
}) => {
  const { colors, em } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <BackHeader title={title} />
      <ScrollView
        keyboardShouldPersistTaps="handled"
        // iOS: the keyboard insets the page, so a field being typed in scrolls into view.
        automaticallyAdjustKeyboardInsets
        contentContainerStyle={{ paddingHorizontal: em, paddingBottom: insets.bottom + 2 * em }}
      >
        {children}
      </ScrollView>
    </View>
  );
};

/** A heading over a group, sitting on the group's panel. */
const GroupHeading = ({ children }: { readonly children: string }) => {
  const { colors, em, fonts } = useTheme();
  return (
    <View style={{ height: HEADING_EM * em, justifyContent: "flex-end", paddingBottom: 0.45 * em }}>
      <Text
        accessibilityRole="header"
        numberOfLines={1}
        style={{
          fontFamily: fonts.fUiSemiBold,
          fontSize: 0.85 * em,
          color: colors.fg3,
          paddingHorizontal: em,
        }}
      >
        {children}
      </Text>
    </View>
  );
};

/**
 * A group of rows: an optional heading, the rows on one panel with hairlines between them, and
 * an optional quiet note under it.
 */
export const Group = ({
  title,
  footer,
  children,
}: {
  readonly title?: string | undefined;
  readonly footer?: string | undefined;
  readonly children: ReactNode;
}) => {
  const { colors, em, fonts } = useTheme();
  // `toArray` keys every row (and flattens arrays), so each keeps its key next to its hairline.
  const rows = Children.toArray(children)
    .filter(isValidElement)
    .map((node) => ({ node, key: node.key ?? "" }));
  const first = rows[0]?.key;
  return (
    <View style={{ marginTop: title === undefined ? 1.2 * em : 0 }}>
      {title === undefined ? null : <GroupHeading>{title}</GroupHeading>}
      <Panel inset={false}>
        {rows.map((row) => (
          <Fragment key={row.key}>
            {row.key === first ? null : <Hairline />}
            {row.node}
          </Fragment>
        ))}
      </Panel>
      {footer === undefined ? null : (
        <Text
          style={{
            fontFamily: fonts.fUi,
            fontSize: 0.82 * em,
            lineHeight: 1.2 * em,
            color: colors.fg3,
            paddingHorizontal: em,
            paddingTop: 0.5 * em,
          }}
        >
          {footer}
        </Text>
      )}
    </View>
  );
};

/**
 * One row of a group: a title, an optional line under it, and a control at the end. With
 * `onPress` the whole row is a button and lights up under the finger; `tone: "danger"` colours
 * the title for removing something.
 */
export const Row = ({
  title,
  sub,
  end,
  icon,
  tone = "default",
  label,
  onPress,
}: {
  readonly title: string;
  readonly sub?: string | undefined;
  readonly end?: ReactNode;
  readonly icon?: IconName | undefined;
  readonly tone?: "default" | "danger" | "action";
  /** What a screen reader says for a pressable row, when it is more than the title. */
  readonly label?: string | undefined;
  readonly onPress?: (() => void) | undefined;
}) => {
  const { colors, em, fonts } = useTheme();
  const colour =
    tone === "danger" ? colors.liveText : tone === "action" ? colors.brandText : colors.fg;
  const body = (
    <>
      {icon === undefined ? null : <Icon name={icon} size={1.3 * em} color={colour} />}
      <View style={{ flex: 1, gap: 0.15 * em }}>
        <Text style={{ fontFamily: fonts.fUiSemiBold, fontSize: 0.98 * em, color: colour }}>
          {title}
        </Text>
        {sub === undefined ? null : (
          <Text style={{ fontFamily: fonts.fUi, fontSize: 0.85 * em, color: colors.fg2 }}>
            {sub}
          </Text>
        )}
      </View>
      {end}
    </>
  );
  const style = {
    flexDirection: "row",
    alignItems: "center",
    gap: 0.8 * em,
    minHeight: (sub === undefined ? ROW_EM : ROW_TWO_LINES_EM) * em,
    paddingHorizontal: em,
    paddingVertical: 0.6 * em,
  } as const;
  if (onPress === undefined) return <View style={style}>{body}</View>;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label ?? title}
      onPress={onPress}
      style={({ pressed }) => [style, { backgroundColor: pressed ? colors.raised : "transparent" }]}
    >
      {body}
    </Pressable>
  );
};

/** The value a picker row shows at its end, with the chevron that says it opens choices. */
export const PickerValue = ({ text }: { readonly text: string }) => {
  const { colors, em, fonts } = useTheme();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 0.3 * em, maxWidth: "55%" }}>
      <Text
        numberOfLines={1}
        style={{ flexShrink: 1, fontFamily: fonts.fUi, fontSize: 0.92 * em, color: colors.fg2 }}
      >
        {text}
      </Text>
      <Icon name="fwd" size={0.9 * em} color={colors.fg3} />
    </View>
  );
};

/** A settings page while it loads: its groups and rows as bones in the loaded measures. */
export const SettingsSkeleton = ({ groups }: { readonly groups: readonly GroupShape[] }) => {
  const { colors, em, radii } = useTheme();
  return (
    <Skeleton>
      {/* Bones never move or reorder, so their places are their keys. */}
      {[...groups.entries()].map(([place, group]) => (
        <View key={place} style={{ marginTop: group.heading ? 0 : 1.2 * em }}>
          {group.heading ? (
            <View
              style={{
                height: HEADING_EM * em,
                justifyContent: "flex-end",
                paddingBottom: 0.45 * em,
                paddingHorizontal: em,
              }}
            >
              <Bone width={7 * em} height={0.85 * em} />
            </View>
          ) : null}
          <View style={{ borderRadius: radii.rL, overflow: "hidden" }}>
            {[...group.rows.entries()].map(([row, height]) => (
              <View
                key={row}
                style={{
                  height: height * em,
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "space-between",
                  paddingHorizontal: em,
                  borderTopWidth: row === 0 ? 0 : 1,
                  borderTopColor: colors.surface,
                }}
              >
                <Bone width={row % 2 === 0 ? "45%" : "35%"} height={0.95 * em} />
                <Bone width={6 * em} height={1.2 * em} />
              </View>
            ))}
          </View>
        </View>
      ))}
    </Skeleton>
  );
};
