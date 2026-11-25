/** A calendar day in a time zone. `month` is 1 to 12. */
export interface LocalDate {
  readonly year: number;
  readonly month: number;
  readonly day: number;
}

const MINUTE = 60_000;
const DAY = 86_400_000;

const formatters = new Map<string, Intl.DateTimeFormat>();

const formatterFor = (timeZone: string) => {
  const cached = formatters.get(timeZone);
  if (cached) return cached;
  const made = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  formatters.set(timeZone, made);
  return made;
};

/** The wall clock of an instant in a zone, as fields. */
const wallClock = (at: Date, timeZone: string) => {
  const parts: Record<string, number> = {};
  for (const part of formatterFor(timeZone).formatToParts(at)) {
    if (part.type !== "literal") parts[part.type] = Number(part.value);
  }
  return {
    year: parts["year"] ?? 1970,
    month: parts["month"] ?? 1,
    day: parts["day"] ?? 1,
    hour: parts["hour"] ?? 0,
    minute: parts["minute"] ?? 0,
    second: parts["second"] ?? 0,
  };
};

/** Minutes the zone is ahead of UTC at an instant (60 for CET, 120 for CEST). */
export const offsetMinutes = (at: Date, timeZone: string): number => {
  const wall = wallClock(at, timeZone);
  const asUtc = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second);
  return Math.round((asUtc - Math.floor(at.getTime() / 1000) * 1000) / MINUTE);
};

/** The calendar day an instant falls on in a zone. */
export const localDateOf = (at: Date, timeZone: string): LocalDate => {
  const wall = wallClock(at, timeZone);
  return { year: wall.year, month: wall.month, day: wall.day };
};

/** The day after (or `days` after) a calendar day. */
export const addDays = (date: LocalDate, days: number): LocalDate => {
  const moved = new Date(Date.UTC(date.year, date.month - 1, date.day + days));
  return { year: moved.getUTCFullYear(), month: moved.getUTCMonth() + 1, day: moved.getUTCDate() };
};

/** Days since 1970-01-01 for a calendar day: a stable seed for schedules. */
export const dayNumber = (date: LocalDate): number =>
  Math.round(Date.UTC(date.year, date.month - 1, date.day) / DAY);

/**
 * The instant at which a zone's wall clock shows `minuteOfDay` on `date`. Minutes past 24:00 roll
 * into the next day. A wall time skipped by a DST jump resolves to the instant after the jump.
 */
export const zonedInstant = (date: LocalDate, minuteOfDay: number, timeZone: string): Date => {
  const naive = Date.UTC(date.year, date.month - 1, date.day) + minuteOfDay * MINUTE;
  const first = naive - offsetMinutes(new Date(naive), timeZone) * MINUTE;
  const second = naive - offsetMinutes(new Date(first), timeZone) * MINUTE;
  return new Date(Math.max(first, second));
};

const pad = (value: number, width = 2) => String(Math.abs(value)).padStart(width, "0");

/** An XMLTV timestamp in a zone's local time, e.g. `20261121160000 +0100`. */
export const xmltvTimestamp = (at: Date, timeZone: string): string => {
  const wall = wallClock(at, timeZone);
  const offset = offsetMinutes(at, timeZone);
  const sign = offset < 0 ? "-" : "+";
  return (
    `${wall.year}${pad(wall.month)}${pad(wall.day)}${pad(wall.hour)}${pad(wall.minute)}` +
    `${pad(wall.second)} ${sign}${pad(Math.floor(Math.abs(offset) / 60))}${pad(Math.abs(offset) % 60)}`
  );
};

/** `HH:MM` of an instant in a zone. */
export const clockTime = (at: Date, timeZone: string): string => {
  const wall = wallClock(at, timeZone);
  return `${pad(wall.hour)}:${pad(wall.minute)}`;
};
