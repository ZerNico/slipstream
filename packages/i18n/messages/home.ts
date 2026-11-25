/**
 * Messages for Home: the hero, Needs attention, the media rows and the server strip. English is the source; German follows each key. A key that takes
 * parameters needs a sample, so the catalogue test renders it in both languages.
 */
import type { Formatters } from "../src/format.ts";
import { defineArea, sampleEnd, sampleStart } from "./area.ts";

type F = Formatters;

/** The home area of the catalogue. */
export const home = defineArea({
  en: {
    home_join: (p: { parts: readonly string[] }) => p.parts.join(" · "),
    home_clock: (p: { start: Date }, f: F) => f.time(p.start),
    home_duration: (p: { seconds: number }, f: F) => f.duration(p.seconds),
    home_time_range: (p: { start: Date; end: Date }, f: F) => f.timeRange(p.start, p.end),
    // Hero: what the section is called for assistive tech, per state.
    home_hero_soon: "Recording soon",
    home_hero_idle: "All caught up",
    home_hero_welcome: "Welcome",
    // Hero badges.
    home_started_ago: (p: { seconds: number }, f: F) => `started ${f.duration(p.seconds)} ago`,
    home_title_onboarding: "Almost ready",
    home_title_idle: "You're all caught up",
    home_read_stopped_at: (p: { start: Date }, f: F) => `You stopped at ${f.time(p.start)}`,
    home_read_next_at: "Nothing recording. Next at",
    home_read_in: "in",
    home_read_new: (p: { seconds: number; start: Date }, f: F) =>
      `${f.duration(p.seconds)} · recorded ${f.day(p.start)}`,
    home_read_live: (p: { seconds: number; left: number }, f: F) =>
      `Started ${f.duration(p.seconds)} ago · ${f.duration(p.left)} left`,
    home_resume_at: (p: { start: Date }, f: F) => `Resume at ${f.time(p.start)}`,
    home_resume_short: (p: { time: string }) => `Resume ${p.time}`,
    home_watch_channel_now: (p: { channel: string }) => `Watch ${p.channel} now`,
    home_recording_options: "Recording options",
    home_programme_details: "Programme details",
    home_recording_details: "Recording details",
    home_record_series: "Record a series",
    home_add_source: "Add a source",
    // Switcher.
    home_switcher_label: (p: { count: number }, f: F) => `Recording now · ${f.number(p.count)}`,
    home_switcher_since: (p: { start: Date }, f: F) => `since ${f.time(p.start)}`,
    home_switcher_tab: (p: { title: string; channel: string; start: Date; owner: string }, f: F) =>
      `${p.title}, ${p.channel}, since ${f.time(p.start)}, ${p.owner}`,
    // Needs attention.
    home_needs_attention: "Needs attention",
    home_all_problems: "All problems",
    home_more_problems: (p: { count: number }, f: F) =>
      f.plural(p.count, { one: "# more problem", other: "# more problems" }),
    home_issue_no_picture: (p: { retries: number }, f: F) =>
      f.plural(p.retries, {
        zero: "The source sent no picture for the whole slot.",
        one: "The source sent no picture for the whole slot. Slipstream retried once.",
        other: "The source sent no picture for the whole slot. Slipstream retried # times.",
      }),
    home_issue_failed_limit: "Every stream of the source was busy, so nothing was captured.",
    home_issue_cause_unreachable: "The source couldn't be reached.",
    home_issue_cause_limit: "Every stream of the source was busy.",
    home_issue_missing: (p: { seconds: number; places: number }, f: F) =>
      f.plural(p.places, {
        one: `Missing ${f.duration(p.seconds)}.`,
        other: `Missing ${f.duration(p.seconds)} in # places.`,
      }),
    home_issue_conflict_today: (p: { start: Date }, f: F) => `Conflict today at ${f.time(p.start)}`,
    home_issue_conflict_tomorrow: (p: { start: Date }, f: F) =>
      `Conflict tomorrow at ${f.time(p.start)}`,
    home_issue_conflict_later: (p: { start: Date }, f: F) => `Conflict ${f.weekdayTime(p.start)}`,
    home_issue_conflict_text: (
      p: { count: number; start: Date; end: Date; limit: number; titles: readonly string[] },
      f: F,
    ) =>
      `${f.number(p.count)} recordings overlap ${f.timeRange(p.start, p.end)}, but only ${f.number(p.limit)} can record at once: ${f.list(p.titles)}.`,
    home_issue_conflict_text_free: (
      p: { count: number; start: Date; end: Date; free: number; titles: readonly string[] },
      f: F,
    ) =>
      `${f.number(p.count)} recordings overlap ${f.timeRange(p.start, p.end)}, but ${f.plural(p.free, { zero: "no stream is free then", one: "only # stream is free then", other: "only # streams are free then" })}: ${f.list(p.titles)}.`,
    home_issue_conflict_text_plain: (
      p: { count: number; start: Date; end: Date; titles: readonly string[] },
      f: F,
    ) =>
      `${f.number(p.count)} recordings overlap ${f.timeRange(p.start, p.end)} and not all of them can record: ${f.list(p.titles)}.`,
    home_issue_source: (p: { name: string }) => `Source “${p.name}” is unreachable`,
    home_issue_source_limit: (p: { name: string }) => `Source “${p.name}” is at its stream limit`,
    home_issue_resolve: "Resolve",
    home_issue_dismissed: (p: { title: string }) => `Dismissed: ${p.title}`,
    home_issue_gaps_title: (p: { title: string }) => `${p.title} had gaps`,
    home_issue_rerun_scheduled: (p: { day: string; start: Date }, f: F) =>
      `Recording the repeat ${p.day}, ${f.time(p.start)} instead`,
    home_row_scheduled: "Scheduled recordings",
    home_row_new: "New in your library",
    home_card_left: (p: { channel: string; seconds: number }, f: F) =>
      `${p.channel} · ${f.duration(p.seconds)} left`,
    home_card_slot: (p: { channel: string; start: Date; end: Date }, f: F) =>
      `${p.channel} · ${f.timeRange(p.start, p.end)}`,
    home_card_day: (p: { channel: string; start: Date }, f: F) =>
      `${p.channel} · ${f.day(p.start)}`,
    home_card_series: (p: { channel: string; name: string }) =>
      `${p.channel} · Series recording: ${p.name}`,
    home_card_by_hand: (p: { channel: string }) => `${p.channel} · Recorded by hand`,
    home_card_live_label: (p: { channel: string; title: string }) =>
      `Watch live: ${p.channel}, ${p.title}`,
    home_card_recording_label: (p: { channel: string; title: string }) =>
      `Recording now: ${p.channel}, ${p.title}`,
    home_card_scheduled_label: (p: { title: string; when: string }) =>
      `Scheduled: ${p.title}, ${p.when}`,
    // Templates (onboarding).
    home_error_title: "Home couldn't load",
    home_nothing_recording: "Nothing is recording right now",
    home_next_recording: (p: { start: Date }, f: F) => `Next recording · ${f.weekdayTime(p.start)}`,
  },
  de: {
    home_join: (p) => p.parts.join(" · "),
    home_clock: (p, f) => f.time(p.start),
    home_duration: (p, f) => f.duration(p.seconds),
    home_time_range: (p, f) => f.timeRange(p.start, p.end),
    home_hero_soon: "Aufnahme beginnt bald",
    home_hero_idle: "Alles gesehen",
    home_hero_welcome: "Willkommen",
    home_started_ago: (p, f) => `vor ${f.duration(p.seconds)} gestartet`,
    home_title_onboarding: "Fast fertig",
    home_title_idle: "Du bist auf dem Laufenden",
    home_read_stopped_at: (p, f) => `Du hast um ${f.time(p.start)} aufgehört`,
    home_read_next_at: "Gerade keine Aufnahme. Als Nächstes um",
    home_read_in: "in",
    home_read_new: (p, f) => `${f.duration(p.seconds)} · aufgenommen ${f.day(p.start)}`,
    home_read_live: (p, f) => `Vor ${f.duration(p.seconds)} gestartet · noch ${f.duration(p.left)}`,
    home_resume_at: (p, f) => `Weiter ab ${f.time(p.start)}`,
    home_resume_short: (p) => `Weiter ${p.time}`,
    home_watch_channel_now: (p) => `${p.channel} jetzt ansehen`,
    home_recording_options: "Aufnahmeoptionen",
    home_programme_details: "Sendungsdetails",
    home_recording_details: "Aufnahmedetails",
    home_record_series: "Serie aufnehmen",
    home_add_source: "Quelle hinzufügen",
    home_switcher_label: (p, f) => `Nimmt gerade auf · ${f.number(p.count)}`,
    home_switcher_since: (p, f) => `seit ${f.time(p.start)}`,
    home_switcher_tab: (p, f) => `${p.title}, ${p.channel}, seit ${f.time(p.start)}, ${p.owner}`,
    home_needs_attention: "Zu erledigen",
    home_all_problems: "Alle Probleme",
    home_more_problems: (p, f) =>
      f.plural(p.count, { one: "# weiteres Problem", other: "# weitere Probleme" }),
    home_issue_no_picture: (p, f) =>
      f.plural(p.retries, {
        zero: "Die Quelle hat für die ganze Sendung kein Bild geliefert.",
        one: "Die Quelle hat für die ganze Sendung kein Bild geliefert. Slipstream hat es einmal erneut versucht.",
        other:
          "Die Quelle hat für die ganze Sendung kein Bild geliefert. Slipstream hat es #-mal erneut versucht.",
      }),
    home_issue_failed_limit:
      "Alle Streams der Quelle waren belegt, deshalb wurde nichts aufgenommen.",
    home_issue_cause_unreachable: "Die Quelle war nicht erreichbar.",
    home_issue_cause_limit: "Alle Streams der Quelle waren belegt.",
    home_issue_missing: (p, f) =>
      f.plural(p.places, {
        // The German units end in an abbreviation's full stop ("30 Min."), which ends the sentence.
        one: `Es fehlen ${f.duration(p.seconds)}`,
        other: `Es fehlen ${f.duration(p.seconds)} an # Stellen.`,
      }),
    home_issue_conflict_today: (p, f) => `Konflikt heute um ${f.time(p.start)}`,
    home_issue_conflict_tomorrow: (p, f) => `Konflikt morgen um ${f.time(p.start)}`,
    home_issue_conflict_later: (p, f) => `Konflikt ${f.weekdayTime(p.start)}`,
    home_issue_conflict_text: (p, f) =>
      `${f.number(p.count)} Aufnahmen überschneiden sich ${f.timeRange(p.start, p.end)}, aber nur ${f.number(p.limit)} können gleichzeitig aufnehmen: ${f.list(p.titles)}.`,
    home_issue_conflict_text_free: (p, f) =>
      `${f.number(p.count)} Aufnahmen überschneiden sich ${f.timeRange(p.start, p.end)}, aber ${f.plural(p.free, { zero: "dann ist kein Stream frei", one: "dann ist nur # Stream frei", other: "dann sind nur # Streams frei" })}: ${f.list(p.titles)}.`,
    home_issue_conflict_text_plain: (p, f) =>
      `${f.number(p.count)} Aufnahmen überschneiden sich ${f.timeRange(p.start, p.end)} und nicht alle können aufnehmen: ${f.list(p.titles)}.`,
    home_issue_source: (p) => `Quelle „${p.name}“ ist nicht erreichbar`,
    home_issue_source_limit: (p) => `Quelle „${p.name}“ ist an ihrem Stream-Limit`,
    home_issue_resolve: "Lösen",
    home_issue_dismissed: (p) => `Ausgeblendet: ${p.title}`,
    home_issue_gaps_title: (p) => `${p.title} ist lückenhaft`,
    home_issue_rerun_scheduled: (p, f) =>
      `Stattdessen wird die Wiederholung am ${p.day}, ${f.time(p.start)} aufgenommen`,
    home_row_scheduled: "Geplante Aufnahmen",
    home_row_new: "Neu in deiner Bibliothek",
    home_card_left: (p, f) => `${p.channel} · noch ${f.duration(p.seconds)}`,
    home_card_slot: (p, f) => `${p.channel} · ${f.timeRange(p.start, p.end)}`,
    home_card_day: (p, f) => `${p.channel} · ${f.day(p.start)}`,
    home_card_series: (p) => `${p.channel} · Serienaufnahme: ${p.name}`,
    home_card_by_hand: (p) => `${p.channel} · Von Hand aufgenommen`,
    home_card_live_label: (p) => `Live ansehen: ${p.channel}, ${p.title}`,
    home_card_recording_label: (p) => `Nimmt gerade auf: ${p.channel}, ${p.title}`,
    home_card_scheduled_label: (p) => `Geplant: ${p.title}, ${p.when}`,
    home_error_title: "Home konnte nicht laden",
    home_nothing_recording: "Gerade läuft keine Aufnahme",
    home_next_recording: (p, f) => `Nächste Aufnahme · ${f.weekdayTime(p.start)}`,
  },
  samples: {
    home_join: { parts: ["Formel 1", "GP Katar", "started 42 min ago"] },
    home_clock: { start: sampleStart },
    home_duration: { seconds: 43 * 60 },
    home_time_range: { start: sampleStart, end: sampleEnd },
    home_started_ago: { seconds: 42 * 60 },
    home_read_stopped_at: { start: sampleStart },
    home_read_new: { seconds: 90 * 60, start: sampleStart },
    home_read_live: { seconds: 32 * 60, left: 48 * 60 },
    home_resume_at: { start: sampleStart },
    home_resume_short: { time: "18:11" },
    home_watch_channel_now: { channel: "ZDF" },
    home_switcher_label: { count: 2 },
    home_switcher_since: { start: sampleStart },
    home_switcher_tab: {
      title: "Qualifying",
      channel: "Sky Sport F1",
      start: sampleStart,
      owner: "Jonas",
    },
    home_more_problems: { count: 3 },
    home_issue_no_picture: { retries: 3 },
    home_issue_missing: { seconds: 5100, places: 3 },
    home_issue_conflict_today: { start: sampleStart },
    home_issue_conflict_tomorrow: { start: sampleStart },
    home_issue_conflict_later: { start: sampleStart },
    home_issue_conflict_text: {
      count: 3,
      start: sampleStart,
      end: sampleEnd,
      limit: 2,
      titles: ["Live F1: Rennen", "Terra X", "Tagesschau"],
    },
    home_issue_conflict_text_free: {
      count: 3,
      start: sampleStart,
      end: sampleEnd,
      free: 1,
      titles: ["Live F1: Rennen", "Terra X", "Tagesschau"],
    },
    home_issue_conflict_text_plain: {
      count: 2,
      start: sampleStart,
      end: sampleEnd,
      titles: ["Darts: Grand Slam - Finale", "Live F1: Rennen"],
    },
    home_issue_source: { name: "Xtream backup" },
    home_issue_source_limit: { name: "tvproxy" },
    home_issue_dismissed: { title: "Tatort failed" },
    home_issue_gaps_title: { title: "Tatort" },
    home_issue_rerun_scheduled: { day: "Wed 25", start: sampleStart },
    home_card_left: { channel: "ZDF", seconds: 27 * 60 },
    home_card_slot: { channel: "Das Erste", start: sampleStart, end: sampleEnd },
    home_card_day: { channel: "Das Erste", start: sampleStart },
    home_card_series: { channel: "ZDF", name: "Terra X" },

    home_card_by_hand: { channel: "arte" },
    home_card_live_label: { channel: "Das Erste", title: "Sportschau" },
    home_card_recording_label: { channel: "Sky Sport F1", title: "Qualifying" },
    home_card_scheduled_label: { title: "Terra X", when: "Today 19:25" },
    home_next_recording: { start: sampleStart },
  },
  sameInGerman: [
    "home_join",
    "home_clock",
    "home_duration",
    "home_time_range",
    "home_read_in",
    "home_card_slot",
  ],
});
