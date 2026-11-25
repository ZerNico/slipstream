import { useLocalSearchParams } from "expo-router";
import { Platform } from "react-native";
import { PhoneSeriesDetail } from "../../../../../src/phone/library/PhoneSeriesDetail.tsx";
import { TvSeriesDetail } from "../../../../../src/tv/series/TvSeriesDetail.tsx";

/** One series recording: its page with the rail on TV, on phone the phone's page. */
export default function SeriesDetailRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return Platform.isTV ? <TvSeriesDetail id={id} /> : <PhoneSeriesDetail id={id} />;
}
