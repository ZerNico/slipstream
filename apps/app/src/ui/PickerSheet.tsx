import * as Haptics from "expo-haptics";
import { View } from "react-native";
import { useTheme } from "../theme/theme.ts";
import { OptionRow } from "./OptionRow.tsx";
import { Sheet, SheetTitle } from "./Sheet.tsx";

/** One choice of a {@link PickerSheet}. */
export interface Choice<T extends string> {
  readonly value: T;
  readonly label: string;
  /** A line under the label, saying what the choice does. */
  readonly hint?: string | undefined;
}

/**
 * A bottom sheet with one list of choices, the current one ticked; a pick applies and closes it,
 * as a phone's own settings pickers do.
 */
export const PickerSheet = <T extends string>({
  title,
  choices,
  selected,
  onPick,
  onClose,
}: {
  readonly title: string;
  readonly choices: readonly Choice<T>[];
  readonly selected: T;
  readonly onPick: (value: T) => void;
  readonly onClose: () => void;
}) => {
  const { em } = useTheme();
  return (
    <Sheet label={title} onClose={onClose}>
      <SheetTitle>{title}</SheetTitle>
      <View style={{ gap: 0.2 * em }}>
        {choices.map((choice) => (
          <OptionRow
            key={choice.value}
            title={choice.label}
            hint={choice.hint}
            selected={choice.value === selected}
            preferredFocus={choice.value === selected}
            onPress={() => {
              if (choice.value !== selected) {
                void Haptics.selectionAsync();
                onPick(choice.value);
              }
              onClose();
            }}
          />
        ))}
      </View>
    </Sheet>
  );
};
