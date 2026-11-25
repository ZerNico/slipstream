import { Platform } from "react-native";
import { PhoneSearch } from "../src/search/PhoneSearch.tsx";
import { TvSearch } from "../src/search/TvSearch.tsx";

/**
 * Search: channels, programmes and recordings (TV from the rail, phones from a header button).
 * A screen of the root stack above the tabs, not a tab: Back returns to the screen that opened
 * it (the Guide, Home), where a hidden tab would have gone Home.
 */
export default function SearchRoute() {
  return Platform.isTV ? <TvSearch /> : <PhoneSearch />;
}
