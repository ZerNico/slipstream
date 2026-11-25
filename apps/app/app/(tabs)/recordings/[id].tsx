import { useLocalSearchParams } from "expo-router";
import { Platform } from "react-native";
import { PhoneRecordingDetail } from "../../../src/phone/library/PhoneRecordingDetail.tsx";
import { TvRecordingPage } from "../../../src/tv/library/TvRecordingPage.tsx";

/** A recording's page: full screen over its picture on TV, a scrolling page on phones. */
export default function RecordingRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return Platform.isTV ? <TvRecordingPage id={id} /> : <PhoneRecordingDetail id={id} />;
}
