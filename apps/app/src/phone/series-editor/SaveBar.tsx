import { m } from "@slipstream/i18n";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "../../theme/theme.ts";
import { FocusButton } from "../../ui/FocusButton.tsx";

/** The save bar's height without the safe area, which the form keeps free under its end. */
const barHeight = 4.2;

/** How much room the form leaves at its end for the save bar, in em. */
export const SaveBarSpace = () => {
  const { em } = useTheme();
  const insets = useSafeAreaInsets();
  return <View style={{ height: barHeight * em + insets.bottom + em }} />;
};

/**
 * The save bar (SPEC §2.2) at the bottom while there are changes: Create or Save, Cancel, and
 * at the end the problem that stopped the save, else how many airings it will record (a tap
 * scrolls to the preview). A series recording of someone else says whose it is instead.
 */
export const SaveBar = ({
  isNew,
  editable,
  ownerLine,
  count,
  busy,
  problem,
  onSave,
  onCancel,
  onPreview,
}: {
  readonly isNew: boolean;
  readonly editable: boolean;
  /** "Alex's series recording" for a read-only one. */
  readonly ownerLine: string;
  /** How many airings it will record, once the preview knows. */
  readonly count: number | undefined;
  readonly busy: boolean;
  readonly problem: string | undefined;
  readonly onSave: () => void;
  readonly onCancel: () => void;
  readonly onPreview: () => void;
}) => {
  const { colors, em, fonts } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom: 0,
        paddingBottom: insets.bottom,
        borderTopWidth: 1,
        borderTopColor: colors.line,
        backgroundColor: colors.surface,
      }}
    >
      <View
        style={{
          height: barHeight * em,
          flexDirection: "row",
          alignItems: "center",
          gap: 0.6 * em,
          paddingHorizontal: em,
        }}
      >
        {editable ? (
          <>
            <View style={{ minWidth: 6.5 * em }}>
              {busy ? (
                <ActivityIndicator color={colors.brand} />
              ) : (
                <FocusButton
                  label={isNew ? m.series_create() : m.action_save()}
                  icon="check"
                  variant="primary"
                  size={0.9}
                  onPress={onSave}
                />
              )}
            </View>
            <FocusButton label={m.action_cancel()} variant="ghost" size={0.9} onPress={onCancel} />
          </>
        ) : (
          <FocusButton label={m.series_back()} variant="ghost" size={0.9} onPress={onCancel} />
        )}
        <View style={{ flex: 1, alignItems: "flex-end" }}>
          {!editable ? (
            <Text
              numberOfLines={2}
              style={{ fontFamily: fonts.fUi, fontSize: 0.8 * em, color: colors.fg2 }}
            >
              {ownerLine}
            </Text>
          ) : problem !== undefined ? (
            <Text
              numberOfLines={2}
              accessibilityLiveRegion="polite"
              style={{ fontFamily: fonts.fUi, fontSize: 0.8 * em, color: colors.liveText }}
            >
              {problem}
            </Text>
          ) : count === undefined ? null : (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={m.series_preview_jump({ count })}
              hitSlop={0.5 * em}
              onPress={onPreview}
            >
              <Text
                numberOfLines={2}
                style={{
                  textAlign: "right",
                  fontFamily: fonts.fUiSemiBold,
                  fontSize: 0.88 * em,
                  color: colors.okText,
                }}
              >
                {m.series_preview_jump({ count })}
              </Text>
            </Pressable>
          )}
        </View>
      </View>
    </View>
  );
};
