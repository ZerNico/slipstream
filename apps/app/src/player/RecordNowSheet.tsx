import { extendStepMinutes } from "@slipstream/domain";
import { m } from "@slipstream/i18n";
import { Text, View } from "react-native";
import { useTheme } from "../theme/theme.ts";
import { Chip } from "../ui/Chip.tsx";
import { OptionRow } from "../ui/OptionRow.tsx";
import { Sheet } from "../ui/Sheet.tsx";

/**
 * Record's sheet while the programme in the player records (the web's recording menu): "Recording
 * until 20:30", then Extend and Stop recording. The full record options have nothing more for a
 * running recording than Watch, which the player already does, so they are not offered here.
 * Each row acts and closes; the player says how it went.
 */
export const RecordNowSheet = ({
  title,
  until,
  onExtend,
  onStop,
  onClose,
}: {
  readonly title: string;
  /** "Recording until 20:30". */
  readonly until: string;
  readonly onExtend: () => void;
  readonly onStop: () => void;
  readonly onClose: () => void;
}) => {
  const { colors, em, fonts } = useTheme();
  const then = (action: () => void) => () => {
    onClose();
    action();
  };
  return (
    <Sheet label={title} onClose={onClose}>
      <View style={{ gap: 0.45 * em }}>
        <View style={{ flexDirection: "row" }}>
          <Chip label={m.status_recording()} tone="rec" size={0.85} />
        </View>
        <Text
          numberOfLines={2}
          style={{ fontFamily: fonts.fUiSemiBold, fontSize: 1.6 * em, color: colors.fg }}
        >
          {title}
        </Text>
        <Text style={{ fontFamily: fonts.fUi, fontSize: 0.95 * em, color: colors.fg2 }}>
          {until}
        </Text>
      </View>
      <View style={{ gap: 0.2 * em, marginTop: 0.6 * em }}>
        <OptionRow
          icon="plus"
          title={m.player_extend({ minutes: extendStepMinutes })}
          preferredFocus
          onPress={then(onExtend)}
        />
        <OptionRow icon="delete" title={m.guide_stop_recording()} onPress={then(onStop)} />
      </View>
    </Sheet>
  );
};
