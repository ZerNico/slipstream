import { useEffect, useRef } from "react";
import { DeviceEventEmitter } from "react-native";

/**
 * Event the `with-digit-keys` config plugin emits from MainActivity for KEYCODE_0..KEYCODE_9.
 * react-native-tvos 0.88 does not deliver digit keys through `useTVEventHandler`, so without
 * the plugin (or on remotes without digits) this hook simply never fires.
 */
const DIGIT_EVENT = "slipstreamDigit";

/** Calls `onDigit` for each digit key pressed while `enabled`. */
export const useDigitKeys = (onDigit: (digit: number) => void, enabled: boolean): void => {
  const latest = useRef(onDigit);
  useEffect(() => {
    latest.current = onDigit;
  }, [onDigit]);
  useEffect(() => {
    if (!enabled) return;
    const subscription = DeviceEventEmitter.addListener(DIGIT_EVENT, (digit: unknown) => {
      if (typeof digit === "number" && Number.isInteger(digit)) latest.current(digit);
    });
    return () => subscription.remove();
  }, [enabled]);
};
