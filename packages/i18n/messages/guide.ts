/**
 * Messages for the guide (timeline, channels, strips) and the programme sheet. English is the
 * source; German follows each key. A key that takes parameters needs a sample, so the catalogue
 * test renders it in both languages.
 */
import type { Formatters } from "../src/format.ts";
import type { Weekday } from "./weekday.ts";
import { defineArea, sampleEnd, sampleStart } from "./area.ts";

type F = Formatters;

/** Weekdays as the guide's day pills write them ("Sun 22"). */
const pillDayEn: Readonly<Record<Weekday, string>> = {
  mon: "Mon",
  tue: "Tue",
  wed: "Wed",
  thu: "Thu",
  fri: "Fri",
  sat: "Sat",
  sun: "Sun",
};

const pillDayDe: Readonly<Record<Weekday, string>> = {
  mon: "Mo",
  tue: "Di",
  wed: "Mi",
  thu: "Do",
  fri: "Fr",
  sat: "Sa",
  sun: "So",
};

/** A day as the pills name it: today, or the weekday. */
type PillDay = Weekday | "today";

/** A length as the guide writes it: "1 h 18 min". */
const minutes = (value: number, f: F) => f.duration(value * 60);

/** Extra time stays in minutes, like the steppers: "60 min", never "1 h". */
const mins = (value: number, f: F) => `${f.number(value)}\u00A0min`;

/** The same in German, in the formatters' style: "60 Min.". */
const minsDe = (value: number, f: F) => `${f.number(value)}\u00A0Min.`;

