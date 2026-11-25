import { m } from "@slipstream/i18n";
import { Text, View } from "react-native";
import { Sheet } from "../ui/Sheet.tsx";
import { optionText } from "./choice-text.ts";
import type { ChoiceOption, RecordingChoice } from "@slipstream/domain";
import { useTheme } from "../theme/theme.ts";
import { useNow } from "../ui/use-now.ts";
import { OptionRow } from "../ui/OptionRow.tsx";

/**
 * The watch choice on TV (SPEC §7.6), the web's choice overlay as a side sheet: a recording this
 * profile already started asks Resume / From start (and Watch live while it records). Focus
 * stays in the sheet, the first option (Resume) has it, the D-pad moves between options, and
 * Back closes the sheet without playing.
 */
export const WatchChoiceSheet = ({
  title,
  choice,
  onPick,
  onClose,
}: {
  readonly title: string;
  readonly choice: RecordingChoice;
  readonly onPick: (option: ChoiceOption) => void;
  readonly onClose: () => void;
}) => {
  const { colors, em, fonts } = useTheme();
  const now = useNow(30_000);

  return (
    <Sheet label={title} onClose={onClose}>
      <Text style={{ fontFamily: fonts.fUi, fontSize: em, color: colors.fg2 }}>
        {m.choice_options_label()}
      </Text>
      <Text
        numberOfLines={2}
        style={{ fontFamily: fonts.fUiSemiBold, fontSize: 1.6 * em, color: colors.fg }}
      >
        {title}
      </Text>
      <View style={{ gap: 0.3 * em, marginTop: 0.6 * em }}>
        {choice.options.map((option, index) => {
          const text = optionText(option, choice, now);
          return (
            <OptionRow
              key={option.kind}
              icon={text.icon}
              title={text.title}
              hint={text.hint}
              preferredFocus={index === 0}
              onPress={() => onPick(option)}
            />
          );
        })}
      </View>
    </Sheet>
  );
};
