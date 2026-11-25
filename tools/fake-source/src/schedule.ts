import type { FakeChannel, ScheduleKind } from "./channels.ts";
import { addDays, dayNumber, type LocalDate, localDateOf, zonedInstant } from "./time.ts";

/** Season and episode, 1-based. */
export interface EpisodeNumber {
  readonly season: number;
  readonly episode: number;
  readonly episodes: number;
}

/** One guide entry, the shape XMLTV `<programme>` carries. */
export interface Programme {
  readonly channelId: string;
  readonly start: Date;
  readonly stop: Date;
  readonly title: string;
  readonly subTitle?: string;
  readonly description: string;
  readonly categories: ReadonlyArray<string>;
  readonly episode?: EpisodeNumber;
  readonly year?: number;
  readonly country?: string;
  readonly director?: string;
  readonly actors?: ReadonlyArray<string>;
  /** FSK age rating. */
  readonly rating?: number;
  readonly previouslyShown?: boolean;
}

/** A programme as a day template lists it: local start time, everything but the end. */
type Slot = Omit<Programme, "channelId" | "start" | "stop"> & { readonly at: string };

const minutesOf = (at: string) => {
  const [hours = "0", minutes = "0"] = at.split(":");
  return Number(hours) * 60 + Number(minutes);
};

const hhmm = (minuteOfDay: number) =>
  `${String(Math.floor(minuteOfDay / 60)).padStart(2, "0")}:${String(minuteOfDay % 60).padStart(2, "0")}`;

/** Picks deterministically from a list: the same seed always gives the same entry. */
const pick = <A>(list: ReadonlyArray<A>, seed: number): A => {
  const entry = list[((seed % list.length) + list.length) % list.length];
  if (entry === undefined) throw new Error("pick from an empty list");
  return entry;
};

const GP = "GP Katar";
const motorsport = ["Sport", "Motorsport"];

const f1Live = (at: string, session: string, description: string): Slot => ({
  at,
  title: `Live F1: ${session} - ${GP}`,
  description,
  categories: motorsport,
});

const f1 = (at: string, show: string, description: string, previouslyShown = false): Slot => ({
  at,
  title: `F1: ${show} - ${GP}`,
  description,
  categories: motorsport,
  previouslyShown,
});

/**
 * The same evening's replay of a live session, marked "(Wh.)" in the title as German guides do:
 * the recording model's repeat of the live broadcast (recording model §4.3).
 */
const f1Replay = (at: string, show: string, description: string): Slot => ({
  at,
  title: `F1: ${show} - ${GP} (Wh.)`,
  description,
  categories: motorsport,
  previouslyShown: true,
});

const magazine = (at: string): Slot => ({
  at,
  title: "F1: Das Magazin",
  description: "Hintergründe, Technik und Interviews aus dem Fahrerlager.",
  categories: motorsport,
  previouslyShown: true,
});

/**
 * A race weekend on a loop of three days (by day number, so any 48 hours include live sessions):
 * training day, qualifying day, race day.
 */
