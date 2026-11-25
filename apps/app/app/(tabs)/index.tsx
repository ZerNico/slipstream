import { Platform } from "react-native";
import { PhoneHome } from "../../src/phone/PhoneHome.tsx";
import { TvHome } from "../../src/tv/TvHome.tsx";

/** Home: the TV layout on Android TV, the phone layout everywhere else. */
export default function HomeScreen() {
  return Platform.isTV ? <TvHome /> : <PhoneHome />;
}
