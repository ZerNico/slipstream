import { useLocalSearchParams } from "expo-router";
import { PhoneGuestPage } from "../../../../../src/phone/settings/users/PhoneUserPages.tsx";

/** What one guest may see and do (phones, admins). */
export default function GuestRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <PhoneGuestPage id={id} />;
}
