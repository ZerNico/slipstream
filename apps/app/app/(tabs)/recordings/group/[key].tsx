import { useLocalSearchParams } from "expo-router";
import { Platform } from "react-native";
import { PhoneGroup } from "../../../../src/phone/library/PhoneGroup.tsx";
import { TvPlacePage } from "../../../../src/tv/library/TvPlacePage.tsx";

/** A place of the library: a collection or a show (rows of cards on TV, a list on phones). */
export default function GroupRoute() {
  const { key } = useLocalSearchParams<{ key: string }>();
  return Platform.isTV ? <TvPlacePage groupKey={key} /> : <PhoneGroup groupKey={key} />;
}
