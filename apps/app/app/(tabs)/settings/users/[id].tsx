import { useLocalSearchParams } from "expo-router";
import { PhoneProfilePage } from "../../../../src/phone/settings/users/PhoneUserPages.tsx";

/** One household profile to edit, or `new` to add one (phones, admins). */
export default function ProfileRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <PhoneProfilePage id={id} />;
}
