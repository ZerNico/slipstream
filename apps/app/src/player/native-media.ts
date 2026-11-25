import { requireOptionalNativeModule } from "expo";
import type { MediaCapabilities } from "@slipstream/domain";
import { capabilitiesFrom, type NativeMediaReport } from "./capabilities.ts";

/** The native probe; absent in a build without it (Expo Go). */
const native = requireOptionalNativeModule<{ readonly probe: () => NativeMediaReport }>(
  "SlipstreamMediaCapabilities",
);

/**
 * What this device can decode and pass through right now, for a new playback session: read
 * fresh each time, so the audio route in use (a receiver over HDMI, or not) is the current one.
 */
export const deviceCapabilities = (): MediaCapabilities => {
  try {
    return capabilitiesFrom(native?.probe());
  } catch {
    return capabilitiesFrom(undefined);
  }
};
