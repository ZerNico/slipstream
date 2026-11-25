import {
  addOverride,
  type Channel,
  channelsWithoutOverride,
  type ExtraTimeDefaults,
  type ExtraTimeOverride,
  visibleChannels,
} from "@slipstream/domain";
import { m } from "@slipstream/i18n";
import * as Haptics from "expo-haptics";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useTheme } from "../../../theme/theme.ts";
import { OptionRow } from "../../../ui/OptionRow.tsx";
import { FocusButton } from "../../../ui/FocusButton.tsx";
import { Sheet, SheetTitle } from "../../../ui/Sheet.tsx";
import { TextField } from "../../../ui/TextField.tsx";

type Kind = "channel" | "category";

/** Channel or Category: two halves of one control, the chosen one filled. */
const KindSwitch = ({
  value,
  onChange,
}: {
  readonly value: Kind;
  readonly onChange: (kind: Kind) => void;
}) => {
  const { colors, em, fonts, radii } = useTheme();
  const kinds: readonly { readonly kind: Kind; readonly label: string }[] = [
    { kind: "channel", label: m.rec_kind_channel() },
    { kind: "category", label: m.rec_kind_category() },
  ];
  return (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel={m.rec_override_kind()}
      style={{
        flexDirection: "row",
        padding: 0.2 * em,
        gap: 0.2 * em,
        borderRadius: radii.rM,
        backgroundColor: colors.bg,
      }}
    >
      {kinds.map(({ kind, label }) => {
        const chosen = kind === value;
        return (
          <Pressable
            key={kind}
            accessibilityRole="radio"
            accessibilityLabel={label}
            accessibilityState={{ checked: chosen }}
            onPress={() => onChange(kind)}
            style={{
              flex: 1,
              alignItems: "center",
              paddingVertical: 0.55 * em,
              borderRadius: radii.rS,
              backgroundColor: chosen ? colors.raised : "transparent",
            }}
          >
            <Text
              style={{
                fontFamily: fonts.fUiSemiBold,
                fontSize: 0.92 * em,
                color: chosen ? colors.fg : colors.fg2,
              }}
            >
              {label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
};

/**
 * "Add exception" on a phone: a channel without one (a tap adds it) or a guide category typed
 * by name, starting from the default minutes. A category that has an exception already, or no
 * name, says so on the line kept for it under the field.
 */
export const AddExceptionSheet = ({
  defaults,
  channels,
  onAdd,
  onClose,
}: {
  readonly defaults: ExtraTimeDefaults;
  readonly channels: readonly Channel[];
  readonly onAdd: (next: ExtraTimeDefaults) => void;
  readonly onClose: () => void;
}) => {
  const { colors, em, fonts } = useTheme();
  const [kind, setKind] = useState<Kind>("channel");
  const [category, setCategory] = useState("");
  const [error, setError] = useState<string | undefined>(undefined);
  const free = channelsWithoutOverride(defaults, visibleChannels(channels));

  const add = (override: ExtraTimeOverride) => {
    const next = addOverride(defaults, override);
    if (next === "duplicate") {
      setError(m.rec_override_duplicate());
      return;
    }
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    onAdd(next);
    onClose();
  };
  const addCategory = () => {
    const name = category.trim();
    if (name === "") {
      setError(m.rec_override_category_missing());
      return;
    }
    add({ _tag: "Category", category: name, padding: defaults.padding });
  };

  return (
    <Sheet label={m.rec_override_add()} onClose={onClose}>
      <SheetTitle>{m.rec_override_add()}</SheetTitle>
      <KindSwitch
        value={kind}
        onChange={(next) => {
          setKind(next);
          setError(undefined);
        }}
      />
      {kind === "channel" ? (
        free.length === 0 ? (
          <Text style={{ fontFamily: fonts.fUi, fontSize: 0.95 * em, color: colors.fg2 }}>
            {m.rec_override_no_channel()}
          </Text>
        ) : (
          <View style={{ gap: 0.1 * em }}>
            {free.map((channel) => (
              <OptionRow
                key={channel.id}
                title={channel.name}
                onPress={() =>
                  add({ _tag: "Channel", channelId: channel.id, padding: defaults.padding })
                }
              />
            ))}
          </View>
        )
      ) : (
        <View style={{ gap: 0.5 * em }}>
          <TextField
            inSheet
            label={m.rec_kind_category()}
            placeholder={m.rec_override_category_placeholder()}
            value={category}
            autoFocus
            returnKeyType="done"
            invalid={error !== undefined}
            onChangeText={(next) => {
              setCategory(next);
              setError(undefined);
            }}
            onSubmitEditing={addCategory}
          />
          {/* The line is always there, so a message never pushes the button down. */}
          <Text
            accessibilityLiveRegion="polite"
            style={{
              fontFamily: fonts.fUi,
              fontSize: 0.85 * em,
              lineHeight: 1.2 * em,
              minHeight: 1.2 * em,
              color: colors.liveText,
            }}
          >
            {error ?? ""}
          </Text>
          <FocusButton
            label={m.rec_override_confirm()}
            variant="primary"
            disabled={category.trim() === ""}
            onPress={addCategory}
          />
        </View>
      )}
    </Sheet>
  );
};
