import { ChannelId, RecordingId, UserId } from "../src/ids.ts";
import type { EpisodeContext, EpisodeRecording } from "../src/episode.ts";
import type { Programme } from "../src/programme.ts";
import { at, daserste, programme, skyF1, timeZone } from "./test-support.ts";

/** Fixtures for the episode identity tests (recording model §4.3). Not exported from the package. */

export const one = ChannelId.make("one");
export const wdr = ChannelId.make("wdr");
export const zdf = ChannelId.make("zdf");
export const arteChannel = ChannelId.make("arte");
export const kim = UserId.make("kim");
export const jonas = UserId.make("jonas");

export const channelNames: Record<string, string> = {
  [daserste]: "Das Erste",
  [one]: "ONE",
  [wdr]: "WDR",
  [zdf]: "ZDF",
  [skyF1]: "Sky Sport F1",
};

/** A programme's fields without its guide id, so a copy gets an id of its own. */
const copy = ({ id: _id, ...rest }: Programme): Omit<Programme, "id"> => rest;

export const context: EpisodeContext = {
  timeZone,
  channelName: (id) => channelNames[id],
};

/** A finished (or other) recording of a programme, owned by Kim unless told otherwise. */
export const recorded = (
  from: Programme,
  fields: Partial<EpisodeRecording> = {},
): EpisodeRecording & { readonly id: RecordingId } => {
  const { id, ...info } = from;
  return {
    ...info,
    programmeId: id,
    state: "completed",
    problems: [],
    padding: { beforeMinutes: 0, afterMinutes: 0 },
    ownerIds: [kim],
    ...fields,
    id: fields.id ?? RecordingId.make(`rec:${id}`),
  };
};

const tatortDescription =
  "Kommissar Faber ermittelt im Dortmunder Hafen, wo ein junger Mann tot aufgefunden wird. Die Spur führt zu einer Bande von Schmugglern.";
const otherDescription =
  "Ein Bankraub in Münster eskaliert, als Thiel und Boerne zufällig unter den Geiseln sind. Beide müssen improvisieren, um alle zu retten.";

/** Tatort 1247 "Unter Wölfen" on Das Erste, Sun 22, 20:15. */
export const tatortSunday = programme({
  channelId: daserste,
  title: "Tatort",
  subtitle: "Unter Wölfen",
  description: tatortDescription,
  categories: ["Krimi"],
  episode: { episode: 1247 },
  start: at("2026-11-22T19:15:00Z"),
  end: at("2026-11-22T20:45:00Z"),
});

/** The same episode on ONE, Tue 24, 20:15. */
export const tatortOnOne = programme({
  ...copy(tatortSunday),
  channelId: one,
  start: at("2026-11-24T19:15:00Z"),
  end: at("2026-11-24T20:45:00Z"),
});

/** The same sub-title on WDR, without numbers. */
export const tatortWdr = programme({
  channelId: wdr,
  title: "Tatort",
  subtitle: "Unter Wölfen",
  categories: ["Krimi"],
  start: at("2026-11-25T21:00:00Z"),
  end: at("2026-11-25T22:30:00Z"),
});

/** Categorised as a TV film, with a sub-title and no numbers. */
export const tatortFernsehfilm = programme({
  channelId: daserste,
  title: "Tatort",
  subtitle: "Unter Wölfen",
  categories: ["Fernsehfilm", "Spielfilm"],
  start: at("2026-11-29T19:15:00Z"),
  end: at("2026-11-29T20:45:00Z"),
});

/** The same sub-title on ONE, but a different story (word overlap well under half). */
const { episode: _numbers, ...tatortUnnumbered } = tatortOnOne;

export const tatortOtherStory = programme({
  ...copy(tatortUnnumbered),
  description: otherDescription,
  start: at("2026-11-26T19:15:00Z"),
  end: at("2026-11-26T20:45:00Z"),
});

/** Live F1: Rennen - GP Katar, live, Sun 29, 17:00 (2 h 30 min). */
export const raceLive = programme({
  channelId: skyF1,
  title: "Live F1: Rennen - GP Katar",
  subtitle: "Großer Preis von Katar",
  categories: ["Sport"],
  live: true,
  start: at("2026-11-29T16:00:00Z"),
  end: at("2026-11-29T18:30:00Z"),
});

/** The marked replay the same evening, 22:30, without a sub-title. */
export const raceReplay = programme({
  channelId: skyF1,
  title: "F1: Rennen - GP Katar (Wh.)",
  categories: ["Sport"],
  start: at("2026-11-29T21:30:00Z"),
  end: at("2026-11-29T23:30:00Z"),
});

/**
 * The unmarked replay next morning, 10:00, not live, 2 h 25 min, with the live airing's
 * sub-title: more than 12 hours after the race, so the equal sub-title is what identifies it.
 */
