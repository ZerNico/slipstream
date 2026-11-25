import type { StreamQuality } from "@slipstream/domain";
import { m } from "@slipstream/i18n";
import type { StreamPickerState } from "./use-stream-picker.ts";

/** A quality as its badge writes it; nothing for a name that claims none. */
export const qualityText = (quality: StreamQuality): string | undefined => {
  switch (quality) {
    case "uhd":
      return m.picker_quality_uhd();
    case "fhd":
      return m.picker_quality_fhd();
    case "hd":
      return m.picker_quality_hd();
    case "sd":
      return m.picker_quality_sd();
    case "unknown":
      return undefined;
  }
};

/** What the Add button says: the channels it makes, or that streams join existing ones. */
export const addLabel = (picker: StreamPickerState): string =>
  picker.plan.channels === 0 && picker.plan.joining > 0
    ? m.picker_add_to_existing()
    : m.picker_add({ count: picker.streamsLoading ? picker.selected : picker.plan.channels });
