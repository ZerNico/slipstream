import type { HouseholdDefaultHint, QualityChoice } from "@slipstream/domain";
import { m } from "./runtime.ts";

/**
 * The words for a household quality default ("High · 8 Mbit/s", Settings › Default quality),
 * for every client. There "auto" is "Automatic": the server picks by connection and measured
 * speed.
 */
export const qualityLabel = (quality: QualityChoice): string => {
  switch (quality) {
    case "auto":
      return m.quality_auto();
    case "original":
      return m.quality_original();
    case "8000":
      return m.quality_high({ bitsPerSecond: 8_000_000 });
    case "4000":
      return m.quality_medium({ bitsPerSecond: 4_000_000 });
    case "2000":
      return m.quality_saver({ bitsPerSecond: 2_000_000 });
  }
};

/**
 * The words for a device's own quality: its "auto" is "Household default" (the household's
 * default for this connection); the others as the household page names them.
 */
export const deviceQualityLabel = (quality: QualityChoice): string =>
  quality === "auto" ? m.quality_server_default() : qualityLabel(quality);

/**
 * What a device's "Household default" stands for now, as the line under that choice ("Now
 * Original", "At home Original, away High"). A household that leaves it to the connection itself
 * gets the general explanation instead of a "Now Automatic".
 */
export const householdDefaultHintText = (hint: HouseholdDefaultHint): string =>
  hint._tag === "One"
    ? hint.quality === "auto"
      ? m.quality_server_default_detail()
      : m.quality_server_now({ quality: qualityLabel(hint.quality) })
    : m.quality_server_home_away({
        home: qualityLabel(hint.home),
        away: qualityLabel(hint.away),
      });