/** The guide area of the catalogue. */
export const guide = defineArea({
  en: {
    guide_day_next: "Next day",
    guide_day_previous: "Previous day",
    guide_channel_rename_title: (p: { name: string }) => `Rename ${p.name}`,
    guide_channel_hidden: (p: { name: string }) => `${p.name} hidden`,
    guide_channel_hide: "Hide channel",
    guide_channel_logo: "Change logo…",
    guide_channel_rename: "Rename…",
    // Extra time in one line: "2 min early · 10 min late".
    padding_value: (p: { beforeMinutes: number; afterMinutes: number }, f: F) =>
      `${mins(p.beforeMinutes, f)} early · ${mins(p.afterMinutes, f)} late`,
    guide_every_broadcast: (p: { title: string }) => `Every “${p.title}”`,
    guide_all_episodes: "All episodes",
    guide_just_this: "Just this one",
    guide_this_episode: "This episode",
    guide_jump_now: "Now",
    guide_empty: "No guide data yet",
    // The TV guide's cell on a channel that airs nothing then (OK still watches it live).
    guide_no_info: "No guide information",
    guide_record_failed: "Couldn't schedule it.",
    guide_skip: "Skip to the guide",

    // Header and toolbar
    guide_view_label: "View",
    guide_view_timeline: "Timeline",
    guide_view_channels: "Channels",
    guide_jump_prime_label: (p: { time: Date }, f: F) => `Jump to ${f.time(p.time)}`,
    guide_days_label: "Day",
    guide_day_word: (p: { day: PillDay }) => (p.day === "today" ? "Today" : pillDayEn[p.day]),
    guide_day_pill: (p: { day: PillDay; date: number }) =>
      `${p.day === "today" ? "Today" : pillDayEn[p.day]} ${p.date}`,
    guide_day_menu_label: (p: { day: string }) => `Day: ${p.day}`,
    guide_day_in_sentence: (p: { day: PillDay; date: number }) =>
      p.day === "today" ? "today" : `${pillDayEn[p.day]} ${p.date}`,
    guide_categories_label: "Category",
    guide_cat_all: "All",
    guide_cat_sport: "Sport",
    guide_cat_film: "Films",
    guide_cat_crime: "Crime",
    guide_cat_doc: "Docs",
    guide_cat_kids: "Kids",
    guide_cat_news: "News",
    guide_filter: "Filter",
    guide_filter_label: "Show in the guide",
    guide_slots_label: "What's on at",
    guide_slot_early: "Early evening",
    guide_slot_prime: "Prime time",
    guide_slot_late: "Late",
    guide_slot_custom: "Other time",
    guide_slot_custom_label: "Pick a time",

    // Timeline grid
    guide_region_label: "TV guide, arrow keys move between programmes",
    guide_cell_time: (p: { start: Date; end: Date }, f: F) =>
      `${f.time(p.start)} to ${f.time(p.end)}`,
    guide_state_live_now: "live now",
    guide_state_ended: "ended",
    guide_state_recording: "recording",
    guide_state_scheduled: "scheduled",
    guide_state_conflict: "conflict",
    guide_watch_channel_live: (p: { channel: string }) => `Watch ${p.channel} live`,
    guide_on_now: "On now",
    guide_on_at: (p: { time: Date }, f: F) => `On at ${f.time(p.time)}`,
    guide_until_left: (p: { end: Date; leftMinutes: number }, f: F) =>
      `until ${f.time(p.end)} · ${minutes(p.leftMinutes, f)} left`,
    guide_next_range: (p: { start: Date; end: Date }, f: F) =>
      `Next · ${f.timeRange(p.start, p.end)}`,
    guide_no_data: "No guide data",
    guide_record_title: (p: { title: string }) => `Record ${p.title}`,
    guide_watch_title: (p: { title: string }) => `Watch ${p.title}`,
    guide_day_empty: "No guide data for this day yet",
    guide_error_title: "Couldn't load the guide",

    // Programme sheet
    guide_badge_live_now: "Live now",
    guide_started_ago: (p: { agoMinutes: number; leftMinutes: number }, f: F) =>
      `Started ${minutes(p.agoMinutes, f)} ago · ${minutes(p.leftMinutes, f)} left`,
    guide_sheet_missing: "This programme is no longer in the guide",
    guide_options_failed: "Couldn't load the recording options for this programme.",
    guide_record_options: "Record options",
    guide_minutes: (p: { minutes: number }, f: F) => mins(p.minutes, f),
    guide_goes_automatic: (p: { group: string }) => `Automatic (${p.group})`,
    guide_scheduled_conflict: "Scheduled, but in conflict",
    guide_will_be_recorded: "Will be recorded",
    guide_recorded: "Recorded",
    guide_open_recording: "Open recording",
    guide_series_by: "by your series recording",
    guide_offer_line: (p: { count: number }, f: F) => `In ${f.number(p.count)} places`,
    guide_offer_open: "Group them…",
    guide_offer_title: (p: { name: string }) => `Group as “${p.name}”?`,
    guide_offer_failed: "Couldn't group them.",
    guide_padding: (p: { before: number; after: number }, f: F) =>
      `${mins(p.before, f)} early, ${mins(p.after, f)} after`,
    guide_applies_once_ends: (p: { end: Date }, f: F) => `Ends at ${f.time(p.end)}`,
    guide_stop_recording: "Stop recording",
    guide_conflict_title: (p: { start: Date; end: Date }, f: F) =>
      `Conflict ${f.timeRange(p.start, p.end)}`,
    guide_conflict_text: (p: { titles: readonly string[] }, f: F) =>
      `Conflicts with ${f.list(p.titles)}`,
    guide_record_repeat_instead: (p: { day: string; time: Date }, f: F) =>
      `Record the repeat instead (${p.day}, ${f.time(p.time)})`,
    guide_all_scheduled: "All scheduled",
    guide_everyone_title: "Already being recorded for everyone",
    guide_ended_not_recorded: "This programme has ended and wasn't recorded.",
    guide_skip_this: "Don't record",
    guide_series_options: "Series options",
    guide_recording_started: (p: { title: string }) => `Recording ${p.title}`,
    guide_recording_scheduled: (p: { title: string; start: Date }, f: F) =>
      `Will record ${p.title} at ${f.time(p.start)}`,
    guide_series_added: (p: { name: string; willRecord: string }) =>
      `Series recording added: ${p.name} · ${p.willRecord}`,
    guide_series_added_every: (p: { name: string; willRecord: string }) =>
      `Series recording added: every “${p.name}” · ${p.willRecord}`,
    guide_series_failed: "Couldn't add the series recording.",
    guide_had_recorded: (p: { day: string; time: Date; channel?: string }, f: F) =>
      `Already recorded ${p.day}, ${f.time(p.time)}${p.channel === undefined ? "" : ` on ${p.channel}`}`,
    guide_had_scheduled: (p: { day: string; time: Date; channel?: string }, f: F) =>
      `Already scheduled ${p.day}, ${f.time(p.time)}${p.channel === undefined ? "" : ` on ${p.channel}`}`,
    guide_had_deleted: (p: { day: string }) =>
      `You had this episode (recorded ${p.day}). It was deleted.`,
    guide_play_it: "Play it",
    guide_show_it: "Show it",
    guide_record_anyway: "Record anyway",
    guide_recording_anyway: (p: { title: string }) => `Recording ${p.title} anyway`,
    guide_state_had_recorded: "already recorded",
    guide_state_had_scheduled: "already scheduled",
    guide_skipped: (p: { title: string }) => `Won't record ${p.title}`,
    guide_stopped: (p: { title: string }) => `Stopped recording ${p.title}`,
    guide_action_failed: "That didn't work. Try again.",
    // Guide
    guide_now: (p: { now: Date }, f: F) => `Now ${f.time(p.now)}`,
    // Record options (TV long-press OK)
    record_this: "Record this programme",
    record_every: (p: { title: string }) => `Record every “${p.title}”`,
    record_remind: "Remind me instead",
    guide_key_hold_ok: "Hold OK",
    guide_hint_record: "Record & more",
    guide_channel_entry: (p: { digits: string }) => `Channel ${p.digits}`,
    record_padding_less: "Less",
    record_padding_more: "More",
    record_done_once: "Recording scheduled",
    record_series: "Record series",
    record_status_recorded: (p: { start: Date }, f: F) =>
      `Already recorded ${f.day(p.start)}, ${f.time(p.start)}`,
    record_status_recorded_on: (p: { start: Date; channel: string }, f: F) =>
      `Already recorded ${f.day(p.start)}, ${f.time(p.start)} on ${p.channel}`,
    record_status_scheduled: (p: { start: Date }, f: F) =>
      `Already scheduled ${f.day(p.start)}, ${f.time(p.start)}`,
    record_status_scheduled_on: (p: { start: Date; channel: string }, f: F) =>
      `Already scheduled ${f.day(p.start)}, ${f.time(p.start)} on ${p.channel}`,
    record_status_history: (p: { start: Date }, f: F) =>
      `You had this episode (recorded ${f.day(p.start)}). It was deleted.`,
    record_offer_not_now: "Not now",
    record_replaced: (p: { title: string; start: Date }, f: F) =>
      `${p.title} replaced by the repeat from ${f.day(p.start)}`,
    record_done_extra_time: "Extra time changed",
    record_done_remind: "You'll get a notice when it starts",
    record_starting: (p: { title: string }) => `Starting now: ${p.title}`,
    // Extra time around a recording (guide, record sheet, series editor, settings)
    padding_before: "Start early",
    padding_after: "End late",
  },
  de: {
    guide_day_next: "Nächster Tag",
    guide_day_previous: "Vorheriger Tag",
    guide_channel_rename_title: (p) => `${p.name} umbenennen`,
    guide_channel_hidden: (p) => `${p.name} ausgeblendet`,
    guide_channel_hide: "Sender ausblenden",
    guide_channel_logo: "Logo ändern…",
    guide_channel_rename: "Umbenennen…",
    padding_value: (p, f) =>
      `${minsDe(p.beforeMinutes, f)} früher · ${minsDe(p.afterMinutes, f)} später`,
    guide_every_broadcast: (p) => `Alle „${p.title}“`,
    guide_all_episodes: "Alle Folgen",
    guide_just_this: "Nur diese",
    guide_this_episode: "Diese Folge",
    guide_jump_now: "Jetzt",
    guide_empty: "Noch keine Programmdaten",
    guide_no_info: "Keine Programminformationen",
    guide_record_failed: "Konnte nicht geplant werden.",
    guide_skip: "Zum Programm springen",

    guide_view_label: "Ansicht",
    guide_view_timeline: "Zeitleiste",
    guide_view_channels: "Sender",
    guide_jump_prime_label: (p, f) => `Zu ${f.time(p.time)} springen`,
    guide_days_label: "Tag",
    guide_day_word: (p) => (p.day === "today" ? "Heute" : pillDayDe[p.day]),
    guide_day_pill: (p) => `${p.day === "today" ? "Heute" : pillDayDe[p.day]} ${p.date}`,
    guide_day_menu_label: (p) => `Tag: ${p.day}`,
    guide_day_in_sentence: (p) => (p.day === "today" ? "heute" : `${pillDayDe[p.day]} ${p.date}`),
    guide_categories_label: "Kategorie",
    guide_cat_all: "Alle",
    guide_cat_sport: "Sport",
    guide_cat_film: "Filme",
    guide_cat_crime: "Krimi",
    guide_cat_doc: "Doku",
    guide_cat_kids: "Kinder",
    guide_cat_news: "Nachrichten",
    guide_filter: "Filter",
    guide_filter_label: "Im Programm zeigen",
    guide_slots_label: "Was läuft um",
    guide_slot_early: "Vorabend",
    guide_slot_prime: "Hauptabend",
    guide_slot_late: "Spät",
    guide_slot_custom: "Andere Zeit",
    guide_slot_custom_label: "Uhrzeit wählen",

    guide_region_label: "Programm, Pfeiltasten wechseln zwischen Sendungen",
    guide_cell_time: (p, f) => `${f.time(p.start)} bis ${f.time(p.end)}`,
    guide_state_live_now: "läuft gerade",
    guide_state_ended: "vorbei",
    guide_state_recording: "wird aufgenommen",
    guide_state_scheduled: "geplant",
    guide_state_conflict: "Konflikt",
    guide_watch_channel_live: (p) => `${p.channel} live ansehen`,
    guide_on_now: "Läuft gerade",
    guide_on_at: (p, f) => `Läuft um ${f.time(p.time)}`,
    guide_until_left: (p, f) => `bis ${f.time(p.end)} · noch ${minutes(p.leftMinutes, f)}`,
    guide_next_range: (p, f) => `Danach · ${f.timeRange(p.start, p.end)}`,
    guide_no_data: "Keine Programmdaten",
    guide_record_title: (p) => `${p.title} aufnehmen`,
    guide_watch_title: (p) => `${p.title} ansehen`,
    guide_day_empty: "Für diesen Tag gibt es noch keine Programmdaten",
    guide_error_title: "Das Programm konnte nicht geladen werden",

    guide_badge_live_now: "Läuft gerade",
    guide_started_ago: (p, f) =>
      `Vor ${minutes(p.agoMinutes, f)} gestartet · noch ${minutes(p.leftMinutes, f)}`,
    guide_sheet_missing: "Diese Sendung ist nicht mehr im Programm",
    guide_options_failed: "Die Aufnahmeoptionen für diese Sendung konnten nicht geladen werden.",
    guide_record_options: "Aufnahmeoptionen",
    guide_minutes: (p, f) => minsDe(p.minutes, f),
    guide_goes_automatic: (p) => `Automatisch (${p.group})`,
    guide_scheduled_conflict: "Geplant, aber im Konflikt",
    guide_will_be_recorded: "Wird aufgenommen",
    guide_recorded: "Aufgenommen",
    guide_open_recording: "Aufnahme öffnen",
    guide_series_by: "durch deine Serienaufnahme",
    guide_offer_line: (p, f) => `An ${f.number(p.count)} Stellen`,
    guide_offer_open: "Zusammenfassen…",
    guide_offer_title: (p) => `Als „${p.name}“ zusammenfassen?`,
    guide_offer_failed: "Das Zusammenfassen hat nicht geklappt.",
    guide_padding: (p, f) => `${minsDe(p.before, f)} früher, ${minsDe(p.after, f)} länger`,
    guide_applies_once_ends: (p, f) => `Endet um ${f.time(p.end)}`,
    guide_stop_recording: "Aufnahme beenden",
    guide_conflict_title: (p, f) => `Konflikt ${f.timeRange(p.start, p.end)}`,
    guide_conflict_text: (p, f) => `Konflikt mit ${f.list(p.titles)}`,
    guide_record_repeat_instead: (p, f) =>
      `Stattdessen die Wiederholung aufnehmen (${p.day}, ${f.time(p.time)})`,
    guide_all_scheduled: "Alle geplanten",
    guide_everyone_title: "Wird schon für alle aufgenommen",
    guide_ended_not_recorded: "Diese Sendung ist vorbei und wurde nicht aufgenommen.",
    guide_skip_this: "Nicht aufnehmen",
    guide_series_options: "Serienaufnahme ändern",
    guide_recording_started: (p) => `${p.title} wird aufgenommen`,
    guide_recording_scheduled: (p, f) => `${p.title} wird um ${f.time(p.start)} aufgenommen`,
    guide_series_added: (p) => `Serienaufnahme angelegt: ${p.name} · ${p.willRecord}`,
    guide_series_added_every: (p) => `Serienaufnahme angelegt: immer „${p.name}“ · ${p.willRecord}`,
    guide_series_failed: "Die Serienaufnahme konnte nicht angelegt werden.",
    guide_had_recorded: (p, f) =>
      `Schon aufgenommen: ${p.day}, ${f.time(p.time)}${p.channel === undefined ? "" : ` auf ${p.channel}`}`,
    guide_had_scheduled: (p, f) =>
      `Schon geplant: ${p.day}, ${f.time(p.time)}${p.channel === undefined ? "" : ` auf ${p.channel}`}`,
    guide_had_deleted: (p) =>
      `Diese Folge hattest du schon (aufgenommen am ${p.day}). Sie wurde gelöscht.`,
    guide_play_it: "Abspielen",
    guide_show_it: "Anzeigen",
    guide_record_anyway: "Trotzdem aufnehmen",
    guide_recording_anyway: (p) => `${p.title} wird trotzdem aufgenommen`,
    guide_state_had_recorded: "schon aufgenommen",
    guide_state_had_scheduled: "schon geplant",
    guide_skipped: (p) => `${p.title} wird nicht aufgenommen`,
    guide_stopped: (p) => `Aufnahme von ${p.title} beendet`,
    guide_action_failed: "Das hat nicht geklappt. Versuch es noch einmal.",
    // Guide
    guide_now: (p, f) => `Jetzt ${f.time(p.now)}`,
    // Record options (TV long-press OK)
    record_this: "Diese Sendung aufnehmen",
    record_every: (p) => `Immer „${p.title}“ aufnehmen`,
    record_remind: "Stattdessen erinnern",
    guide_key_hold_ok: "OK halten",
    guide_hint_record: "Aufnehmen & mehr",
    guide_channel_entry: (p) => `Sender ${p.digits}`,
    record_padding_less: "Weniger",
    record_padding_more: "Mehr",
    record_done_once: "Aufnahme geplant",
    record_series: "Serie aufnehmen",
    record_status_recorded: (p, f) => `Schon aufgenommen: ${f.day(p.start)}, ${f.time(p.start)}`,
    record_status_recorded_on: (p, f) =>
      `Schon aufgenommen: ${f.day(p.start)}, ${f.time(p.start)} auf ${p.channel}`,
    record_status_scheduled: (p, f) => `Schon geplant: ${f.day(p.start)}, ${f.time(p.start)}`,
    record_status_scheduled_on: (p, f) =>
      `Schon geplant: ${f.day(p.start)}, ${f.time(p.start)} auf ${p.channel}`,
    record_status_history: (p, f) =>
      `Diese Folge hattest du schon (aufgenommen am ${f.day(p.start)}). Sie wurde gelöscht.`,
    record_offer_not_now: "Jetzt nicht",
    record_replaced: (p, f) => `${p.title} durch die Wiederholung vom ${f.day(p.start)} ersetzt`,
    record_done_extra_time: "Aufnahmezeit geändert",
    record_done_remind: "Du bekommst einen Hinweis, wenn es losgeht",
    record_starting: (p) => `Beginnt jetzt: ${p.title}`,
    // Extra time around a recording (guide, record sheet, series editor, settings)
    padding_before: "Früher beginnen",
    padding_after: "Später beenden",
  },
  samples: {
    guide_channel_rename_title: { name: "Sky Sport F1" },
    guide_channel_hidden: { name: "Sky Sport F1" },
    padding_value: { beforeMinutes: 2, afterMinutes: 10 },
    guide_every_broadcast: { title: "Live F1" },
    guide_jump_prime_label: { time: sampleEnd },
    guide_day_word: { day: "sun" },
    guide_day_pill: { day: "today", date: 22 },
    guide_day_menu_label: { day: "Sun 22" },
    guide_day_in_sentence: { day: "mon", date: 23 },
    guide_cell_time: { start: sampleStart, end: sampleEnd },
    guide_watch_channel_live: { channel: "Das Erste" },
    guide_on_at: { time: sampleEnd },
    guide_until_left: { end: sampleEnd, leftMinutes: 75 },
    guide_next_range: { start: sampleStart, end: sampleEnd },
    guide_record_title: { title: "Tatort" },
    guide_watch_title: { title: "Tatort" },
    guide_started_ago: { agoMinutes: 42, leftMinutes: 48 },
    guide_minutes: { minutes: 10 },
    guide_goes_automatic: { group: "Formel 1" },
    guide_offer_line: { count: 3 },
    guide_offer_title: { name: "Live F1" },
    guide_padding: { before: 2, after: 10 },
    guide_applies_once_ends: { end: sampleEnd },
    guide_conflict_title: { start: sampleStart, end: sampleEnd },
    guide_conflict_text: { titles: ["Tagesschau", "Terra X"] },
    guide_record_repeat_instead: { day: "Wed 25", time: sampleEnd },
    guide_recording_started: { title: "Tatort" },
    guide_recording_scheduled: { title: "Tatort", start: sampleEnd },
    guide_series_added: { name: "Tatort", willRecord: "4 will record" },
    guide_series_added_every: { name: "Live F1", willRecord: "12 will record" },
    guide_had_recorded: { day: "Sun 22", time: sampleStart, channel: "ONE" },
    guide_had_scheduled: { day: "Tue 24", time: sampleEnd },
    guide_had_deleted: { day: "Sun 22" },
    guide_recording_anyway: { title: "Tatort" },
    guide_skipped: { title: "Tatort" },
    guide_stopped: { title: "Tatort" },
    guide_now: { now: sampleStart },
    record_every: { title: "Rennen Kompakt" },
    guide_channel_entry: { digits: "12" },
    record_starting: { title: "Live F1: Rennen" },
    record_status_recorded: { start: sampleStart },
    record_status_recorded_on: { start: sampleStart, channel: "ONE" },
    record_status_scheduled: { start: sampleStart },
    record_status_scheduled_on: { start: sampleStart, channel: "ONE" },
    record_status_history: { start: sampleStart },
    record_replaced: { title: "Tatort", start: sampleStart },
  },
  sameInGerman: ["guide_minutes", "guide_cat_sport", "guide_filter"],
});
