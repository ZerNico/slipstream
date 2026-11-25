import { useLocalSearchParams } from "expo-router";
import { PhoneChannelEdit } from "../../../../src/phone/settings/sources/PhoneChannelEdit.tsx";

/** One channel's name and logo (phones, admin). */
export default function ChannelRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <PhoneChannelEdit id={id} />;
}
