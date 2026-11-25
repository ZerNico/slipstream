import { useLocalSearchParams } from "expo-router";
import { PhoneSourceForm } from "../../../../src/phone/settings/sources/PhoneSourceForm.tsx";

/** Edit a source (phones, admin). */
export default function EditSourceRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <PhoneSourceForm id={id} />;
}
