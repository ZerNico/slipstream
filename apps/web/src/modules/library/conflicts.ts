import { HOUR } from "@slipstream/domain";

// Which items conflict and how to resolve them is shared with the phone (`scheduledDays` in the
// domain, `resolveIntro` in i18n); here is only the window the web asks about.

/**
 * The window the Upcoming tab asks about conflicts in: from the current hour, two weeks
 * ahead. Whole hours keep the query key stable while the clock ticks.
 */
export const upcomingWindow = (now: number) => {
  const from = Math.floor(now / HOUR) * HOUR;
  return { from, to: from + 15 * 24 * HOUR };
};
