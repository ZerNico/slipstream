import { Text, View } from "react-native";
import { useTheme } from "../theme/theme.ts";

/**
 * What a phone list says when it has nothing: a title and an optional line, centred in the room
 * the list has. Unlike the full-screen status it sits in the list's flow, so it works as a
 * list's empty component (give the list `contentContainerStyle.flexGrow: 1`).
 */
export const EmptyState = ({
  title,
  body,
}: {
  readonly title: string;
  readonly body?: string | undefined;
}) => {
  const { colors, em, fonts } = useTheme();
  return (
    <View
      style={{
        flexGrow: 1,
        justifyContent: "center",
        alignItems: "center",
        paddingHorizontal: 1.5 * em,
        paddingVertical: 3 * em,
        gap: 0.5 * em,
      }}
    >
      <Text
        style={{
          fontFamily: fonts.fUiSemiBold,
          fontSize: 1.1 * em,
          color: colors.fg,
          textAlign: "center",
        }}
      >
        {title}
      </Text>
      {body === undefined ? null : (
        <Text
          style={{
            fontFamily: fonts.fUi,
            fontSize: 0.9 * em,
            lineHeight: 1.3 * em,
            color: colors.fg3,
            textAlign: "center",
          }}
        >
          {body}
        </Text>
      )}
    </View>
  );
};
