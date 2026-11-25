/**
 * Messages for "Needs review" on Settings › Sources & channels (web and phone): channels that
 * look like one channel (merge or keep apart), new streams, streams a playlist dropped and
 * channels left without a stream, and adding a stream from any source to a channel. English is
 * the source; German follows each key. A key that takes parameters needs a sample.
 */
import type { Formatters } from "../src/format.ts";
import { defineArea } from "./area.ts";

type F = Formatters;

/** The review area of the catalogue. */
export const review = defineArea({
  en: {
    review_heading: "Needs review",
    review_open: "Review",
    review_merge_card: (p: { count: number; sources: number }, f: F) =>
      p.sources === 2
        ? f.plural(p.count, {
            one: "# channel in both sources",
            other: "# channels in both sources",
          })
        : f.plural(p.count, {
            one: "# channel in several sources",
            other: "# channels in several sources",
          }),
    review_merge_all: "Merge all",
    review_new_card: (p: { count: number }, f: F) =>
      f.plural(p.count, { one: "# new stream", other: "# new streams" }),
    review_ignore: "Ignore",
    review_gone_card: (p: { count: number }, f: F) =>
      f.plural(p.count, { one: "# stream gone", other: "# streams gone" }),
    review_no_stream_count: (p: { count: number }, f: F) =>
      f.plural(p.count, {
        one: "# channel has no stream",
        other: "# channels have no stream",
      }),
    review_merge_title: "Same channel in several sources",
    review_suggestions: (p: { count: number }, f: F) =>
      f.plural(p.count, { one: "# suggestion", other: "# suggestions" }),
    review_group_same_guide: "Same guide channel",
    review_group_similar: "Similar name",
    review_merge: "Merge",
    review_merge_count: (p: { count: number }, f: F) =>
      f.plural(p.count, { zero: "Merge", one: "Merge #", other: "Merge #" }),
    review_merge_named: (p: { name: string }) => `Merge into ${p.name}`,
    review_not_same: "Not the same",
    review_not_same_named: (p: { name: string }) => `${p.name}: not the same`,
    review_merged: "Merged",
    review_kept_apart: "Kept apart",
    review_moves: (p: { series: number; recordings: number; name: string }, f: F) => {
      const parts = [
        p.series === 0
          ? undefined
          : f.plural(p.series, { one: "# series recording", other: "# series recordings" }),
        p.recordings === 0
          ? undefined
          : f.plural(p.recordings, { one: "# recording", other: "# recordings" }),
      ].filter((part) => part !== undefined);
      if (parts.length === 0) return `The other streams become fallbacks of ${p.name}`;
      const one = p.series + p.recordings === 1;
      return `${f.list(parts)} ${one ? "moves" : "move"} to ${p.name}`;
    },
    review_gone_title: "Streams gone",
    review_gone_subtitle: (p: { count: number; sources: string }, f: F) =>
      `${f.plural(p.count, { one: "# stream", other: "# streams" })} · ${p.sources}`,
    review_no_stream_left: "No stream left",
    review_plays_from: (p: { source: string }) => `Plays from ${p.source}`,
    review_choose_stream: "Choose stream…",
    review_hide_named: (p: { name: string }) => `Hide ${p.name}`,
    review_hidden_named: (p: { name: string }) => `${p.name} is hidden`,
    review_all_done: "Nothing left to review",
    stream_add_from_source: "Add stream from another source…",
    stream_add_title: (p: { name: string }) => `Add stream to ${p.name}`,
    stream_add_search: "Search the streams of every source",
    stream_add_all_sources: "All sources",
    stream_add_sources: "Sources",
    stream_add: "Add",
    stream_add_named: (p: { name: string }) => `Add ${p.name}`,
    stream_move_here: "Move here",
    stream_move_here_named: (p: { name: string }) => `Move ${p.name} here`,
    stream_in_channel: (p: { name: string }) => `in ${p.name}`,
    stream_on_this_channel: "On this channel",
    stream_none_match: "No stream matches",
    stream_type_to_search: "Type a name to search",
    stream_added_named: (p: { stream: string; channel: string }) =>
      `${p.stream} added to ${p.channel}`,
    guide_none_option: "No guide",
    guide_none_hint: "The channel shows without programmes",
    guide_picker_now: (p: { title: string }) => `Now: ${p.title}`,
    picker_show_new: "New",
  },
  de: {
    review_heading: "Zu prüfen",
    review_open: "Prüfen",
    review_merge_card: (p, f) =>
      p.sources === 2
        ? f.plural(p.count, {
            one: "# Sender in beiden Quellen",
            other: "# Sender in beiden Quellen",
          })
        : f.plural(p.count, {
            one: "# Sender in mehreren Quellen",
            other: "# Sender in mehreren Quellen",
          }),
    review_merge_all: "Alle zusammenführen",
    review_new_card: (p, f) =>
      f.plural(p.count, { one: "# neuer Stream", other: "# neue Streams" }),
    review_ignore: "Ignorieren",
    review_gone_card: (p, f) =>
      f.plural(p.count, { one: "# Stream weggefallen", other: "# Streams weggefallen" }),
    review_no_stream_count: (p, f) =>
      f.plural(p.count, { one: "# Sender ohne Stream", other: "# Sender ohne Stream" }),
    review_merge_title: "Gleicher Sender in mehreren Quellen",
    review_suggestions: (p, f) => f.plural(p.count, { one: "# Vorschlag", other: "# Vorschläge" }),
    review_group_same_guide: "Gleicher Sender in den Programmdaten",
    review_group_similar: "Ähnlicher Name",
    review_merge: "Zusammenführen",
    review_merge_count: (p, f) =>
      f.plural(p.count, {
        zero: "Zusammenführen",
        one: "# zusammenführen",
        other: "# zusammenführen",
      }),
    review_merge_named: (p) => `Mit ${p.name} zusammenführen`,
    review_not_same: "Nicht derselbe",
    review_not_same_named: (p) => `${p.name}: nicht derselbe`,
    review_merged: "Zusammengeführt",
    review_kept_apart: "Getrennt gelassen",
    review_moves: (p, f) => {
      const parts = [
        p.series === 0
          ? undefined
          : f.plural(p.series, { one: "# Serienaufnahme", other: "# Serienaufnahmen" }),
        p.recordings === 0
          ? undefined
          : f.plural(p.recordings, { one: "# Aufnahme", other: "# Aufnahmen" }),
      ].filter((part) => part !== undefined);
      if (parts.length === 0) return `Die anderen Streams werden Ersatz für ${p.name}`;
      const one = p.series + p.recordings === 1;
      return `${f.list(parts)} ${one ? "wandert" : "wandern"} zu ${p.name}`;
    },
    review_gone_title: "Weggefallene Streams",
    review_gone_subtitle: (p, f) =>
      `${f.plural(p.count, { one: "# Stream", other: "# Streams" })} · ${p.sources}`,
    review_no_stream_left: "Kein Stream mehr",
    review_plays_from: (p) => `Läuft über ${p.source}`,
    review_choose_stream: "Stream wählen…",
    review_hide_named: (p) => `${p.name} ausblenden`,
    review_hidden_named: (p) => `${p.name} ist ausgeblendet`,
    review_all_done: "Nichts mehr zu prüfen",
    stream_add_from_source: "Stream aus einer anderen Quelle hinzufügen…",
    stream_add_title: (p) => `Stream zu ${p.name} hinzufügen`,
    stream_add_search: "Streams aller Quellen durchsuchen",
    stream_add_all_sources: "Alle Quellen",
    stream_add_sources: "Quellen",
    stream_add: "Hinzufügen",
    stream_add_named: (p) => `${p.name} hinzufügen`,
    stream_move_here: "Hierher verschieben",
    stream_move_here_named: (p) => `${p.name} hierher verschieben`,
    stream_in_channel: (p) => `in ${p.name}`,
    stream_on_this_channel: "Schon in diesem Sender",
    stream_none_match: "Kein Stream passt",
    stream_type_to_search: "Tippe einen Namen, um zu suchen",
    stream_added_named: (p) => `${p.stream} zu ${p.channel} hinzugefügt`,
    guide_none_option: "Ohne Programm",
    guide_none_hint: "Der Sender erscheint ohne Sendungen",
    guide_picker_now: (p) => `Jetzt: ${p.title}`,
    picker_show_new: "Neu",
  },
  samples: {
    review_merge_card: { count: 8, sources: 2 },
    review_new_card: { count: 14 },
    review_gone_card: { count: 3 },
    review_no_stream_count: { count: 1 },
    review_suggestions: { count: 8 },
    review_merge_count: { count: 6 },
    review_merge_named: { name: "ZDF" },
    review_not_same_named: { name: "SPORT1" },
    review_moves: { series: 2, recordings: 14, name: "ZDF" },
    review_gone_subtitle: { count: 3, sources: "IPTV Provider" },
    review_plays_from: { source: "Zattoo-Proxy" },
    review_hide_named: { name: "Comedy Central" },
    review_hidden_named: { name: "Comedy Central" },
    stream_add_title: { name: "kabel eins" },
    stream_add_named: { name: "DE: Kabel 1 FHD" },
    stream_move_here_named: { name: "kabel eins Doku HD" },
    stream_in_channel: { name: "kabel eins Doku" },
    stream_added_named: { stream: "DE: Kabel 1 FHD", channel: "kabel eins" },
    guide_picker_now: { title: "Tagesschau" },
  },
  sameInGerman: ["stream_in_channel"],
});
