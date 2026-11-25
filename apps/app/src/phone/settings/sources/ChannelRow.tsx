import type { Channel } from "@slipstream/domain";
import { m } from "@slipstream/i18n";
import { Pressable, Text, View } from "react-native";
import { useTheme } from "../../../theme/theme.ts";
import { Icon } from "../../../ui/Icon.tsx";
import { CHANNEL_LOGO_EM, CHANNEL_ROW_EM } from "./metrics.ts";
import { ChannelLogo } from "./parts.tsx";

/** A round tick at a row's start in select mode: filled amber when chosen. */
const SelectMark = ({ selected }: { readonly selected: boolean }) => {
  const { colors, em } = useTheme();
  return (
    <View
      style={{
        width: 1.4 * em,
        height: 1.4 * em,
        borderRadius: 0.7 * em,
        borderWidth: selected ? 0 : 1.5,
        borderColor: colors.borderStrong,
        backgroundColor: selected ? colors.brand : "transparent",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {selected ? <Icon name="check" size={em} color={colors.onBrand} /> : null}
    </View>
  );
};

/**
 * One channel of the lineup: its number, logo and name, a line with its group and how many
 * streams it has, and a star for a favourite. A tap opens the channel; a long press starts
 * select mode, where a tap chooses it and a tick shows at the start. Hidden channels read
 * quieter. Every state keeps the row's height.
 */
export const ChannelRow = ({
  channel,
  line,
  selecting,
  selected,
  onPress,
  onLongPress,
}: {
  readonly channel: Channel;
  /** "Deutschland · 3 streams"; empty while the streams load. */
  readonly line: string;
  readonly selecting: boolean;
  readonly selected: boolean;
  readonly onPress: () => void;
  readonly onLongPress: () => void;
}) => {
  const { colors, em, fonts, tokens } = useTheme();
  return (
    <Pressable
      accessibilityRole={selecting ? "checkbox" : "button"}
      accessibilityLabel={selecting ? m.lineup_select_named({ name: channel.name }) : channel.name}
      accessibilityState={selecting ? { checked: selected } : {}}
      onPress={onPress}
      onLongPress={onLongPress}
      style={({ pressed }) => ({
        height: CHANNEL_ROW_EM * em,
        flexDirection: "row",
        alignItems: "center",
        gap: 0.7 * em,
        paddingLeft: em,
        paddingRight: em,
        backgroundColor: selected
          ? tokens.colors.state.selected
          : pressed
            ? colors.surface
            : "transparent",
      })}
    >
      {selecting ? <SelectMark selected={selected} /> : null}
      <Text
        style={{
          width: 2.2 * em,
          textAlign: "right",
          fontFamily: fonts.fUi,
          fontSize: 0.9 * em,
          color: colors.fg2,
          fontVariant: ["tabular-nums"],
        }}
      >
        {channel.number === undefined ? "" : String(channel.number)}
      </Text>
      <ChannelLogo name={channel.name} logoUrl={channel.logoUrl} size={CHANNEL_LOGO_EM * em} />
      <View style={{ flex: 1, gap: 0.15 * em }}>
        <Text
          numberOfLines={1}
          style={{
            fontFamily: fonts.fUiSemiBold,
            fontSize: 0.98 * em,
            color: channel.hidden ? colors.fg3 : colors.fg,
          }}
        >
          {channel.name}
        </Text>
        <Text
          numberOfLines={1}
          style={{ fontFamily: fonts.fUi, fontSize: 0.8 * em, color: colors.fg3 }}
        >
          {line}
        </Text>
      </View>
      {channel.favourite ? (
        <Text
          accessibilityLabel={m.lineup_favourite()}
          style={{ fontSize: 0.9 * em, color: colors.brand }}
        >
          ★
        </Text>
      ) : null}
    </Pressable>
  );
};
