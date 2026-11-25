import { epochMs, type GuideEntry, type ProgrammeMark, repeatKind } from "@slipstream/domain";
import { formatClock } from "~/i18n/formats.ts";
import { m } from "@slipstream/i18n";
import {
  type GuideCategory,
  type GuideDay,
  pillDay,
  type GuideAt,
  type SlotKey,
  slotTime,
} from "./model.ts";

/*
 * How the guide phrases things: day words, the cell labels screen readers hear and a channel's
 * name. Words come from the catalogue; artwork subjects are `~/ui/artwork/subjects.ts`.
 */

/**
 * A household day as the pills write it: "Today 21", "Sun 22". The one day notation (SPEC
 * decision 11): the same message as `dayPill` in `@slipstream/i18n`, which names the day a
 * moment falls on for Home's hero, the player and the library.
 */
export const dayPillLabel = (day: GuideDay): string =>
  m.library_day_pill({ weekday: day.weekday, day: day.date, today: day.offset === 0 });

/** A day as a heading names it: "Today" alone, else the pill ("Sun 22"). */
export const dayHeading = (day: GuideDay): string =>
  day.offset === 0 ? m.guide_day_word({ day: "today" }) : dayPillLabel(day);

/** A day inside a sentence: "today", "Sun 22". */
export const daySentenceLabel = (day: GuideDay): string =>
  m.guide_day_in_sentence({ day: pillDay(day), date: day.date });

/** The words under a slot's time: "Early evening", "Prime time", "Late". */
export const slotSub = (slot: SlotKey): string | undefined => {
  switch (slot) {
    case "now":
      return undefined;
    case "19:00":
      return m.guide_slot_early();
    case "20:15":
      return m.guide_slot_prime();
    case "22:00":
      return m.guide_slot_late();
  }
};

/** A slot's own words: "Now 18:42", "20:15". */
export const slotLabel = (slot: GuideAt, day: GuideDay, now: number): string =>
  slot === "now" ? m.guide_now({ now: new Date(now) }) : formatClock(slotTime(slot, day, now));

/** A category chip's words. */
export const categoryLabel = (category: GuideCategory): string => {
  switch (category) {
    case "all":
      return m.guide_cat_all();
    case "sport":
      return m.guide_cat_sport();
    case "film":
      return m.guide_cat_film();
    case "crime":
      return m.guide_cat_crime();
    case "docs":
      return m.guide_cat_doc();
    case "kids":
      return m.guide_cat_kids();
    case "news":
      return m.guide_cat_news();
  }
};

/**
 * The marker's spoken words: "recording", "scheduled", "scheduled, conflict", or for an episode
 * the viewer already has "already recorded" / "already scheduled" (recording model §3.6).
 */
export const markWords = (mark: ProgrammeMark): string[] => {
  switch (mark.state) {
    case "recording":
      return [m.guide_state_recording()];
    case "scheduled":
      return [m.guide_state_scheduled()];
    case "conflict":
      return [m.guide_state_scheduled(), m.guide_state_conflict()];
    case "repeat":
      // As the TV says it: a scheduled copy is "already scheduled", any other "already recorded".
      return [
        repeatKind(mark.of) === "scheduled"
          ? m.guide_state_had_scheduled()
          : m.guide_state_had_recorded(),
      ];
  }
};

/** A cell's time as its label speaks it: "17:15 to 19:57". */
export const cellTimeWords = (programme: GuideEntry): string =>
  m.guide_cell_time({
    start: new Date(epochMs(programme.start)),
    end: new Date(epochMs(programme.end)),
  });

/**
 * A programme's accessible name, channel first so moving between rows is heard (SPEC §8.2,
 * §10): "Das Erste, Sportschau, today, 17:15 to 19:57, live now". The timeline names the day
 * and whether it is on; the Channels list, one day already picked, leaves them out.
 */
export const cellLabel = (
  channel: string,
  programme: GuideEntry,
  mark: ProgrammeMark | undefined,
  context: {
    readonly day?: string;
    readonly when?: "past" | "airing" | "future";
    /** The spoken time, when the caller has it already ({@link cellTimeWords}). */
    readonly time?: string;
  } = {},
): string => {
  const { day, when, time = cellTimeWords(programme) } = context;
  return [
    channel,
    programme.title,
    ...(day === undefined ? [] : [day]),
    time,
    ...(when === "airing"
      ? [m.guide_state_live_now()]
      : when === "past"
        ? [m.guide_state_ended()]
        : []),
    ...(mark === undefined ? [] : markWords(mark)),
  ].join(", ");
};
