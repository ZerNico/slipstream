import type { ConditionDraft } from "@slipstream/domain";
import { m, seriesConditionKindLabel } from "@slipstream/i18n";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useTheme } from "../../theme/theme.ts";
import { TextField } from "../../ui/TextField.tsx";
import { Icon } from "../../ui/Icon.tsx";
import { IconPress, PickRow, ProblemLine } from "./parts.tsx";

/**
 * The words of a plain condition: its values as chips, and a box that adds one on Return. What is
 * typed counts at once (it is the last value until Return makes it a chip), so saving never
 * drops a word that was not confirmed.
 */
const ValuesField = ({
  values,
  onChange,
  editable,
}: {
  readonly values: readonly string[];
  readonly onChange: (values: readonly string[]) => void;
  readonly editable: boolean;
}) => {
  const { colors, em, fonts, radii } = useTheme();
  const [text, setText] = useState("");
  const chips = text === "" ? values : values.slice(0, -1);
  return (
    <View style={{ gap: 0.5 * em }}>
      {chips.length === 0 ? null : (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 0.4 * em }}>
          {chips.map((value, index) => (
            <Pressable
              // oxlint-disable-next-line react/no-array-index-key -- the same word may be there twice
              key={`${index}:${value}`}
              accessibilityRole="button"
              accessibilityLabel={m.series_phone_remove_value({ value })}
              disabled={!editable}
              onPress={() =>
                onChange([...chips.filter((_, at) => at !== index), ...(text === "" ? [] : [text])])
              }
              style={({ pressed }) => ({
                maxWidth: "100%",
                flexDirection: "row",
                alignItems: "center",
                gap: 0.35 * em,
                paddingLeft: 0.7 * em,
                paddingRight: 0.5 * em,
                paddingVertical: 0.35 * em,
                borderRadius: radii.rM,
                backgroundColor: pressed ? colors.line : colors.raised,
              })}
            >
              <Text
                numberOfLines={1}
                style={{
                  flexShrink: 1,
                  fontFamily: fonts.fUiMedium,
                  fontSize: 0.9 * em,
                  color: colors.fg,
                }}
              >
                {value}
              </Text>
              {editable ? <Icon name="delete" size={0.85 * em} color={colors.fg3} /> : null}
            </Pressable>
          ))}
        </View>
      )}
      <TextField
        label={m.series_condition_values()}
        placeholder={m.series_condition_values()}
        value={text}
        editable={editable}
        returnKeyType="done"
        submitBehavior="submit"
        autoCapitalize="none"
        onChangeText={(next) => {
          setText(next);
          onChange(next === "" ? chips : [...chips, next]);
        }}
        onSubmitEditing={() => {
          const word = text.trim();
          setText("");
          onChange(word === "" ? chips : [...chips, word]);
        }}
      />
    </View>
  );
};

/**
 * One condition of the series recording: its kind (a tap opens the kinds), its words or its
 * pattern, and Remove. A broken pattern is said under it, on a line that is always there.
 */
export const ConditionCard = ({
  condition,
  editable,
  problem,
  onKind,
  onChange,
  onRemove,
}: {
  readonly condition: ConditionDraft;
  readonly editable: boolean;
  /** Why the pattern can't be used, when it can't. */
  readonly problem: string | undefined;
  readonly onKind: () => void;
  readonly onChange: (patch: Partial<ConditionDraft>) => void;
  readonly onRemove: () => void;
}) => {
  const { em } = useTheme();
  return (
    <View style={{ paddingBottom: 0.6 * em }}>
      <View style={{ flexDirection: "row", alignItems: "center", paddingRight: 0.4 * em }}>
        <View style={{ flex: 1 }}>
          <PickRow
            label={m.series_condition()}
            value={seriesConditionKindLabel(condition.kind)}
            disabled={!editable}
            onPress={onKind}
          />
        </View>
        <IconPress
          icon="delete"
          label={m.series_remove_condition()}
          disabled={!editable}
          onPress={onRemove}
        />
      </View>
      <View style={{ paddingHorizontal: em, gap: 0.3 * em }}>
        {condition.kind === "Regex" ? (
          <>
            <TextField
              label={m.series_pattern()}
              placeholder={m.series_pattern_placeholder()}
              value={condition.pattern}
              editable={editable}
              invalid={problem !== undefined}
              autoCapitalize="none"
              onChangeText={(pattern) => onChange({ pattern })}
            />
            <ProblemLine text={problem} />
          </>
        ) : (
          <ValuesField
            values={condition.values}
            editable={editable}
            onChange={(values) => onChange({ values })}
          />
        )}
      </View>
    </View>
  );
};
