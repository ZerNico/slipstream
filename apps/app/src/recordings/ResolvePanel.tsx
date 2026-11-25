import type { RecordingEntry } from "@slipstream/api";
import { epochMs, type Resolution } from "@slipstream/domain";
import { m, resolveIntro } from "@slipstream/i18n";
import { Text, View } from "react-native";
import { useTheme } from "../theme/theme.ts";
import { FocusButton } from "../ui/FocusButton.tsx";
import { Icon } from "../ui/Icon.tsx";
import type { EntryResolveOption } from "./use-scheduled.ts";

/** One way out: what it does in bold, the cost quietly, and the button that does it. */
const OptionLine = ({
  option,
  first,
  busy,
  onPick,
}: {
  readonly option: EntryResolveOption;
  readonly first: boolean;
  readonly busy: string | undefined;
  readonly onPick: (option: EntryResolveOption) => void;
}) => {
  const { colors, em, fonts, isTV, radii } = useTheme();
  const { entry } = option;
  const title =
    option.kind === "skip"
      ? m.library_resolve_skip({ title: entry.title })
      : m.conflict_end_other({ title: entry.title, at: new Date(option.endAt) });
  const detail =
    option.kind === "skip"
      ? m.library_resolve_skip_detail({
          start: new Date(epochMs(entry.start)),
          end: new Date(epochMs(entry.end)),
        })
      : m.library_resolve_end_detail({ keeps: option.keepsAfter, of: option.ofAfter });
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: em,
        paddingVertical: (isTV ? 0.7 : 0.6) * em,
        paddingHorizontal: (isTV ? 1 : 0.75) * em,
        borderRadius: radii.rM,
        backgroundColor: colors.surface,
        borderWidth: 1,
        borderColor: colors.line,
      }}
    >
      <View style={{ flex: 1, gap: 0.15 * em }}>
        <Text
          style={{
            fontFamily: fonts.fUiSemiBold,
            fontSize: (isTV ? 1.1 : 0.9) * em,
            color: colors.fg,
          }}
        >
          {title}
        </Text>
        <Text
          style={{ fontFamily: fonts.fUi, fontSize: (isTV ? 0.95 : 0.8) * em, color: colors.fg3 }}
        >
          {detail}
        </Text>
      </View>
      <FocusButton
        label={option.kind === "skip" ? m.action_skip() : m.library_resolve_shorten()}
        // On TV only the focused button is amber; on a phone the first way out leads.
        variant={first && !isTV ? "primary" : "default"}
        size={isTV ? 1 : 0.85}
        disabled={busy !== undefined}
        onPress={() => onPick(option)}
      />
    </View>
  );
};

/**
 * The resolution under the last item of an overlap (the web's resolve box): what overlaps and
 * how much room there is then, and one way out per item that can give way, skipping first. The
 * buttons are focusable on TV; while one action runs, the others wait.
 */
export const ResolvePanel = ({
  resolution,
  busy,
  onPick,
}: {
  readonly resolution: Resolution<RecordingEntry>;
  readonly busy: string | undefined;
  readonly onPick: (option: EntryResolveOption) => void;
}) => {
  const { colors, em, fonts, isTV } = useTheme();
  return (
    <View style={{ gap: (isTV ? 0.6 : 0.45) * em }}>
      <View style={{ flexDirection: "row", gap: 0.5 * em }}>
        <Icon name="warn" size={(isTV ? 1.2 : 1) * em} color={colors.warnText} />
        <Text
          style={{
            flex: 1,
            fontFamily: fonts.fUi,
            fontSize: (isTV ? 1.05 : 0.88) * em,
            color: colors.fg,
          }}
        >
          {resolveIntro(resolution)}
        </Text>
      </View>
      {resolution.options.map((option, index) => (
        <OptionLine
          key={`${option.kind}-${option.entry.id}`}
          option={option}
          first={index === 0}
          busy={busy}
          onPick={onPick}
        />
      ))}
    </View>
  );
};
