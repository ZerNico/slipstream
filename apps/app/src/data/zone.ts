import { getTimeZone } from "@slipstream/i18n";

/** The household's zone (HouseholdZone sets it), else the device's. */
export const householdZone = (): string =>
  getTimeZone() ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
