/**
 * Locale-aware formatting for guide times, durations, sizes and counts. Works on the web and
 * in React Native (Hermes ships Intl); the few calls Hermes may lack have plain fallbacks.
 */
import { formatTag, type Locale } from "./locales.ts";

/** Plural variants as `Intl.PluralRules` names them; `#` is replaced by the formatted count. */
export interface PluralForms {
  /** Exactly zero, when the language would otherwise say "0 recordings". */
  readonly zero?: string;
  readonly one?: string;
  readonly two?: string;
  readonly few?: string;
  readonly many?: string;
  readonly other: string;
}

/** Formatting bound to one language, region and time zone. */
export interface Formatters {
  /** The catalogue language. */
  readonly locale: Locale;
  /** The tag handed to `Intl`, language plus region when the platform knows the pair. */
  readonly tag: string;
  /** A number with grouping and decimals as the region writes them. */
  readonly number: (value: number, options?: Intl.NumberFormatOptions) => string;
  /** Picks the plural variant for a count and puts the formatted count in place of `#`. */
  readonly plural: (count: number, forms: PluralForms) => string;
  /** A clock time: "05:00" or "5:00 AM". */
  readonly time: (date: Date) => string;
  /** A time range for guide slots: "05:00–07:00" or "5:00 – 7:00 AM". */
  readonly timeRange: (start: Date, end: Date) => string;
  /** A guide day: "So., 22. Nov." or "Sun 22 Nov". */
  readonly day: (date: Date) => string;
  /** Weekday and time for upcoming items: "Fr., 14:30". */
  readonly weekdayTime: (date: Date) => string;
  /** A full date: "22.11.2026" or "22 Nov 2026". */
  readonly date: (date: Date) => string;
  /**
   * A length of time from seconds: "1 h 28 min", "45 min", "30 s"; German "1 Std. 28 Min.".
   * No-break spaces throughout, so a length never wraps apart.
   */
  readonly duration: (seconds: number) => string;
  /** A playback position from seconds: "31:30", "1:02:03". */
  readonly clock: (seconds: number) => string;
  /** Distance behind live from seconds, with a true minus: "−31:30". */
  readonly behind: (seconds: number) => string;
  /** A file or disk size from bytes, decimal units: "6,1 GB", "412 GB". */
  readonly size: (bytes: number) => string;
  /** A bitrate from bits per second: "4 Mbit/s". */
  readonly bitrate: (bitsPerSecond: number) => string;
  /** A list joined the way the language joins: "Rennen und NBA". */
  readonly list: (items: readonly string[]) => string;
}

/** Options for {@link createFormatters}. */
export interface FormatOptions {
  /** ISO 3166 region such as "DE" or "GB"; without one, the language's default applies. */
  readonly region?: string | undefined;
  /** IANA time zone; without one, the device's zone applies. */
  readonly timeZone?: string | undefined;
  /**
   * The device's 12- or 24-hour setting (Android's "Use 24-hour format"), which can differ
   * from what the language and region would pick; without one, the region decides.
   */
  readonly twentyFourHour?: boolean | undefined;
}

/**
 * Unit words per language. German writes the abbreviations a German reader expects ("1 Std.
 * 20 Min."), the same style as every hand-written minute in the catalogue.
 */
const units: Record<Locale, { hour: string; minute: string; second: string }> = {
  en: { hour: "h", minute: "min", second: "s" },
  de: { hour: "Std.", minute: "Min.", second: "Sek." },
};

const SIZE_UNITS = ["B", "kB", "MB", "GB", "TB", "PB"] as const;
const BITRATE_UNITS = ["bit/s", "kbit/s", "Mbit/s", "Gbit/s"] as const;
/** No-break space between a number and its unit, so "6,1 GB" never wraps apart. */
const NBSP = String.fromCodePoint(0xa0);
/** True minus sign, the width of a digit in tabular figures. */
const MINUS = String.fromCodePoint(0x2212);
const EN_DASH = String.fromCodePoint(0x2013);

const pad = (value: number) => String(value).padStart(2, "0");

