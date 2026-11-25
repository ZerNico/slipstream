import { Platform } from "react-native";
import { PhoneGuide } from "../../src/phone/PhoneGuide.tsx";
import { TvGuide } from "../../src/tv/guide/TvGuide.tsx";

/** Guide: the remote-driven grid on TV, the now/next list on phone. */
export default function GuideScreen() {
  return Platform.isTV ? <TvGuide /> : <PhoneGuide />;
}
