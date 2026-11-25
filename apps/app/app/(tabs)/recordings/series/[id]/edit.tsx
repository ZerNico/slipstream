import { useLocalSearchParams } from "expo-router";
import { Platform } from "react-native";
import { PhoneSeriesEditor } from "../../../../../src/phone/series-editor/PhoneSeriesEditor.tsx";
import { TvSeriesHandoff } from "../../../../../src/tv/series/TvSeriesHandoff.tsx";

/** Editing a series recording (phones); on TV the phone hand-off. */
export default function EditSeriesRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return Platform.isTV ? <TvSeriesHandoff id={id} /> : <PhoneSeriesEditor id={id} />;
}