/** A playback position: "31:30", or "1:02:03" from an hour on. */
const clock = (seconds: number) => {
  const total = Math.floor(Math.abs(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
};

/** Splits a value into decimal (1000-based) units; below 10 keeps one decimal. */
const decimalUnit = (value: number, scale: readonly string[]) => {
  let amount = Math.abs(value);
  let index = 0;
  while (amount >= 1000 && index < scale.length - 1) {
    amount /= 1000;
    index += 1;
  }
  // 9.96 rounds to 10.0, which reads better as the next whole number.
  const digits = index === 0 || amount >= 9.95 ? 0 : 1;
  return { amount: Math.sign(value) * amount, unit: scale[index] ?? "", digits };
};

/**
 * Formatters for one language and region. Dates are formatted in `timeZone`, or the
 * device's zone when it is left out.
 */
export const createFormatters = (locale: Locale, options: FormatOptions = {}): Formatters => {
  const tag = formatTag(locale, options.region);
  const zone = options.timeZone ? { timeZone: options.timeZone } : {};
  const hourCycle = options.twentyFourHour === undefined ? {} : { hour12: !options.twentyFourHour };
  const timeFormat = new Intl.DateTimeFormat(tag, { timeStyle: "short", ...hourCycle, ...zone });
  const dayFormat = new Intl.DateTimeFormat(tag, {
    weekday: "short",
    day: "numeric",
    month: "short",
    ...zone,
  });
  const weekdayTimeFormat = new Intl.DateTimeFormat(tag, {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
    ...hourCycle,
    ...zone,
  });
  const dateFormat = new Intl.DateTimeFormat(tag, { dateStyle: "medium", ...zone });
  // Hermes on Android ships without `Intl.PluralRules`. English and German, the catalogue's
  // languages, share one rule (one for exactly 1, other otherwise), so that is the fallback.
  const pluralRules: Pick<Intl.PluralRules, "select"> =
    typeof Intl.PluralRules === "function"
      ? new Intl.PluralRules(tag)
      : { select: (count: number) => (count === 1 ? "one" : "other") };
  const numberFormats = new Map<string, Intl.NumberFormat>();
  const unit = units[locale];
  const twentyFourHour = ["h23", "h24"].includes(timeFormat.resolvedOptions().hourCycle ?? "");

  const number = (value: number, opts: Intl.NumberFormatOptions = {}) => {
    const key = JSON.stringify(opts);
    let format = numberFormats.get(key);
    if (!format) {
      format = new Intl.NumberFormat(tag, opts);
      numberFormats.set(key, format);
    }
    return format.format(value);
  };

  // Sizes keep their decimal ("7,0 GB" lines up with "6,1 GB"); bitrates drop a trailing zero.
  const withUnit = (
    { amount, unit: symbol, digits }: ReturnType<typeof decimalUnit>,
    fixed: boolean,
  ) =>
    `${number(amount, { maximumFractionDigits: digits, minimumFractionDigits: fixed ? digits : 0 })}${NBSP}${symbol}`;

  const time = (date: Date) => timeFormat.format(date);

  return {
    locale,
    tag,
    number,
    plural: (count, forms) => {
      const variant =
        count === 0 && forms.zero !== undefined ? forms.zero : forms[pluralRules.select(count)];
      return (variant ?? forms.other).replaceAll("#", number(count));
    },
    time,
    timeRange: (start, end) =>
      // 24-hour regions read "05:00–07:00"; Intl would add "Uhr" in German. 12-hour regions
      // get Intl's range, which shares the AM/PM ("5:00 – 7:00 AM").
      twentyFourHour || typeof timeFormat.formatRange !== "function"
        ? `${time(start)}${EN_DASH}${time(end)}`
        : timeFormat.formatRange(start, end),
    day: (date) => dayFormat.format(date),
    weekdayTime: (date) => weekdayTimeFormat.format(date),
    date: (date) => dateFormat.format(date),
    duration: (seconds) => {
      const total = Math.max(0, Math.round(seconds));
      if (total < 60) return `${number(total)}${NBSP}${unit.second}`;
      const minutes = Math.round(total / 60);
      const h = Math.floor(minutes / 60);
      const m = minutes % 60;
      if (h === 0) return `${number(m)}${NBSP}${unit.minute}`;
      const hours = `${number(h)}${NBSP}${unit.hour}`;
      return m === 0 ? hours : `${hours}${NBSP}${number(m)}${NBSP}${unit.minute}`;
    },
    clock,
    behind: (seconds) =>
      Math.floor(Math.abs(seconds)) === 0 ? clock(0) : `${MINUS}${clock(seconds)}`,
    size: (bytes) => withUnit(decimalUnit(bytes, SIZE_UNITS), true),
    bitrate: (bitsPerSecond) => withUnit(decimalUnit(bitsPerSecond, BITRATE_UNITS), false),
    list: (items) =>
      typeof Intl.ListFormat === "function"
        ? new Intl.ListFormat(tag, { type: "conjunction" }).format(items)
        : items.join(", "),
  };
};
