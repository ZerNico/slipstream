import Constants from "expo-constants";
import { Platform } from "react-native";
import type { DeviceInfo } from "@slipstream/api";

/**
 * How this device appears in the server's device list: the name the owner gave it in Android
 * settings ("Living Room Shield"), else the model, and whether it is a TV or a phone.
 */
export const thisDevice = (): DeviceInfo => {
  const named = Constants.deviceName?.trim();
  const constants: Readonly<Record<string, unknown>> = Platform.constants;
  const model = typeof constants.Model === "string" ? constants.Model : "";
  const name =
    named !== undefined && named.length > 0 ? named : model.length > 0 ? model : "Android";
  return { name, kind: Platform.isTV ? "tv" : "phone" };
};
