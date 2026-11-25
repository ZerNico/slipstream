/**
 * Channel number entry with the remote's digit keys: digits collect until a pause, until the
 * maximum length, or until no channel number could continue the typed prefix.
 */

/** Digits typed so far and when the last one arrived (ms). */
export interface DigitEntry {
  readonly digits: string;
  readonly lastAt: number;
}

/** Limits for digit entry. */
export interface DigitConfig {
  readonly maxDigits: number;
  /** Pause (ms) after which the typed number is committed. */
  readonly timeout: number;
}

/** Four digits, committed after 1.5 s without another key. */
export const defaultDigitConfig: DigitConfig = { maxDigits: 4, timeout: 1500 };

/** The outcome of a key: the entry still open, and a channel number to jump to now, if any. */
export interface DigitResult {
  readonly entry: DigitEntry | undefined;
  readonly commit: number | undefined;
}

const canContinue = (digits: string, numbers: readonly number[]): boolean =>
  numbers.some((number) => {
    const text = String(number);
    return text.length > digits.length && text.startsWith(digits);
  });

/**
 * Adds one digit typed at `at`. A stale entry (older than the timeout) is dropped first; the
 * caller commits entries on a timer with {@link expireDigits}. When `numbers` (the channel
 * numbers that exist) is given, entry commits as soon as no longer number starts with the digits.
 */
export const typeDigit = (
  entry: DigitEntry | undefined,
  digit: number,
  at: number,
  config: DigitConfig = defaultDigitConfig,
  numbers?: readonly number[],
): DigitResult => {
  if (!Number.isInteger(digit) || digit < 0 || digit > 9) return { entry, commit: undefined };
  const fresh = entry === undefined || at - entry.lastAt > config.timeout;
  const digits = (fresh ? "" : entry.digits) + String(digit);
  const done =
    digits.length >= config.maxDigits ||
    (numbers !== undefined && !canContinue(String(Number(digits)), numbers));
  if (done) return { entry: undefined, commit: Number(digits) };
  return { entry: { digits, lastAt: at }, commit: undefined };
};

/** When an open entry commits on its own (ms). */
export const digitDeadline = (
  entry: DigitEntry,
  config: DigitConfig = defaultDigitConfig,
): number => entry.lastAt + config.timeout;

/** Commits the entry if its pause has run out by `at`; otherwise leaves it open. */
export const expireDigits = (
  entry: DigitEntry | undefined,
  at: number,
  config: DigitConfig = defaultDigitConfig,
): DigitResult => {
  if (entry === undefined) return { entry, commit: undefined };
  if (at < digitDeadline(entry, config)) return { entry, commit: undefined };
  return { entry: undefined, commit: Number(entry.digits) };
};