const f1Day = (n: number): ReadonlyArray<Slot> => {
  switch (((n % 3) + 3) % 3) {
    case 0:
      return [
        magazine("00:00"),
        f1("06:00", "Rennen Kompakt", "Die Höhepunkte des letzten Rennens.", true),
        f1Live("12:30", "Vorberichte", "Alle Infos vor dem ersten Training."),
        f1Live("13:30", "1. Freies Training", "Das erste freie Training aus Lusail."),
        f1("14:45", "Pressekonferenz Fahrer", "Die Fahrer stellen sich den Fragen der Presse."),
        f1Live("16:45", "2. Freies Training", "Das zweite freie Training unter Flutlicht."),
        f1("18:00", "Training Kompakt", "Die Trainings des Tages in 45 Minuten."),
        f1("20:00", "1. Freies Training", "Das erste freie Training in voller Länge.", true),
        magazine("22:00"),
      ];
    case 1:
      return [
        f1("00:00", "2. Freies Training", "Das zweite freie Training in voller Länge.", true),
        magazine("03:00"),
        f1Live("12:30", "3. Freies Training", "Das letzte Training vor dem Qualifying."),
        f1("13:45", "Training Kompakt", "Das dritte Training in 30 Minuten."),
        f1Live("15:00", "Vorberichte Qualifying", "Die Lage vor dem Kampf um die Pole."),
        f1Live("16:00", "Qualifying", "Q1, Q2 und Q3: der Kampf um die Pole-Position."),
        f1("17:15", "Pressekonferenz Qualifying", "Die drei Schnellsten im Gespräch."),
        f1("17:45", "Qualifying Kompakt", "Das Qualifying in 30 Minuten."),
        f1("20:00", "Qualifying", "Das Qualifying in voller Länge.", true),
        magazine("22:00"),
      ];
    default:
      return [
        f1("00:00", "Qualifying Kompakt", "Das Qualifying in 30 Minuten.", true),
        magazine("02:00"),
        f1Live("14:30", "Vorberichte Rennen", "Startaufstellung, Strategien und Wetter."),
        f1Live("16:00", "Rennen", "Das Rennen über 57 Runden."),
        f1Live("18:00", "Nachberichte", "Stimmen und Analysen nach dem Rennen."),
        f1("18:45", "Pressekonferenz Rennen", "Die drei Erstplatzierten im Gespräch."),
        f1("19:15", "Rennen Kompakt", "Die Höhepunkte des Rennens."),
        f1Replay("20:00", "Rennen", "Das Rennen über 57 Runden."),
        f1("22:30", "Rennen Kompakt", "Die Höhepunkte des Rennens.", true),
      ];
  }
};

const newsMagazines = [
  ["Wirtschaft kompakt", "Märkte, Unternehmen und Verbraucher."],
  ["Reportage: Leben am Hafen", "Ein Tag mit den Menschen im Hamburger Hafen."],
  ["Politik im Gespräch", "Interviews mit Gästen aus Bund und Ländern."],
  ["Sport aktuell", "Ergebnisse und Berichte aus der Welt des Sports."],
  ["Wissen und Technik", "Neues aus Forschung und Entwicklung."],
] as const;

/** Every hour: news, weather, then a rotating magazine. */
const newsDay = (n: number): ReadonlyArray<Slot> =>
  Array.from({ length: 24 }, (_, hour): ReadonlyArray<Slot> => {
    const [title, description] = pick(newsMagazines, n * 24 + hour);
    return [
      {
        at: hhmm(hour * 60),
        title: hour === 20 ? "Nachrichten am Abend" : "Nachrichten",
        description: "Die wichtigsten Meldungen des Tages.",
        categories: ["Nachrichten"],
      },
      {
        at: hhmm(hour * 60 + 15),
        title: "Wetter",
        description: "Das Wetter für Deutschland.",
        categories: ["Nachrichten", "Wetter"],
      },
      { at: hhmm(hour * 60 + 20), title, description, categories: ["Magazin"] },
    ];
  }).flat();

const series = [
  {
    title: "Die Küstenwache",
    genre: "Krimiserie",
    seasons: 6,
    episodes: 13,
    episodeTitles: ["Sturmflut", "Falsche Flagge", "Nebel über Sylt", "Der Lotse", "Ebbe"],
  },
  {
    title: "Hotel am See",
    genre: "Familienserie",
    seasons: 4,
    episodes: 10,
    episodeTitles: ["Neue Gäste", "Hochzeitspläne", "Das Erbe", "Sommerfest", "Abschied"],
  },
  {
    title: "Kommissar Brandt",
    genre: "Krimiserie",
    seasons: 9,
    episodes: 8,
    episodeTitles: ["Tod am Kanal", "Die stille Zeugin", "Kaltes Herz", "Spurlos", "Blutsbande"],
  },
  {
    title: "Praxis Dr. Lindner",
    genre: "Arztserie",
    seasons: 3,
    episodes: 12,
    episodeTitles: ["Notfall", "Zweite Meinung", "Diagnose", "Hausbesuch", "Nachtdienst"],
  },
] as const;

