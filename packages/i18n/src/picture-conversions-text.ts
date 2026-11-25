import type { PictureConversionLimit } from "@slipstream/domain";
import { m } from "./runtime.ts";

/**
 * The words for a "Simultaneous picture conversions" choice (Settings › Default quality), for
 * every client: "No limit", "Automatic", or the number ("3").
 */
export const pictureConversionsLabel = (limit: PictureConversionLimit): string =>
  limit === "unlimited"
    ? m.settings_picture_conversions_unlimited()
    : limit === "auto"
      ? m.settings_hardware_auto()
      : // A count from 1 to 10 reads the same in every language Slipstream speaks.
        limit;
