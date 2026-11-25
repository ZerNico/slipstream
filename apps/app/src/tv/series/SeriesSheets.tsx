import { type KeepKind, keepKinds, type Padding, stepPaddingMinutes } from "@slipstream/domain";
import { formatters, m, seriesKeepKindLabel } from "@slipstream/i18n";
import { useState } from "react";
import { Text, View } from "react-native";
import { useTheme } from "../../theme/theme.ts";
import { FocusButton } from "../../ui/FocusButton.tsx";
import { Icon } from "../../ui/Icon.tsx";
import { Sheet } from "../../ui/Sheet.tsx";
import { OptionRow } from "../../ui/OptionRow.tsx";
import { useStepKeys } from "./use-step-keys.ts";

/*
 * The series page's own side sheets on TV: which episodes, extra time and keep (steppers moved
 * with left and right, as in the record sheet), and the delete confirm. Channels, weekdays and
 * Goes to use the series editor's pickers, which are side sheets on TV too.
 */

/** A stepper's value: "◀ 2 min ▶", the arrows lit while its row has focus. */
const StepValue = ({ text, active }: { readonly text: string; readonly active: boolean }) => {
  const { colors, em, fonts } = useTheme();
  const color = active ? colors.onBrand : colors.fg2;
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 0.4 * em }}>
      <Icon name="back" size={em} color={color} />
      <Text
        style={{
          fontFamily: fonts.fMonoSemiBold,
          fontSize: 1.05 * em,
          color,
          minWidth: 4.5 * em,
          textAlign: "center",
        }}
      >
        {text}
      </Text>
      <Icon name="fwd" size={em} color={color} />
    </View>
  );
};

/** A sheet's heading. */
const SheetTitle = ({ text }: { readonly text: string }) => {
  const { colors, em, fonts } = useTheme();
  return (
    <Text
      numberOfLines={2}
      style={{ fontFamily: fonts.fUiSemiBold, fontSize: 1.6 * em, color: colors.fg }}
    >
      {text}
    </Text>
  );
};

/** "New episodes only" or "All airings" (`skipRepeats`); a pick closes the sheet. */
export const EpisodesSheet = ({
  skipRepeats,
  onPick,
  onClose,
}: {
  readonly skipRepeats: boolean;
  readonly onPick: (skipRepeats: boolean) => void;
  readonly onClose: () => void;
}) => (
  <Sheet label={m.series_section_episodes()} onClose={onClose}>
    <SheetTitle text={m.series_section_episodes()} />
    <OptionRow
      title={m.series_episodes_new()}
      selected={skipRepeats}
      preferredFocus={skipRepeats}
      onPress={() => onPick(true)}
    />
    <OptionRow
      title={m.series_episodes_every()}
      selected={!skipRepeats}
      preferredFocus={!skipRepeats}
      onPress={() => onPick(false)}
    />
  </Sheet>
);

/** Which side of the extra time a stepper moves. */
type Side = keyof Padding;

/**
 * Extra time: start early and end late as steppers, and Reset back to the household's default
 * when the series recording has its own.
 */
export const ExtraTimeSheet = ({
  padding,
  overridesDefault,
  onChange,
  onClose,
}: {
  readonly padding: Padding;
  readonly overridesDefault: boolean;
  /** The new extra time; undefined follows the defaults again. */
  readonly onChange: (padding: Padding | undefined) => void;
  readonly onClose: () => void;
}) => {
  const [side, setSide] = useState<Side | undefined>(undefined);
  const step = (which: Side, direction: 1 | -1) =>
    onChange({ ...padding, [which]: stepPaddingMinutes(padding[which], direction) });
  useStepKeys(side, step);
  const leave = () => setSide(undefined);
  return (
    <Sheet label={m.series_section_extra()} onClose={onClose}>
      <SheetTitle text={m.series_section_extra()} />
      <OptionRow
        icon="clock"
        title={m.padding_before()}
        preferredFocus
        onFocus={() => setSide("beforeMinutes")}
        onPress={() => step("beforeMinutes", 1)}
      >
        <StepValue
          text={m.series_minutes({ minutes: padding.beforeMinutes })}
          active={side === "beforeMinutes"}
        />
      </OptionRow>
      <OptionRow
        icon="clock"
        title={m.padding_after()}
        onFocus={() => setSide("afterMinutes")}
        onPress={() => step("afterMinutes", 1)}
      >
        <StepValue
          text={m.series_minutes({ minutes: padding.afterMinutes })}
          active={side === "afterMinutes"}
        />
      </OptionRow>
      {/* Kept in place on the default too (where it does nothing), so Close never moves. */}
      <OptionRow
        icon="back"
        title={m.action_reset()}
        onFocus={leave}
        onPress={overridesDefault ? () => onChange(undefined) : undefined}
      />
      <FocusButton label={m.action_close()} variant="primary" onFocus={leave} onPress={onClose} />
    </Sheet>
  );
};

/**
 * Keep: everything, the newest recordings or events, or the recordings of the last days; how
 * many (or how many days) is a stepper below the kinds.
 */
export const KeepSheet = ({
  keep,
  count,
  onChange,
  onClose,
}: {
  readonly keep: KeepKind;
  readonly count: number;
  readonly onChange: (change: { readonly keep: KeepKind; readonly keepCount: number }) => void;
  readonly onClose: () => void;
}) => {
  const [active, setActive] = useState<"count" | undefined>(undefined);
  const step = (_which: "count", direction: 1 | -1) =>
    onChange({ keep, keepCount: Math.max(1, Math.round(count) + direction) });
  useStepKeys(active, step);
  const leave = () => setActive(undefined);
  return (
    <Sheet label={m.library_editor_keep()} onClose={onClose}>
      <SheetTitle text={m.library_editor_keep()} />
      {keepKinds.map((kind) => (
        <OptionRow
          key={kind}
          title={seriesKeepKindLabel(kind)}
          selected={kind === keep}
          preferredFocus={kind === keep}
          onFocus={leave}
          onPress={() => onChange({ keep: kind, keepCount: count })}
        />
      ))}
      {keep === "KeepAll" ? null : (
        <OptionRow
          title={keep === "KeepDays" ? m.series_keep_days() : m.series_keep_count()}
          onFocus={() => setActive("count")}
          onPress={() => step("count", 1)}
        >
          <StepValue text={formatters().number(count)} active={active === "count"} />
        </OptionRow>
      )}
      <FocusButton label={m.action_close()} variant="primary" onFocus={leave} onPress={onClose} />
    </Sheet>
  );
};

/** Delete with a confirm step: Keep it has focus, so a stray OK deletes nothing. */
export const DeleteSheet = ({
  name,
  onDelete,
  onClose,
}: {
  readonly name: string;
  readonly onDelete: () => void;
  readonly onClose: () => void;
}) => {
  const { colors, em, fonts } = useTheme();
  return (
    <Sheet label={m.action_delete()} onClose={onClose}>
      <SheetTitle text={m.series_delete_title({ name })} />
      <Text style={{ fontFamily: fonts.fUi, fontSize: em, color: colors.fg2 }}>
        {m.series_delete_text()}
      </Text>
      <View style={{ gap: 0.3 * em, marginTop: 0.6 * em }}>
        <OptionRow icon="back" title={m.series_delete_keep()} preferredFocus onPress={onClose} />
        <OptionRow icon="delete" title={m.series_delete_yes()} onPress={onDelete} />
      </View>
    </Sheet>
  );
};
