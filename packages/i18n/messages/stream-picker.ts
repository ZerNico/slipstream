/**
 * Messages for the stream picker: choosing which streams of a big playlist become channels
 * (web dialog, setup step, phone page), and the source's "Add new streams automatically".
 * English is the source; German follows each key. A key that takes parameters needs a sample.
 */
import type { Formatters } from "../src/format.ts";
import { defineArea } from "./area.ts";

type F = Formatters;

/** The stream picker area of the catalogue. */
export const streamPicker = defineArea({
  en: {
    picker_title: "Choose channels",
    picker_subtitle: (p: { source: string; streams: number; groups: number }, f: F) =>
      `${p.source} · ${f.plural(p.streams, { one: "# stream", other: "# streams" })} in ${f.plural(p.groups, { one: "# group", other: "# groups" })}`,
    picker_search: (p: { count: number }, f: F) =>
      f.plural(p.count, { one: "Search # stream", other: "Search # streams" }),
    picker_show: "Show",
    picker_show_all: "All",
    picker_show_selected: "Selected",
    picker_select_all: "Select all",
    picker_select_none: "Select none",
    picker_selected_of: (p: { selected: number; total: number }, f: F) =>
      `${f.number(p.selected)} of ${f.number(p.total)} selected`,
    picker_join_existing: (p: { count: number }, f: F) =>
      f.plural(p.count, {
        one: "# joins an existing channel",
        other: "# join existing channels",
      }),
    picker_add: (p: { count: number }, f: F) =>
      f.plural(p.count, { one: "Add # channel", other: "Add # channels" }),
    picker_add_to_existing: "Add to existing channels",
    picker_group_guide: (p: { percent: number }) => `${p.percent}% with guide`,
    picker_group_joins: (p: { count: number }, f: F) =>
      f.plural(p.count, { one: "# joins existing", other: "# join existing" }),
    picker_group_picked: (p: { picked: number; total: number }, f: F) =>
      `${f.number(p.picked)} of ${f.number(p.total)}`,
    picker_group_none: "Without a group",
    picker_group_open: (p: { name: string }) => `Show the streams of ${p.name}`,
    picker_group_close: (p: { name: string }) => `Hide the streams of ${p.name}`,
    picker_joins: (p: { name: string }) => `Joins ${p.name}`,
    picker_no_guide: "No guide",
    picker_added: "Added",
    picker_none_match: "No stream matches",
    picker_none_selected: "Nothing selected yet",
    picker_done: (p: { created: number; joined: number }, f: F) =>
      p.joined === 0
        ? f.plural(p.created, { one: "# channel added", other: "# channels added" })
        : `${f.plural(p.created, { one: "# channel added", other: "# channels added" })}, ${f.plural(p.joined, { one: "# stream joined an existing channel", other: "# streams joined existing channels" })}`,
    picker_new_streams: (p: { count: number }, f: F) =>
      f.plural(p.count, { one: "# new stream", other: "# new streams" }),
    picker_setup_text:
      "Groups in your language are ticked. Copies in HD and SD become one channel. You can change this any time in Settings.",
    picker_quality_uhd: "UHD",
    picker_quality_fhd: "FHD",
    picker_quality_hd: "HD",
    picker_quality_sd: "SD",
    source_auto_add: "Add new streams automatically",
    source_auto_add_hint: "New streams in groups you added become channels on the next refresh.",
  },
  de: {
    picker_title: "Sender auswählen",
    picker_subtitle: (p, f) =>
      `${p.source} · ${f.plural(p.streams, { one: "# Stream", other: "# Streams" })} in ${f.plural(p.groups, { one: "# Gruppe", other: "# Gruppen" })}`,
    picker_search: (p, f) =>
      f.plural(p.count, { one: "# Stream durchsuchen", other: "# Streams durchsuchen" }),
    picker_show: "Zeigen",
    picker_show_all: "Alle",
    picker_show_selected: "Ausgewählt",
    picker_select_all: "Alle auswählen",
    picker_select_none: "Keine auswählen",
    picker_selected_of: (p, f) => `${f.number(p.selected)} von ${f.number(p.total)} ausgewählt`,
    picker_join_existing: (p, f) =>
      f.plural(p.count, {
        one: "# kommt zu einem vorhandenen Sender",
        other: "# kommen zu vorhandenen Sendern",
      }),
    picker_add: (p, f) =>
      f.plural(p.count, { one: "# Sender hinzufügen", other: "# Sender hinzufügen" }),
    picker_add_to_existing: "Zu vorhandenen Sendern hinzufügen",
    picker_group_guide: (p) => `${p.percent} % mit Programmdaten`,
    picker_group_joins: (p, f) => `${f.number(p.count)} zu vorhandenen`,
    picker_group_picked: (p, f) => `${f.number(p.picked)} von ${f.number(p.total)}`,
    picker_group_none: "Ohne Gruppe",
    picker_group_open: (p) => `Streams von ${p.name} zeigen`,
    picker_group_close: (p) => `Streams von ${p.name} ausblenden`,
    picker_joins: (p) => `Kommt zu ${p.name}`,
    picker_no_guide: "Keine Programmdaten",
    picker_added: "Hinzugefügt",
    picker_none_match: "Kein Stream passt",
    picker_none_selected: "Noch nichts ausgewählt",
    picker_done: (p, f) =>
      p.joined === 0
        ? f.plural(p.created, { one: "# Sender hinzugefügt", other: "# Sender hinzugefügt" })
        : `${f.plural(p.created, { one: "# Sender hinzugefügt", other: "# Sender hinzugefügt" })}, ${f.plural(p.joined, { one: "# Stream kam zu einem vorhandenen Sender", other: "# Streams kamen zu vorhandenen Sendern" })}`,
    picker_new_streams: (p, f) =>
      f.plural(p.count, { one: "# neuer Stream", other: "# neue Streams" }),
    picker_setup_text:
      "Gruppen in deiner Sprache sind ausgewählt. Kopien in HD und SD werden ein Sender. Das kannst du jederzeit in den Einstellungen ändern.",
    picker_quality_uhd: "UHD",
    picker_quality_fhd: "FHD",
    picker_quality_hd: "HD",
    picker_quality_sd: "SD",
    source_auto_add: "Neue Streams automatisch hinzufügen",
    source_auto_add_hint:
      "Neue Streams in Gruppen, die du hinzugefügt hast, werden beim nächsten Aktualisieren zu Sendern.",
  },
  samples: {
    picker_subtitle: { source: "Sky Zuhause", streams: 4812, groups: 28 },
    picker_search: { count: 4812 },
    picker_selected_of: { selected: 1240, total: 4812 },
    picker_join_existing: { count: 54 },
    picker_add: { count: 1186 },
    picker_group_guide: { percent: 98 },
    picker_group_joins: { count: 36 },
    picker_group_picked: { picked: 40, total: 118 },
    picker_group_open: { name: "DE | Sport" },
    picker_group_close: { name: "DE | Sport" },
    picker_joins: { name: "Das Erste" },
    picker_done: { created: 1186, joined: 54 },
    picker_new_streams: { count: 3 },
  },
  sameInGerman: [
    "picker_quality_uhd",
    "picker_quality_fhd",
    "picker_quality_hd",
    "picker_quality_sd",
  ],
});