/** When the series channel's episodes start, back to back through the day. */
const seriesTimes = [
  "00:00",
  "00:50",
  "01:40",
  "05:30",
  "06:20",
  "07:10",
  "08:00",
  "09:00",
  "10:00",
  "11:00",
  "12:00",
  "13:00",
  "14:00",
  "15:00",
  "16:00",
  "17:00",
  "18:00",
  "19:05",
  "20:15",
  "21:15",
  "22:15",
  "23:10",
];

/** The series episode in one slot of a day on the series channel. */
const seriesEpisode = (n: number, slot: number): Omit<Slot, "at"> => {
  const show = pick(series, slot);
  const count = n * 2 + Math.floor(slot / series.length);
  const season = (Math.floor(count / show.episodes) % show.seasons) + 1;
  const episode = (count % show.episodes) + 1;
  return {
    title: show.title,
    subTitle: pick(show.episodeTitles, count),
    description: `${show.title}, Staffel ${season}, Folge ${episode}.`,
    categories: ["Serie", show.genre],
    episode: { season, episode, episodes: show.episodes },
    rating: show.genre === "Krimiserie" ? 12 : 6,
    previouslyShown: slot < 3,
  };
};

/** The slot of the series channel's prime-time episode (20:15). */
const primeTimeSlot = seriesTimes.indexOf("20:15");

/** Back-to-back series episodes; episode numbers advance with the day so reruns are rare. */
const seriesDay = (n: number): ReadonlyArray<Slot> =>
  seriesTimes.map((at, slot): Slot => ({ at, ...seriesEpisode(n, slot) }));

/** Monday to Friday, by day number (1970-01-01 was a Thursday; 0 is Sunday, 6 Saturday). */
const isWeekday = (n: number) => {
  const weekday = (((n + 4) % 7) + 7) % 7;
  return weekday !== 0 && weekday !== 6;
};

const landesschauTopics = [
  "Heute: Hochwasser an der Mosel und ein Dorf, das zusammenhält.",
  "Heute: Die letzte Dorfschmiede und ihr Meister.",
  "Heute: Weinlese im Steillagen-Weinberg.",
  "Heute: Ein Bahnhof wird zum Kulturzentrum.",
  "Heute: Imker im Stadtpark.",
  "Heute: Der Bürgermeister, der mit dem Rad zur Arbeit fährt.",
  "Heute: Ein Kino feiert hundert Jahre.",
] as const;

const films = [
  ["Das Haus am Fluss", "Drama", 1998, "Anna Weber", ["Klaus Brenner", "Marie Albers"], 12],
  ["Drei Tage Sonne", "Komödie", 2004, "Peter Lang", ["Sabine Roth", "Tom Ehlers"], 0],
  ["Der letzte Zug", "Thriller", 2011, "Jens Kühn", ["Lena Vogt", "Martin Hesse"], 16],
  ["Sommer in Ligurien", "Liebesfilm", 2016, "Clara Mertens", ["Julia Sander", "Luca Bianchi"], 6],
  ["Nordlicht", "Abenteuer", 1989, "Hans Ott", ["Erik Holm", "Ingrid Lund"], 12],
  ["Die Erfindung", "Komödie", 2020, "Mia Schulz", ["Felix Dorn", "Hanna Pohl"], 6],
  ["Schatten der Stadt", "Krimi", 1972, "Werner Falk", ["Karl Reimann", "Gisela Haas"], 16],
] as const;

