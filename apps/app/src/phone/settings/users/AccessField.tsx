import {
  accessNames,
  type AccessToken,
  addToken,
  freeTokens,
  type Channel,
  type Collection,
  removeToken,
  tokenKey,
  tokenName,
} from "@slipstream/domain";
import { m } from "@slipstream/i18n";
import * as Haptics from "expo-haptics";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useTheme } from "../../../theme/theme.ts";
import { OptionRow } from "../../../ui/OptionRow.tsx";
import { Icon } from "../../../ui/Icon.tsx";
import { Sheet } from "../../../ui/Sheet.tsx";

/** A heading inside the Add sheet ("Collections", "Channels"). */
const SheetHeading = ({ title }: { readonly title: string }) => {
  const { colors, em, fonts } = useTheme();
  return (
    <Text
      accessibilityRole="header"
      style={{
        fontFamily: fonts.fUiSemiBold,
        fontSize: 0.85 * em,
        color: colors.fg3,
        paddingHorizontal: em,
        paddingTop: 0.6 * em,
      }}
    >
      {title}
    </Text>
  );
};

/**
 * "What they see" (SPEC §8.7) on a phone: channels and collections as tokens with a remove
 * button each, and Add, which opens a sheet listing what isn't there yet (collections, then
 * channels). With no tokens it says "Everything".
 */
export const AccessField = ({
  tokens,
  onChange,
  channels,
  collections,
}: {
  readonly tokens: readonly AccessToken[];
  readonly onChange: (tokens: AccessToken[]) => void;
  readonly channels: readonly Channel[];
  readonly collections: readonly Collection[];
}) => {
  const { colors, em, fonts, radii } = useTheme();
  const [adding, setAdding] = useState(false);
  const names = accessNames(channels, collections);
  const free = freeTokens(tokens, channels, collections);
  const freeCollections = free.collections;
  const freeChannels = free.channels;
  const add = (token: AccessToken) => {
    void Haptics.selectionAsync();
    onChange(addToken(tokens, token));
    setAdding(false);
  };
  return (
    <View style={{ gap: 0.4 * em, paddingHorizontal: em, paddingVertical: 0.8 * em }}>
      <Text style={{ fontFamily: fonts.fUiSemiBold, fontSize: 0.98 * em, color: colors.fg }}>
        {m.access_label()}
      </Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 0.45 * em }}>
        {tokens.length === 0 ? (
          <Text
            style={{
              fontFamily: fonts.fUi,
              fontSize: 0.92 * em,
              color: colors.fg2,
              paddingVertical: 0.45 * em,
              paddingRight: 0.3 * em,
            }}
          >
            {m.access_everything()}
          </Text>
        ) : null}
        {tokens.map((token) => {
          const name = tokenName(token, names);
          return (
            <View
              key={tokenKey(token)}
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 0.2 * em,
                paddingLeft: 0.7 * em,
                paddingRight: 0.2 * em,
                height: 2.2 * em,
                borderRadius: radii.rS,
                backgroundColor: colors.raised,
              }}
            >
              <Text
                style={{ fontFamily: fonts.fUiSemiBold, fontSize: 0.88 * em, color: colors.fg }}
              >
                {name}
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={m.access_remove({ name })}
                hitSlop={0.4 * em}
                onPress={() => onChange(removeToken(tokens, token))}
                style={({ pressed }) => ({
                  width: 1.7 * em,
                  height: 1.7 * em,
                  borderRadius: 0.85 * em,
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: pressed ? colors.line : "transparent",
                })}
              >
                {/* The plus turned a quarter is the close cross. */}
                <View style={{ transform: [{ rotate: "45deg" }] }}>
                  <Icon name="plus" size={em} color={colors.fg2} />
                </View>
              </Pressable>
            </View>
          );
        })}
        {freeCollections.length + freeChannels.length === 0 ? null : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={m.access_add_label()}
            onPress={() => setAdding(true)}
            style={({ pressed }) => ({
              flexDirection: "row",
              alignItems: "center",
              gap: 0.3 * em,
              paddingHorizontal: 0.7 * em,
              height: 2.2 * em,
              borderRadius: radii.rS,
              borderWidth: 1,
              borderColor: colors.line,
              backgroundColor: pressed ? colors.raised : "transparent",
            })}
          >
            <Icon name="plus" size={em} color={colors.fg2} />
            <Text style={{ fontFamily: fonts.fUiSemiBold, fontSize: 0.88 * em, color: colors.fg2 }}>
              {m.field_value_more()}
            </Text>
          </Pressable>
        )}
      </View>
      {adding ? (
        <Sheet label={m.access_add_label()} onClose={() => setAdding(false)}>
          {freeCollections.length === 0 ? null : <SheetHeading title={m.library_collections()} />}
          {freeCollections.map((collection) => (
            <OptionRow
              key={collection.id}
              title={collection.name}
              onPress={() => add({ kind: "collection", id: collection.id })}
            />
          ))}
          {freeChannels.length === 0 ? null : <SheetHeading title={m.channels_heading()} />}
          {freeChannels.map((channel) => (
            <OptionRow
              key={channel.id}
              title={channel.name}
              onPress={() => add({ kind: "channel", id: channel.id })}
            />
          ))}
        </Sheet>
      ) : null}
    </View>
  );
};
