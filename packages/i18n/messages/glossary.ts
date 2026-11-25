/**
 * How German says the words Slipstream uses for the same concept everywhere. A new key follows
 * it; the catalogue test holds every message to it: a message whose whole English text is a
 * term says the German term, and no German text uses a word the glossary avoids.
 *
 * Typography: German puts no space before an ellipsis ("Hinzufügen…", "Umbenennen…"), like the
 * menus it is used in, and quotes „so“.
 */

/** One concept: its English, its German, and German variants not to use. */
export interface GlossaryTerm {
  readonly en: string;
  readonly de: string;
  /** Words that must not appear in any German text (other phrasings of the same concept). */
  readonly avoid?: readonly string[];
  /** Where the term needs a word on how to use it. */
  readonly note?: string;
}

/** The glossary, English to German. */
export const glossary: readonly GlossaryTerm[] = [
  {
    en: "Guide",
    de: "Programm",
    avoid: ["Programmführer"],
    note: "The screen. What a source delivers for it is „Programmdaten“.",
  },
  { en: "Open the guide", de: "Zum Programm" },
  { en: "On now", de: "Läuft gerade", avoid: ["Läuft jetzt", "läuft jetzt"] },
  { en: "Live now", de: "Läuft gerade" },
  {
    en: "Recording now",
    de: "Nimmt gerade auf",
    note: "Said of Slipstream. Said of a named programme: „wird gerade aufgenommen“.",
  },
  {
    en: "Try again",
    de: "Erneut versuchen",
    avoid: ["Versuche es erneut", "Versuch es wieder", "Noch einmal versuchen"],
    note: "Inside a sentence: „Versuch es noch einmal.“",
  },
  { en: "Revoke", de: "Widerrufen", avoid: ["zurückzieh", "zurückgezogen"] },
  { en: "Admin", de: "Admin", avoid: ["Verwaltung"] },
  { en: "Rec", de: "Aufn." },
  { en: "Add…", de: "Hinzufügen…", avoid: [" …"] },
  { en: "Season", de: "Staffel", avoid: ["Saison"] },
  { en: "Start early", de: "Früher beginnen" },
  { en: "End late", de: "Später beenden" },
  { en: "This device", de: "Dieses Gerät" },
  {
    en: "Server",
    de: "Server",
    avoid: ["Haushalt"],
    note: "Where settings that apply to every profile live (quality defaults, recording, sources).",
  },
  {
    en: "Default",
    de: "Standard",
    note: "A device's quality that follows the server's default quality („Standardqualität“).",
  },
];
