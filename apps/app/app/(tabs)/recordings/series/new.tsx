import { Platform } from "react-native";
import { PhoneSeriesEditor } from "../../../../src/phone/series-editor/PhoneSeriesEditor.tsx";
import { TvSeriesHandoff } from "../../../../src/tv/series/TvSeriesHandoff.tsx";

/** A new series recording: the templates, then the editor (phones); on TV the phone hand-off. */
export default function NewSeriesRoute() {
  return Platform.isTV ? <TvSeriesHandoff /> : <PhoneSeriesEditor />;
}
