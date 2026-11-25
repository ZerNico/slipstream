import { Platform } from "react-native";
import { PhoneLibrary } from "../../../src/phone/library/PhoneLibrary.tsx";
import { TvRecordings } from "../../../src/tv/TvRecordings.tsx";

/** Recordings library: shelves on TV (opened from the rail), a list on phone. */
export default function RecordingsScreen() {
  return Platform.isTV ? <TvRecordings /> : <PhoneLibrary />;
}
