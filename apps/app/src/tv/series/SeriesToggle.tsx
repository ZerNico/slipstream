import type { Rule } from "@slipstream/domain";
import { m } from "@slipstream/i18n";
import { View } from "react-native";
import { useTheme } from "../../theme/theme.ts";
import { FocusButton } from "../../ui/FocusButton.tsx";

/**
 * Pause or resume a series recording on TV, a focusable button in place of the phone's switch.
 * It keeps the width of its longer label, so switching never moves what is beside it.
 */
export const SeriesToggle = ({
  rule,
  preferredFocus = false,
  onToggle,
}: {
  readonly rule: Rule;
  readonly preferredFocus?: boolean;
  readonly onToggle: (enabled: boolean) => void;
}) => {
  const { em } = useTheme();
  return (
    <View style={{ minWidth: 9.5 * em }}>
      <FocusButton
        label={rule.enabled ? m.action_pause() : m.action_resume()}
        icon={rule.enabled ? "pause" : "play"}
        variant="ghost"
        preferredFocus={preferredFocus}
        onPress={() => onToggle(!rule.enabled)}
      />
    </View>
  );
};
