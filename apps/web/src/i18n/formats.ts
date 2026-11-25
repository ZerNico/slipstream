import { formatters } from "@slipstream/i18n";

/*
 * Every date and time the web shows goes through the shared formatters of @slipstream/i18n,
 * in the reader's language and region, so one screen never mixes two clocks. Running things use
 * the wall clock; finished recordings use the position with its length (SPEC §7.9).
 */

/** A wall-clock time the reader's way: "06:12" or "6:12 AM". */
export const formatClock = (epochMs: number): string => formatters().time(new Date(epochMs));

/** A day as the guide writes it, "Sun 22 Nov". */
export const formatDay = (epochMs: number): string => formatters().day(new Date(epochMs));

/** A day and a time span, "Sun 22 Nov · 05:00–07:00". */
export const formatSlot = (start: number, end: number): string => {
  const f = formatters();
  return `${f.day(new Date(start))} · ${f.timeRange(new Date(start), new Date(end))}`;
};

/** A time span within a day, "05:00–07:00" or "5:00 – 7:00 AM". */
export const formatTimeRange = (start: number, end: number): string =>
  formatters().timeRange(new Date(start), new Date(end));

/** A length from milliseconds: "45 min", "2 h 35 min". */
export const formatDuration = (ms: number): string => formatters().duration(ms / 1000);

/** A size in decimal units, "412 GB" or "6.1 GB". */
export const formatBytes = (bytes: number): string => formatters().size(bytes);

/** A position in a recording from milliseconds: "46:30", "1:15:00". */
export const formatPosition = (ms: number): string => formatters().clock(Math.max(0, ms) / 1000);

/** Distance behind live from milliseconds, with a true minus: "−31:30". */
export const formatBehind = (ms: number): string => formatters().behind(Math.max(0, ms) / 1000);

/** Names joined the reader's way: "Zattoo-Proxy and IPTV Provider". */
export const formatList = (items: readonly string[]): string => formatters().list(items);
