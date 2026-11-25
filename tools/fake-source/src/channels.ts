/** What a channel's generated stream looks like on the wire. */
export interface VideoProfile {
  readonly width: number;
  readonly height: number;
  /** Frames per second; for interlaced output, the field pairs per second (25 for 576i). */
  readonly frameRate: number;
  readonly interlaced: boolean;
  readonly pattern: "testsrc2" | "smptehdbars";
}

/** The audio track of a channel's stream. */
export interface AudioProfile {
  readonly codec: "aac" | "mp2" | "ac3";
  /** Tone frequency in Hz, different per channel so tests can tell them apart by ear. */
  readonly tone: number;
}

/** The kind of schedule a channel airs; see `schedule.ts`. */
export type ScheduleKind =
  | "f1"
  | "news"
  | "series"
  | "films"
  | "kids"
  | "docs"
  | "regional"
  | "short";

/** One channel of the fake source. */
export interface FakeChannel {
  /** URL slug: `/stream/<id>.ts`, `/logo/<id>.svg`. */
  readonly id: string;
  /** `tvg-id` in the playlist and `channel` id in the guide. */
  readonly tvgId: string;
  readonly name: string;
  readonly number: number;
  readonly group: string;
  /** Logo background colour. */
  readonly colour: string;
  readonly schedule: ScheduleKind;
  readonly video: VideoProfile;
  readonly audio: AudioProfile;
}

const hd = (frameRate: number, pattern: VideoProfile["pattern"] = "testsrc2"): VideoProfile => ({
  width: 1280,
  height: 720,
  frameRate,
  interlaced: false,
  pattern,
});

/**
 * The channel line-up. Names are made up but shaped like a German cable line-up: one 1080p50 sports
 * channel, 720p for most, one 576i channel (interlaced, for deinterlacing tests), one channel with
 * MP2 audio (as German public broadcasters use on DVB), a channel of two-minute programmes so
 * end-to-end tests can record a whole programme quickly, and one HD channel with AC-3 audio (as
 * private German HD channels send it), which browsers cannot play and the server converts.
 */
export const channels: ReadonlyArray<FakeChannel> = [
  {
    id: "sportkanal-f1",
    tvgId: "SportkanalF1.fake.de",
    name: "Sportkanal F1 HD",
    number: 1,
    group: "Sport",
    colour: "#d4001f",
    schedule: "f1",
    video: { width: 1920, height: 1080, frameRate: 50, interlaced: false, pattern: "testsrc2" },
    audio: { codec: "aac", tone: 440 },
  },
  {
    id: "nachrichten-24",
    tvgId: "Nachrichten24.fake.de",
    name: "Nachrichten 24",
    number: 2,
    group: "Nachrichten",
    colour: "#0b4f9c",
    schedule: "news",
    video: hd(50, "smptehdbars"),
    audio: { codec: "aac", tone: 523 },
  },
  {
    id: "serienwelt",
    tvgId: "Serienwelt.fake.de",
    name: "Serienwelt HD",
    number: 3,
    group: "Unterhaltung",
    colour: "#7b2cbf",
    schedule: "series",
    video: hd(25),
    audio: { codec: "aac", tone: 587 },
  },
  {
    id: "kino-klassik",
    tvgId: "KinoKlassik.fake.de",
    name: "Kino Klassik",
    number: 4,
    group: "Filme",
    colour: "#3a3a3a",
    schedule: "films",
    video: hd(25),
    audio: { codec: "aac", tone: 659 },
  },
  {
    id: "kunterbunt",
    tvgId: "Kunterbunt.fake.de",
    name: "Kunterbunt",
    number: 5,
    group: "Kinder",
    colour: "#f2a900",
    schedule: "kids",
    video: hd(25),
    audio: { codec: "aac", tone: 698 },
  },
  {
    id: "doku-plus",
    tvgId: "DokuPlus.fake.de",
    name: "Doku Plus SD",
    number: 6,
    group: "Dokumentation",
    colour: "#2d6a4f",
    schedule: "docs",
    video: { width: 720, height: 576, frameRate: 25, interlaced: true, pattern: "smptehdbars" },
    audio: { codec: "aac", tone: 784 },
  },
  {
    id: "regional",
    tvgId: "RegionalFernsehen.fake.de",
    name: "Regional Fernsehen",
    number: 7,
    group: "Regional",
    colour: "#00838f",
    schedule: "regional",
    video: hd(50),
    audio: { codec: "mp2", tone: 880 },
  },
  {
    id: "testbild-kurz",
    tvgId: "TestbildKurz.fake.de",
    name: "Testbild Kurz",
    number: 8,
    group: "Test",
    colour: "#555b6e",
    schedule: "short",
    video: hd(25, "smptehdbars"),
    audio: { codec: "aac", tone: 1000 },
  },
  {
    id: "filmhaus",
    tvgId: "FilmhausHD.fake.de",
    name: "Filmhaus HD",
    number: 9,
    group: "Filme",
    colour: "#8c1c13",
    schedule: "films",
    video: hd(25),
    audio: { codec: "ac3", tone: 932 },
  },
];

/** The channel with this URL slug, if any. */
export const findChannel = (id: string): FakeChannel | undefined =>
  channels.find((channel) => channel.id === id);
