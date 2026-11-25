import { Platform } from "react-native";
import { PhoneProblems } from "../../../src/phone/library/PhoneProblems.tsx";
import { TvProblems } from "../../../src/tv/library/TvProblems.tsx";

/** What needs attention: a list on TV and on phone. */
export default function ProblemsRoute() {
  return Platform.isTV ? <TvProblems /> : <PhoneProblems />;
}
