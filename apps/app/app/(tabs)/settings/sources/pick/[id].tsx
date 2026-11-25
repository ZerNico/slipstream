import { useLocalSearchParams } from "expo-router";
import { PhoneStreamPicker } from "../../../../../src/phone/settings/sources/PhoneStreamPicker.tsx";

/** Choose which streams of a source become channels (phones, admin). */
export default function StreamPickerRoute() {
  const { id, show } = useLocalSearchParams<{ id: string; show?: string }>();
  return <PhoneStreamPicker id={id} show={show === "new" ? "new" : "all"} />;
}