export const raceNextMorning = programme({
  channelId: skyF1,
  title: "F1: Rennen - GP Katar",
  subtitle: "Großer Preis von Katar",
  categories: ["Sport"],
  start: at("2026-11-30T09:00:00Z"),
  end: at("2026-11-30T11:25:00Z"),
});

/** An unmarked replay the same evening, 21:00, not live, without a sub-title (within 12 h). */
export const raceUnmarkedEvening = programme({
  channelId: skyF1,
  title: "F1: Rennen - GP Katar",
  categories: ["Sport"],
  start: at("2026-11-29T20:00:00Z"),
  end: at("2026-11-29T22:25:00Z"),
});

export const raceHighlights = programme({
  channelId: skyF1,
  title: "F1: Rennen Highlights - GP Katar",
  categories: ["Sport"],
  start: at("2026-11-30T12:00:00Z"),
  end: at("2026-11-30T12:30:00Z"),
});

export const raceNextYear = programme({
  ...copy(raceLive),
  start: at("2027-11-28T16:00:00Z"),
  end: at("2027-11-28T18:30:00Z"),
});

export const raceAbuDhabi = programme({
  ...copy(raceLive),
  title: "Live F1: Rennen - GP Abu Dhabi",
  subtitle: "Großer Preis von Abu Dhabi",
  start: at("2026-12-06T13:00:00Z"),
  end: at("2026-12-06T15:30:00Z"),
});

const tagesschau = (iso: string, fields: Partial<Programme> = {}): Programme =>
  programme({
    channelId: daserste,
    title: "Tagesschau",
    categories: ["Nachrichten"],
    start: at(iso),
    end: at(new Date(Date.parse(iso) + 15 * 60_000).toISOString()),
    ...fields,
  });

export const tagesschauYesterday = tagesschau("2026-11-21T19:00:00Z");
export const tagesschauToday = tagesschau("2026-11-22T19:00:00Z");
export const tagesschauLive = tagesschau("2026-11-22T19:00:00Z", { live: true });
export const tagesschauMidnight = tagesschau("2026-11-22T23:00:00Z");
export const tagesschauNoon = tagesschau("2026-11-22T11:00:00Z");

/** "Brisant" with the sub-title "Das Magazin" on five weekdays, each with its own description. */
export const brisant = [16, 17, 18, 19, 20].map((day) =>
  programme({
    channelId: daserste,
    title: "Brisant",
    subtitle: "Das Magazin",
    description: `Themen am ${day}. November: ein Bericht über ${day % 2 === 0 ? "Mieten" : "Bahnstreik"} und mehr.`,
    start: at(`2026-11-${day}T16:15:00Z`),
    end: at(`2026-11-${day}T17:00:00Z`),
  }),
);

export const lanz = programme({
  channelId: zdf,
  title: "Markus Lanz",
  categories: ["Talkshow"],
  start: at("2026-11-24T22:15:00Z"),
  end: at("2026-11-24T23:30:00Z"),
});

export const lanzRepeat = programme({
  ...copy(lanz),
  title: "Markus Lanz (Wdh.)",
  start: at("2026-11-25T02:00:00Z"),
  end: at("2026-11-25T03:15:00Z"),
});

export const pate = programme({
  channelId: arteChannel,
  title: "Der Pate",
  categories: ["Spielfilm"],
  originalAirDate: { year: 1972 },
  start: at("2026-11-20T19:15:00Z"),
  end: at("2026-11-20T22:05:00Z"),
});

export const pateAgain = programme({
  ...copy(pate),
  start: at("2026-11-27T19:15:00Z"),
  end: at("2026-11-27T22:05:00Z"),
});

const { originalAirDate: _year, ...pateUndated } = pateAgain;

export const pateNoYear = programme({
  ...copy(pateUndated),
  start: at("2026-11-28T19:15:00Z"),
  end: at("2026-11-28T22:05:00Z"),
});

export const sportschau = programme({
  channelId: daserste,
  title: "Sportschau",
  categories: ["Sport"],
  start: at("2026-11-28T17:00:00Z"),
  end: at("2026-11-28T18:50:00Z"),
});

export const sportschauLastWeek = programme({
  ...copy(sportschau),
  start: at("2026-11-21T17:00:00Z"),
  end: at("2026-11-21T18:50:00Z"),
});

/** Bundesliga live on Saturday, 15:30 (1 h 50 min), without a sub-title. */
export const bundesligaSaturday = programme({
  channelId: skyF1,
  title: "Bundesliga",
  categories: ["Sport"],
  live: true,
  start: at("2026-11-28T14:30:00Z"),
  end: at("2026-11-28T16:20:00Z"),
});

/**
 * Sunday's match at 15:30: the guide flags it neither live nor repeat and gives no sub-title.
 * The next day, not live and the same length, yet another match (must not match).
 */
export const bundesligaSunday = programme({
  channelId: skyF1,
  title: "Bundesliga",
  categories: ["Sport"],
  start: at("2026-11-29T14:30:00Z"),
  end: at("2026-11-29T16:20:00Z"),
});