/** Films at fixed times, the evening premiere at 20:15. */
const filmDay = (n: number): ReadonlyArray<Slot> => {
  const intro: Slot = {
    at: "00:00",
    title: "Kinomagazin",
    description: "Neu im Kino und neu im Programm.",
    categories: ["Magazin", "Film"],
  };
  const times = ["00:15", "02:05", "06:00", "08:00", "10:00", "12:00", "14:00", "16:00"];
  const slots = [...times, "18:00", "20:15", "22:10"].map((at, slot): Slot => {
    const [title, genre, year, director, actors, rating] = pick(films, n + slot);
    return {
      at,
      title,
      description: `${genre}, Deutschland ${year}. Regie: ${director}.`,
      categories: ["Spielfilm", genre],
      year,
      country: "D",
      director,
      actors,
      rating,
      previouslyShown: at !== "20:15",
    };
  });
  return [intro, ...slots];
};

const kidsShows = [
  ["Die Waldbande", "Abenteuer im Wald mit Fuchs, Igel und Eule."],
  ["Lumo und der Mond", "Eine Gute-Nacht-Geschichte zum Mitmachen."],
  ["Kleine Forscher", "Wie funktioniert eigentlich ein Regenbogen?"],
  ["Pip der Pinguin", "Pip entdeckt das Eis."],
] as const;

const offAir = (at: string): Slot => ({
  at,
  title: "Sendepause",
  description: "Kunterbunt ist ab 6 Uhr wieder für euch da.",
  categories: ["Sonstiges"],
});

/** Kids' shows from 06:00 to 20:00 every 25 minutes; off air (test card) overnight. */
const kidsDay = (n: number): ReadonlyArray<Slot> => {
  const shows = Array.from({ length: Math.floor((14 * 60) / 25) }, (_, slot): Slot => {
    const [title, description] = pick(kidsShows, slot);
    const count = n * 9 + Math.floor(slot / kidsShows.length);
    return {
      at: hhmm(6 * 60 + slot * 25),
      title,
      subTitle: `Folge ${(count % 52) + 1}`,
      description,
      categories: ["Kinder", "Zeichentrick"],
      episode: { season: 1, episode: (count % 52) + 1, episodes: 52 },
      rating: 0,
    };
  });
  return [offAir("00:00"), ...shows, offAir("20:00")];
};

const docs = [
  ["Die Alpen von oben", "Natur"],
  ["Geheimnisvolle Tiefsee", "Natur"],
  ["Das Römische Reich", "Geschichte"],
  ["Megastädte", "Gesellschaft"],
  ["Wüstenleben", "Natur"],
  ["Die Hanse", "Geschichte"],
] as const;

/** Hour-long documentaries around the clock. */
const docsDay = (n: number): ReadonlyArray<Slot> =>
  Array.from({ length: 24 }, (_, hour): Slot => {
    const [title, topic] = pick(docs, n * 5 + hour);
    return {
      at: hhmm(hour * 60),
      title,
      description: `Dokumentation über ${title.toLowerCase()}.`,
      categories: ["Dokumentation", topic],
      previouslyShown: hour < 18,
    };
  });

/**
 * A regional third-programme day. On weekdays the evening magazine carries the same sub-title
 * every day with a new topic in the description (a sub-title that identifies nothing), and late
 * at night it repeats yesterday's prime-time episode of the series channel: the same episode on
 * another channel within two days.
 */
