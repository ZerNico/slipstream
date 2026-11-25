import { Platform } from "react-native";
import { PhoneSeries } from "../../../../src/phone/library/PhoneSeries.tsx";
import { TvSeries } from "../../../../src/tv/series/TvSeries.tsx";

/** The series recordings: a list with the rail on TV, a list on phone. */
export default function SeriesRoute() {
  return Platform.isTV ? <TvSeries /> : <PhoneSeries />;
}
