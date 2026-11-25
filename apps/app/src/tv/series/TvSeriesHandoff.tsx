import { m } from "@slipstream/i18n";
import { useRouter } from "expo-router";
import { StyleSheet, View } from "react-native";
import { useTheme } from "../../theme/theme.ts";
import { PhoneHandoff } from "../PhoneHandoff.tsx";
import { Rail } from "../Rail.tsx";
import { editSeriesHref, newSeriesHref } from "../../routes.ts";

/**
 * The series editor's routes on TV (new, or editing `id`): the editor is a form of typed
 * conditions, so the TV hands it to the phone with a QR code. Close or Back leaves.
 */
export const TvSeriesHandoff = ({ id }: { readonly id?: string | undefined }) => {
  const { colors } = useTheme();
  const router = useRouter();
  const leave = () => {
    if (router.canGoBack()) router.back();
    else router.replace("/recordings/series");
  };
  return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.bg }]}>
      <Rail current="recordings" />
      <PhoneHandoff
        title={id === undefined ? m.series_new() : m.series_title_edit()}
        path={id === undefined ? newSeriesHref : editSeriesHref(id)}
        onClose={leave}
      />
    </View>
  );
};