const regionalDay = (n: number): ReadonlyArray<Slot> => [
  {
    at: "00:00",
    title: "Landesschau",
    description: "Wiederholung vom Vorabend.",
    categories: ["Magazin"],
    previouslyShown: true,
  },
  {
    at: "01:00",
    title: "Bilder aus der Region",
    description: "Landschaften mit Musik.",
    categories: ["Sonstiges"],
  },
  {
    at: "06:00",
    title: "Guten Morgen Region",
    description: "Das Frühstücksfernsehen.",
    categories: ["Magazin"],
  },
  {
    at: "09:00",
    title: "Heimatkrimi",
    subTitle: pick(["Mord am Weiher", "Das Schweigen im Dorf", "Kirmes"], n),
    description: "Krimi aus der Region.",
    categories: ["Spielfilm", "Krimi"],
    rating: 12,
    previouslyShown: true,
  },
  {
    at: "10:30",
    title: "Kochen mit Oma Gerda",
    description: "Heute: Rouladen.",
    categories: ["Ratgeber"],
  },
  {
    at: "11:15",
    title: "Bilder aus der Region",
    description: "Landschaften mit Musik.",
    categories: ["Sonstiges"],
  },
  {
    at: "18:00",
    title: "Regionalnachrichten",
    description: "Nachrichten aus dem Land.",
    categories: ["Nachrichten"],
  },
  isWeekday(n)
    ? {
        at: "18:15",
        title: "Landesschau",
        subTitle: "Das Magazin",
        description: pick(landesschauTopics, n),
        categories: ["Magazin"],
      }
    : {
        at: "18:15",
        title: "Bilder aus der Region",
        description: "Landschaften mit Musik.",
        categories: ["Sonstiges"],
      },
  {
    at: "19:30",
    title: "Regionalnachrichten",
    description: "Nachrichten aus dem Land.",
    categories: ["Nachrichten"],
  },
  {
    at: "20:00",
    title: "Nachrichten um acht",
    description: "Die Nachrichten.",
    categories: ["Nachrichten"],
  },
  {
    at: "20:15",
    title: "Unser Land",
    description: "Reportagen aus den Dörfern.",
    categories: ["Reportage"],
  },
  {
    at: "21:45",
    title: "Regionalnachrichten",
    description: "Nachrichten aus dem Land.",
    categories: ["Nachrichten"],
  },
  {
    at: "22:00",
    title: "Talk am Abend",
    description: "Gäste aus der Region.",
    categories: ["Talk"],
  },
  { at: "23:00", ...seriesEpisode(n - 1, primeTimeSlot), previouslyShown: true },
];

/** Two-minute programmes all day, named after their start time. */
const shortDay = (): ReadonlyArray<Slot> =>
  Array.from({ length: (24 * 60) / 2 }, (_, slot): Slot => {
    const at = hhmm(slot * 2);
    return {
      at,
      title: `Kurzsendung ${at}`,
      description: "Eine zwei Minuten lange Testsendung.",
      categories: ["Test"],
    };
  });

const templates: Record<ScheduleKind, (n: number) => ReadonlyArray<Slot>> = {
  f1: f1Day,
  news: newsDay,
  series: seriesDay,
  films: filmDay,
  kids: kidsDay,
  docs: docsDay,
  regional: regionalDay,
  short: shortDay,
};

/** A channel's programmes on one local calendar day, 00:00 to 24:00, back to back. */
const programmesOnDay = (
  channel: FakeChannel,
  date: LocalDate,
  timeZone: string,
): ReadonlyArray<Programme> => {
  const slots = templates[channel.schedule](dayNumber(date));
  return slots.map((slot, index): Programme => {
    const { at, ...rest } = slot;
    const next = slots[index + 1];
    return {
      ...rest,
      channelId: channel.tvgId,
      start: zonedInstant(date, minutesOf(at), timeZone),
      stop: next
        ? zonedInstant(date, minutesOf(next.at), timeZone)
        : zonedInstant(addDays(date, 1), 0, timeZone),
    };
  });
};

/**
 * Every programme of a channel that overlaps `[from, to)`. The schedule is a pure function of the
 * calendar day, so two requests (or a request and the stream overlay) always agree.
 */
export const programmesBetween = (
  channel: FakeChannel,
  from: Date,
  to: Date,
  timeZone: string,
): ReadonlyArray<Programme> => {
  const result: Array<Programme> = [];
  const last = dayNumber(localDateOf(to, timeZone));
  for (let date = localDateOf(from, timeZone); dayNumber(date) <= last; date = addDays(date, 1)) {
    for (const programme of programmesOnDay(channel, date, timeZone)) {
      if (programme.stop > from && programme.start < to) result.push(programme);
    }
  }
  return result;
};

/** The programme a channel airs at an instant. */
export const programmeAt = (
  channel: FakeChannel,
  at: Date,
  timeZone: string,
): Programme | undefined => programmesBetween(channel, at, new Date(at.getTime() + 1), timeZone)[0];
