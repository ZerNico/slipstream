import { Platform } from "react-native";
import { PhoneScheduled } from "../../../src/phone/library/PhoneScheduled.tsx";
import { TvScheduled } from "../../../src/tv/library/TvScheduled.tsx";

/** What is scheduled, with the conflicts' ways out: a list on TV and on phone. */
export default function ScheduledRoute() {
  return Platform.isTV ? <TvScheduled /> : <PhoneScheduled />;
}
