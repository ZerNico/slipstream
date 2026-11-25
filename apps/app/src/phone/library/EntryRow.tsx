import type { RecordingEntry } from "@slipstream/api";
import { m } from "@slipstream/i18n";
import { Pressable, Text, View } from "react-native";
import { type LibraryCard, cardMeta } from "../../data/library.ts";
import { useTheme } from "../../theme/theme.ts";
import { Chip } from "../../ui/Chip.tsx";
import { Thumb } from "../Thumb.tsx";

/**
 * One recording as a row of a list (a group's episodes, the scheduled list): the picture with
 * the watched bar, a title and one quiet line. `dim` is for what has not been recorded yet.
 */
export const EntryRow = ({
  entry,
  card,
  title,
  meta,
  dim = false,
  onPress,
}: {
  readonly entry: RecordingEntry;
  readonly card: LibraryCard;
  /** The row's title; the recording's own title when left out. */
  readonly title?: string | undefined;
  /** The quiet line; time left (or the slot while recording) and the day when left out. */
  readonly meta?: string | undefined;
  readonly dim?: boolean;
  readonly onPress: () => void;
}) => {
  const { colors, em, fonts } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title ?? entry.title}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: 0.8 * em,
        paddingHorizontal: em,
        paddingVertical: 0.5 * em,
        backgroundColor: pressed ? colors.surface : "transparent",
        opacity: dim ? 0.6 : 1,
      })}
    >
      <Thumb subject={entry} progress={card.progress < 1 ? card.progress : 0} width={8 * em} />
      <View style={{ flex: 1, gap: 0.25 * em }}>
        <Text
          numberOfLines={2}
          style={{ fontFamily: fonts.fUiSemiBold, fontSize: 0.95 * em, color: colors.fg }}
        >
          {title ?? entry.title}
        </Text>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 0.5 * em }}>
          {card.running ? <Chip label={m.status_recording()} tone="rec" size={0.72} /> : null}
          <Text
            numberOfLines={1}
            style={{ flex: 1, fontFamily: fonts.fUi, fontSize: 0.82 * em, color: colors.fg3 }}
          >
            {meta ?? cardMeta(card)}
          </Text>
        </View>
      </View>
    </Pressable>
  );
};
