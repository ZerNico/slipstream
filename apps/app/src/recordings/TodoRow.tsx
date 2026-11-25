import type { RecordingId } from "@slipstream/domain";
import { m } from "@slipstream/i18n";
import { useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import type { TodoItem } from "../data/recording-text.ts";
import { useTheme } from "../theme/theme.ts";
import { Icon } from "../ui/Icon.tsx";

/** One card: the statement in a line, what to know in two more; amber ring on TV focus. */
const TodoCard = ({
  item,
  preferredFocus,
  onPress,
}: {
  readonly item: TodoItem;
  readonly preferredFocus: boolean;
  readonly onPress: () => void;
}) => {
  const { colors, em, fonts, radii, isTV } = useTheme();
  const [focused, setFocused] = useState(false);
  const failed = item.kind === "recording" && item.failed;
  const tone = failed ? colors.liveText : colors.warnText;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${item.title}, ${item.text}`}
      onPress={onPress}
      hasTVPreferredFocus={preferredFocus}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={{
        width: (isTV ? 22 : 17) * em,
        gap: 0.35 * em,
        padding: (isTV ? 1 : 0.8) * em,
        borderRadius: radii.rM,
        backgroundColor: colors.surface,
        borderWidth: isTV ? 0.17 * em : 1,
        borderColor: focused ? colors.brand : isTV ? "transparent" : colors.line,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 0.45 * em }}>
        <Icon name="warn" size={(isTV ? 1.1 : 0.95) * em} color={tone} />
        <Text
          numberOfLines={1}
          style={{
            flex: 1,
            fontFamily: fonts.fUiSemiBold,
            fontSize: (isTV ? 1.05 : 0.9) * em,
            color: colors.fg,
          }}
        >
          {item.title}
        </Text>
      </View>
      <Text
        numberOfLines={2}
        style={{ fontFamily: fonts.fUi, fontSize: (isTV ? 0.95 : 0.8) * em, color: colors.fg2 }}
      >
        {item.text}
      </Text>
    </Pressable>
  );
};

/**
 * Home's "Needs attention" row (the web's To do cards): failed and incomplete recordings, and
 * conflicts for an admin, in one horizontal row. A recording opens its sheet (the screen draws
 * it, over everything); a conflict opens the guide. Nothing at all when there is nothing to do.
 * On TV the card named `focusId` asks for focus (back from its sheet).
 */
export const TodoRow = ({
  items,
  focusId,
  onOpen,
}: {
  readonly items: readonly TodoItem[];
  readonly focusId?: string | undefined;
  readonly onOpen: (recordingId: RecordingId) => void;
}) => {
  const { colors, em, fonts, isTV } = useTheme();
  const router = useRouter();
  if (items.length === 0) return null;
  return (
    <View style={{ gap: (isTV ? 0.9 : 0.6) * em }}>
      <Text
        style={{
          fontFamily: fonts.fUiSemiBold,
          fontSize: (isTV ? 1.25 : 1.05) * em,
          color: colors.fg,
        }}
      >
        {m.home_needs_attention()}
      </Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: (isTV ? 1.4 : 0.6) * em, paddingVertical: 0.3 * em }}
      >
        {items.map((item) => (
          <TodoCard
            key={item.id}
            item={item}
            preferredFocus={item.id === focusId}
            onPress={() =>
              item.kind === "recording" ? onOpen(item.entry.id) : router.navigate("/guide")
            }
          />
        ))}
      </ScrollView>
    </View>
  );
};
