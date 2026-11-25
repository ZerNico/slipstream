import { DateTime } from "effect";
import { type HouseholdState, makeHousehold, mockGuest } from "./household.ts";
import type {
  PendingDeviceSignIn,
  PlaybackSettings,
  RecordingEntry,
  ScheduleConflict,
  SystemInfo,
} from "@slipstream/api";
import {
  type Capture,
  CaptureId,
  type Channel,
  ChannelId,
  type Collection,
  CollectionId,
  type Device,
  DeviceId,
  type EpisodeHistoryEntry,
  explainPlacement,
  groupRecording,
  HOUR,
  MINUTE,
  padRange,
  type PlaybackState,
  type Programme,
  ProgrammeId,
  type Recording,
  RecordingId,
  type RecordingProblem,
  type Rule,
  RuleId,
  type Source,
  SourceId,
  type SourceStream,
  SourceStreamId,
  type User,
  UserId,
} from "@slipstream/domain";

/*
 * A household's worth of data around `now`, for the dev mock, tests and screenshots: the
 * race records right now with one gap, the weekend is in the library, a darts final will
 * clash with the stream limit, and one recording failed.
 */

const GB = 1e9;

/** The household's time zone, which grouping and weekday rules read. */
export const mockTimeZone = "Europe/Berlin";

const instant = (epochMs: number) => DateTime.makeUnsafe(epochMs);

const user = (id: string, displayName: string, role: User["role"]): User => ({
  id: UserId.make(id),
  username: id,
  displayName,
  role,
  createdAt: instant(Date.UTC(2026, 9, 1)),
});

const channel = (
  id: string,
  name: string,
  number: number,
  extra: Partial<Channel> = {},
): Channel => ({
  id: ChannelId.make(id),
  name,
  number,
  guideChannelId: `${id}.de`,
  favourite: false,
  hidden: false,
  ...extra,
});

type Entry = RecordingEntry;
type Slot = readonly [title: string, minutes: number, extra?: Partial<Programme>];

/**
 * Everything the mock knows. Mutable on purpose: mock handlers change it like a server would.
 * Sources and streams are stored with their secrets; the handlers answer with views.
 * Recordings carry `watched: false` and `positionMillis: 0`; handlers fill in the caller's.
 */
export interface MockData {
  readonly now: number;
  users: User[];
  channels: Channel[];
  programmes: Programme[];
  recordings: Entry[];
  rules: Rule[];
  collections: Collection[];
  sources: Source[];
  streams: SourceStream[];
  captures: Capture[];
  devices: Device[];
  playback: PlaybackState[];
  conflicts: ScheduleConflict[];
  system: SystemInfo;
  pendingSignIns: PendingDeviceSignIn[];
  playbackSettings: PlaybackSettings;
  /** Deleted episodes per owner (recording model §3.6). */
  history: EpisodeHistoryEntry[];
  /** Profiles and guests beyond the accounts: tones, PINs, access, invites, defaults. */
  readonly household: HouseholdState;
}

/**
 * Places a recording in its collection the way the server will, with the domain's grouping.
 * Library fields an entry already had (group, placement, caller state) are worked out afresh.
 */
export const toEntry = (
  input: Recording | Entry,
  data: Pick<MockData, "rules" | "collections" | "channels">,
  sizeBytes: number,
): Entry => {
  const {
    group: _group,
    placement: _placement,
    sizeBytes: _size,
    watched: _watched,
    positionMillis: _position,
    ...recording
  }: Recording & Partial<Entry> = input;
  const ruleCollectionId = data.rules.find((rule) => rule.id === recording.ruleId)?.collectionId;
  const grouping = groupRecording(recording, data.collections, {
    timeZone: mockTimeZone,
    channelName: (channelId) => data.channels.find((c) => c.id === channelId)?.name,
    ruleCollectionId,
  });
  return {
    ...recording,
    group: grouping.path,
    ...(grouping.placement ? { placement: explainPlacement(grouping.placement) } : {}),
    sizeBytes,
    watched: false,
    positionMillis: 0,
  };
};

/** Builds the fixture household around `now` (epoch ms). */
export const makeMockData = (now: number): MockData => {
  // Guide slots sit on the five minutes, like real guides.
  const base = Math.floor(now / (5 * MINUTE)) * 5 * MINUTE;
  const t = (minutes: number) => base + minutes * MINUTE;

  const alex = user("alex", "Alex", "admin");
  const household = user("household", "Household", "user");
  const kim = user("kim", "Kim", "user");

  const skyF1 = channel("sky-sport-f1", "Sky Sport F1", 1, { favourite: true });
  const sky1 = channel("sky-sport-1", "Sky Sport 1", 2);
  const ard = channel("das-erste", "Das Erste", 3, { favourite: true });
  const zdf = channel("zdf", "ZDF", 4);
  const arte = channel("arte", "arte", 5);
  const euro = channel("eurosport-1", "Eurosport 1", 6);
  const news = channel("sky-sport-news", "Sky Sport News", 7);
  const shop = channel("teleshop-24", "Teleshop 24", 99, { hidden: true });
  const channels = [skyF1, sky1, ard, zdf, arte, euro, news, shop];

  const programmes: Programme[] = [];
  const add = (
    ch: Channel,
    startMin: number,
    lengthMin: number,
    title: string,
    extra: Partial<Programme> = {},
  ): Programme => {
    const programme: Programme = {
      id: ProgrammeId.make(`${ch.id}:${t(startMin)}`),
      channelId: ch.id,
      start: instant(t(startMin)),
      end: instant(t(startMin + lengthMin)),
      title,
      categories: [],
      repeat: false,
      live: false,
      ...extra,
    };
    programmes.push(programme);
    return programme;
  };
  /** Fills a channel from `fromMin` to `toMin` with the slots in turn. */
  const fill = (ch: Channel, fromMin: number, toMin: number, slots: readonly Slot[]) => {
    let at = fromMin;
    let index = 0;
    while (at < toMin) {
      const [title, length, extra] = slots[index % slots.length] ?? ["", 30];
      add(ch, at, length, title, extra);
      at += length;
      index += 1;
    }
  };

  // Sky Sport F1: the race is on now and started 72 minutes ago.
  fill(skyF1, -8 * 60, -120, [["F1: Classics", 60, { categories: ["Sport"] }]]);
  add(skyF1, -120, 48, "Live F1: Grand Prix Countdown - GP Las Vegas", { live: true });
  const race = add(skyF1, -72, 120, "Live F1: Rennen - GP Las Vegas", {
    live: true,
    categories: ["Sport"],
    description:
      "Das Rennen in Las Vegas: 50 Runden auf dem 6,2 km langen Strip Circuit. Live mit Vorberichten und Analyse.",
  });
  add(skyF1, 48, 60, "Live F1: Analyse - GP Las Vegas", { live: true });
  const kompakt = add(skyF1, 108, 60, "F1: Rennen Kompakt - GP Las Vegas", {
    description: "Das Rennen in 60 Minuten.",
  });
  fill(skyF1, 168, 20 * 60, [
    ["Formel 1: Highlights", 30],
    ["F1: Classics", 90],
  ]);

  fill(sky1, 50 - 3 * 180, 50, [
    ["Sky Sport Update", 30],
    ["NBA: Lakers - Celtics", 150, { live: true }],
  ]);
  // Starts as the race ends, while the race is still kept recording for its extra hour.
  const darts = add(sky1, 50, 150, "Darts: Grand Slam - Finale", {
    live: true,
    categories: ["Sport"],
  });
  fill(sky1, 200, 350, [
    ["Golf: DP World Tour", 120],
    ["Sky Sport Update", 30],
  ]);
  // Last night's semi-final failed; its marked repeat airs today (recording model §3.7).
  const dartsSemi = add(sky1, -14 * 60, 150, "Darts: Grand Slam - Halbfinale", {
    live: true,
    categories: ["Sport"],
  });
  add(sky1, 350, 150, "Darts: Grand Slam - Halbfinale (Wh.)", { categories: ["Sport"] });
  fill(sky1, 500, 20 * 60, [
    ["Golf: DP World Tour", 120],
    ["Sky Sport Update", 30],
  ]);

  fill(ard, -15 - 3 * 165, -15, [
    ["Tagesschau", 15],
    ["Sportschau", 105],
    ["Brisant", 45],
  ]);
  const tagesschau = add(ard, -15, 15, "Tagesschau");
  add(ard, 0, 15, "Wetter vor acht");
  const tatort = add(ard, 15, 90, "Tatort", {
    subtitle: "Schattenmann",
    categories: ["Krimi"],
    description: "Ein Mord im Hafen führt die Kommissarinnen in die eigene Vergangenheit.",
  });
  fill(ard, 105, 20 * 60, [
    ["Tagesthemen", 30],
    ["Caren Miosga", 60],
    ["Tagesschau", 15],
  ]);

  // An episode Kim recorded a week ago, and its repeat on another channel (§4.3 Tatort on ONE).
  const tatortDescription =
    "Kommissar Faber ermittelt im Dortmunder Hafen, wo ein junger Mann tot aufgefunden wird.";
  const unterWoelfen = add(ard, -7 * 24 * 60 + 15, 90, "Tatort", {
    subtitle: "Unter Wölfen",
    categories: ["Krimi"],
    description: tatortDescription,
    episode: { episode: 1247 },
  });

  fill(zdf, -8 * 60, 20 * 60, [
    ["heute journal", 30],
    ["Terra X: Faszination Erde", 45, { categories: ["Dokumentation"] }],
    ["Markus Lanz", 75],
    ["heute", 15],
  ]);

  // The repeat follows ZDF's last guide slot, tomorrow.
  add(zdf, 20 * 60, 90, "Tatort", {
    subtitle: "Unter Wölfen",
    categories: ["Krimi"],
    description: tatortDescription,
  });

  const pate = add(arte, -30 * 60, 170, "Der Pate", {
    categories: ["Spielfilm"],
    originalAirDate: { year: 1972 },
  });
  fill(arte, -8 * 60, 20 * 60, [
    ["Kurzschluss", 50],
    ["ARTE Journal", 20],
    ["Der Pate II", 200, { categories: ["Spielfilm"], originalAirDate: { year: 1974 } }],
  ]);

  fill(euro, -8 * 60 - 40, 20 * 60, [
    ["Snooker: UK Championship - Finale", 180, { live: true, categories: ["Sport"] }],
    ["Ski Alpin: Slalom", 90],
    ["Skispringen: Weltcup", 120],
  ]);
  fill(news, -8 * 60, 20 * 60, [["Sky Sport News", 60]]);
  fill(shop, -8 * 60, 20 * 60, [["Teleshop", 240]]);

  // Earlier sessions of the weekend, and the next weekend in Qatar for the rule preview.
  const weekend = [
    add(skyF1, -55 * 60, 90, "Live F1: 1. Freies Training - GP Las Vegas", { live: true }),
    add(skyF1, -51 * 60, 90, "Live F1: 2. Freies Training - GP Las Vegas", { live: true }),
    add(skyF1, -32 * 60, 70, "Live F1: 3. Freies Training - GP Las Vegas", { live: true }),
    add(skyF1, -28 * 60, 90, "Live F1: Qualifying - GP Las Vegas", { live: true }),
  ];
  const presse = add(skyF1, -26 * 60 - 20, 30, "F1: Pressekonferenz Qualifying - GP Las Vegas");
  // Earlier races: with "newest 3 events", the oldest is due for clean-up.
  const earlierRaces = ["GP São Paulo", "GP Mexiko", "GP USA"].map((event, index) =>
    add(skyF1, -(index + 2) * 7 * 24 * 60, 120, `Live F1: Rennen - ${event}`, {
      live: true,
      categories: ["Sport"],
    }),
  );
  // Snooker recorded by hand, in no collection yet: the library suggests one.
  const snooker = ["Achtelfinale", "Viertelfinale", "Halbfinale"].map((round, index) =>
    add(euro, -(3 - index) * 24 * 60 - 6 * 60, 180, `Snooker: UK Championship - ${round}`, {
      live: true,
      categories: ["Sport"],
    }),
  );
  // The semi-final's first airing, the morning before (no longer in the guide window).
  const snookerSemi = snooker.at(-1);
  if (snookerSemi === undefined) throw new Error("the snooker fixture has no rounds");
  const snookerFirstAiring: Programme = {
    ...snookerSemi,
    id: ProgrammeId.make(`${euro.id}:${DateTime.toEpochMillis(snookerSemi.start) - 12 * HOUR}`),
    start: instant(DateTime.toEpochMillis(snookerSemi.start) - 12 * HOUR),
    end: instant(DateTime.toEpochMillis(snookerSemi.end) - 12 * HOUR),
  };
  const snookerOriginalId = RecordingId.make("snooker-halbfinale-original");
  const qatar = ["1. Freies Training", "Sprint Qualifying", "Sprint", "Qualifying", "Rennen"].map(
    (session, index) =>
      add(skyF1, 5 * 24 * 60 + index * 18 * 60, 105, `Live F1: ${session} - GP Katar`, {
        live: true,
      }),
  );
  add(skyF1, 5 * 24 * 60 + 18 * 60 + 150, 30, "F1: Pressekonferenz Qualifying - GP Katar");
  add(skyF1, 6 * 24 * 60 + 20 * 60, 60, "F1: Rennen Kompakt - GP Katar");
  // F1 Academy: titles no collection holds, so they scatter into three places (§3.3).
  const academy = ["Training", "Qualifying", "Rennen"].map((session, index) =>
    add(skyF1, 5 * 24 * 60 + index * 18 * 60 + 200, 45, `Live F1 Academy: ${session} - GP Katar`, {
      live: true,
      categories: ["Sport"],
    }),
  );

  const formel1: Collection = {
    id: CollectionId.make("formel-1"),
    name: "Formel 1",
    rank: 0,
    matcher: {
      channels: [],
      title: [{ _tag: "StartsWith", values: ["F1:", "Live F1:"] }],
      categories: [],
      weekdays: [],
    },
    labels: [],
    layout: {
      parts: [
        { _tag: "Split", name: "event", after: { separator: " - ", occurrence: "last" } },
        { _tag: "Split", name: "programme", before: { separator: " - ", occurrence: "last" } },
      ],
      path: ["{year}", "{event}", "{programme}"],
    },
    retention: { _tag: "KeepNewestEvents", count: 3 },
  };

  const f1Rule: Rule = {
    id: RuleId.make("formel-1-live"),
    name: "Formel 1 live",
    enabled: true,
    ownerId: alex.id,
    matcher: {
      channels: [skyF1.id],
      title: [
        { _tag: "StartsWith", values: ["Live F1:"] },
        {
          _tag: "Contains",
          values: [
            "1. Freies Training",
            "2. Freies Training",
            "3. Freies Training",
            "Qualifying",
            "Sprint Qualifying",
            "Sprint",
            "Rennen",
          ],
        },
      ],
      categories: [],
      weekdays: [],
    },
    padding: { beforeMinutes: 5, afterMinutes: 60 },
    retention: { _tag: "KeepNewestEvents", count: 3 },
    collectionId: formel1.id,
    createdAt: instant(Date.UTC(2026, 9, 2)),
    skipRepeats: true,
    offerDeclined: false,
  };
  const tatortRule: Rule = {
    id: RuleId.make("tatort"),
    name: "Tatort",
    enabled: true,
    ownerId: kim.id,
    matcher: {
      channels: [ard.id],
      title: [{ _tag: "IsExactly", values: ["Tatort"] }],
      categories: [],
      weekdays: ["sun"],
    },
    padding: { beforeMinutes: 2, afterMinutes: 10 },
    retention: { _tag: "KeepDays", days: 30 },
    createdAt: instant(Date.UTC(2026, 9, 3)),
    skipRepeats: true,
    offerDeclined: false,
  };
  const dartsRule: Rule = {
    id: RuleId.make("darts"),
    name: "Darts",
    enabled: true,
    ownerId: alex.id,
    matcher: {
      channels: [sky1.id],
      title: [{ _tag: "StartsWith", values: ["Darts:"] }],
      categories: [],
      weekdays: [],
    },
    padding: { beforeMinutes: 0, afterMinutes: 30 },
    retention: { _tag: "KeepNewest", count: 5 },
    createdAt: instant(Date.UTC(2026, 9, 4)),
    skipRepeats: true,
    offerDeclined: false,
  };
  /** "Record every “Live F1 Academy”": no collection yet, and its sessions scatter. */
  const academyRule: Rule = {
    id: RuleId.make("live-f1-academy"),
    name: "Live F1 Academy:",
    enabled: true,
    ownerId: alex.id,
    matcher: {
      channels: [skyF1.id],
      title: [{ _tag: "StartsWith", values: ["Live F1 Academy:"] }],
      categories: [],
      weekdays: [],
    },
    padding: { beforeMinutes: 0, afterMinutes: 15 },
    retention: { _tag: "KeepAll" },
    createdAt: instant(Date.UTC(2026, 9, 6)),
    skipRepeats: true,
    offerDeclined: false,
  };
  const rules = [f1Rule, tatortRule, dartsRule, academyRule];
  const collections = [formel1];

  const recording = (
    id: string,
    programme: Programme,
    fields: Partial<Recording> & Pick<Recording, "state" | "padding">,
    sizeBytes: number,
  ): Entry => {
    const { id: programmeId, ...info } = programme;
    return toEntry(
      {
        id: RecordingId.make(id),
        programmeId,
        ...info,
        problems: [],
        ownerIds: [alex.id],
        protected: false,
        labels: [],
        exportStatus: "none",
        createdAt: instant(DateTime.toEpochMillis(programme.start) - 24 * HOUR),
        ...fields,
      },
      { rules, collections, channels },
      sizeBytes,
    );
  };

  const f1 = { padding: f1Rule.padding, ruleId: f1Rule.id };
  const byHand = { padding: { beforeMinutes: 2, afterMinutes: 10 } };
  const gap: RecordingProblem = {
    _tag: "Gap",
    range: { start: instant(t(-20)), end: instant(t(-18)) },
  };
  const weekendSizes = [7.0, 7.0, 6.1, 7.0];
  const recordings = [
    recording("rennen-las-vegas", race, { state: "recording", ...f1, problems: [gap] }, 3.5 * GB),
    ...weekend.map((session, index) =>
      recording(
        `weekend-${index + 1}`,
        session,
        { state: "completed", ...f1 },
        (weekendSizes[index] ?? 7) * GB,
      ),
    ),
    recording("presse-qualifying", presse, { state: "completed", ...byHand }, 1.9 * GB),
    ...earlierRaces.map((earlier, index) =>
      recording(`rennen-${index + 1}`, earlier, { state: "completed", ...f1 }, 9.2 * GB),
    ),
    ...snooker.map((round, index) =>
      recording(
        `snooker-${index + 1}`,
        round,
        // The semi-final is a repeat that replaced a damaged first airing ("Keep the original").
        index === snooker.length - 1
          ? { state: "completed", ...byHand, replacesId: snookerOriginalId }
          : { state: "completed", ...byHand },
        8.1 * GB,
      ),
    ),
    // That damaged first airing: hidden as replaced by its repeat, a day ago, so it may still
    // come back (7 days) but no longer has its short-lived "replaced" card (24 hours).
    recording(
      snookerOriginalId,
      snookerFirstAiring,
      {
        state: "incomplete",
        ...byHand,
        problems: [
          {
            _tag: "Gap",
            range: {
              start: instant(DateTime.toEpochMillis(snookerFirstAiring.start) + 20 * MINUTE),
              end: instant(DateTime.toEpochMillis(snookerFirstAiring.start) + 110 * MINUTE),
            },
          },
        ],
        replacedById: RecordingId.make("snooker-3"),
        hiddenAt: instant(DateTime.toEpochMillis(snookerSemi.end) + 5 * MINUTE),
        hiddenReason: "replaced",
      },
      2.4 * GB,
    ),
    recording(
      "der-pate",
      pate,
      {
        state: "completed",
        padding: { beforeMinutes: 5, afterMinutes: 15 },
        ownerIds: [kim.id],
        protected: true,
      },
      9.4 * GB,
    ),
    recording(
      "tagesschau-failed",
      tagesschau,
      {
        state: "failed",
        padding: { beforeMinutes: 0, afterMinutes: 0 },
        problems: [
          {
            _tag: "SourceUnreachable",
            range: { start: tagesschau.start, end: tagesschau.end },
            retries: 6,
          },
        ],
        ownerIds: [kim.id],
      },
      0,
    ),
    recording(
      "tatort-schattenmann",
      tatort,
      {
        state: "scheduled",
        padding: tatortRule.padding,
        ruleId: tatortRule.id,
        ownerIds: [kim.id],
      },
      0,
    ),
    recording(
      "darts-finale",
      darts,
      { state: "scheduled", padding: dartsRule.padding, ruleId: dartsRule.id },
      0,
    ),
    recording("rennen-kompakt", kompakt, { state: "scheduled", ...byHand }, 0),
    recording(
      "tatort-unter-woelfen",
      unterWoelfen,
      {
        state: "completed",
        padding: tatortRule.padding,
        ruleId: tatortRule.id,
        ownerIds: [kim.id],
      },
      4.2 * GB,
    ),
    recording(
      "darts-halbfinale-failed",
      dartsSemi,
      {
        state: "failed",
        padding: dartsRule.padding,
        ruleId: dartsRule.id,
        problems: [{ _tag: "NoData" }],
        rerunUntil: instant(DateTime.toEpochMillis(dartsSemi.end) + 14 * 24 * HOUR),
      },
      0,
    ),
    ...academy.map((session, index) =>
      recording(
        `academy-${index + 1}`,
        session,
        { state: "scheduled", padding: academyRule.padding, ruleId: academyRule.id },
        0,
      ),
    ),
    ...qatar.map((session, index) =>
      recording(`katar-${index + 1}`, session, { state: "scheduled", ...f1 }, 0),
    ),
  ];

  const dartsRange = padRange(darts, dartsRule.padding);
  const conflicts: ScheduleConflict[] = [
    {
      range: { start: dartsRange.start, end: padRange(race, f1Rule.padding).end },
      channelIds: [skyF1.id, sky1.id],
      recordingIds: [RecordingId.make("darts-finale"), RecordingId.make("rennen-las-vegas")],
      sourceIds: [SourceId.make("tvproxy")],
      capacity: 1,
    },
  ];

  const tvproxy: Source = {
    id: SourceId.make("tvproxy"),
    name: "tvproxy",
    config: {
      _tag: "M3u",
      playlistUrl: "http://192.168.12.11:8080/playlist.m3u",
      guideUrl: "http://192.168.12.11:8080/epg.xml",
    },
    refreshIntervalMinutes: 360,
    maxStreams: 2,
    headers: {},
    guideCleanup: { removeDuplicates: true, rewrites: [] },
    enabled: true,
    health: "ok",
    lastRefreshAt: instant(t(-95)),
  };
  const backup: Source = {
    id: SourceId.make("backup-iptv"),
    name: "Backup IPTV",
    // Credentials in the address: views mask them, and the editor shows them as stored.
    config: {
      _tag: "M3u",
      playlistUrl: "http://iptv.example/get.php?username=kim&password=hunter22&type=m3u",
    },
    refreshIntervalMinutes: 720,
    headers: {},
    guideCleanup: { removeDuplicates: true, rewrites: [] },
    enabled: true,
    health: "unreachable",
    lastRefreshAt: instant(t(-26 * 60)),
  };
  const streams: SourceStream[] = channels.map((ch) => ({
    id: SourceStreamId.make(`tvproxy-${ch.id}`),
    sourceId: tvproxy.id,
    upstreamId: ch.id,
    name: ch.name,
    url: `http://192.168.12.11:8080/stream/${ch.id}.ts`,
    tvgId: `${ch.id}.de`,
    group: "DE",
    lastSeenAt: instant(t(-95)),
  }));
  // The backup source carries SD copies of two channels: fallbacks in their stream lists.
  for (const [id, name] of [
    ["das-erste", "DE: Das Erste SD"],
    ["zdf", "DE: ZDF SD"],
  ] as const) {
    streams.push({
      id: SourceStreamId.make(`backup-${id}`),
      sourceId: backup.id,
      upstreamId: id,
      name,
      url: `http://iptv.example/live/${id}.ts`,
      tvgId: `${id}.de`,
      group: "Deutschland",
      lastSeenAt: instant(t(-26 * 60)),
    });
  }

  const captures: Capture[] = [
    {
      id: CaptureId.make("capture-sky-f1"),
      channelId: skyF1.id,
      sourceStreamId: SourceStreamId.make("tvproxy-sky-sport-f1"),
      startedAt: instant(t(-77)),
      state: "running",
      stats: { bytes: 3.5 * GB, segments: 770, reconnects: 1, bitrateKbps: 7800 },
      streamInfo: {
        container: "mpegts",
        video: {
          codec: "h264",
          profile: "High",
          width: 1920,
          height: 1080,
          fps: 50,
          interlaced: false,
        },
        audio: [{ codec: "aac", channels: 2, language: "deu" }],
        bitrateKbps: 7800,
        probedAt: instant(t(-77)),
      },
    },
  ];

  const devices: Device[] = [
    {
      id: DeviceId.make("shield"),
      userId: household.id,
      name: "Living Room Shield",
      kind: "tv",
      createdAt: instant(Date.UTC(2026, 9, 5)),
      lastSeenAt: instant(t(-3)),
    },
    {
      id: DeviceId.make("pixel"),
      userId: alex.id,
      name: "Pixel 9",
      kind: "phone",
      createdAt: instant(Date.UTC(2026, 9, 6)),
      lastSeenAt: instant(t(-140)),
    },
    {
      id: DeviceId.make("firefox"),
      userId: alex.id,
      name: "Firefox on MacBook",
      kind: "web",
      createdAt: instant(Date.UTC(2026, 9, 7)),
      lastSeenAt: instant(now),
    },
  ];

  const position = (recordingId: string, minutes: number, watched = false): PlaybackState => ({
    userId: alex.id,
    target: { _tag: "Recording", recordingId: RecordingId.make(recordingId) },
    positionMillis: minutes * MINUTE,
    watched,
    updatedAt: instant(t(-20 * 60)),
  });

  return {
    now,
    users: [alex, household, kim, mockGuest(now)],
    household: makeHousehold(now, alex.id),
    channels,
    programmes,
    recordings,
    rules,
    collections,
    sources: [tvproxy, backup],
    streams,
    captures,
    devices,
    playback: [
      position("weekend-4", 61),
      position("weekend-3", 41),
      position("weekend-1", 0, true),
      position("weekend-2", 0, true),
      position("rennen-2", 0, true),
      position("rennen-3", 0, true),
      position("snooker-1", 0, true),
    ],
    conflicts,
    system: {
      version: "0.1.0",
      timeZone: mockTimeZone,
      ffmpeg: { version: "9.0.2", selfCheck: "ok" },
      hardware: {
        encoders: [{ encoder: "qsv", codecs: ["h264", "hevc"], rateControl: ["cqp"] }],
      },
      storage: [
        {
          path: "/data",
          totalBytes: 2_000 * GB,
          freeBytes: 1_530 * GB,
          recordingsBytes: 412 * GB,
          bufferBytes: 58 * GB,
          freeSpaceFloorBytes: 50 * GB,
        },
      ],
      sources: [
        { sourceId: tvproxy.id, health: tvproxy.health },
        { sourceId: backup.id, health: backup.health },
      ],
    },
    pendingSignIns: [
      {
        userCode: "QK74RM",
        device: { name: "Living Room Shield", kind: "tv" },
        expiresAt: instant(now + 10 * MINUTE),
      },
    ],
    playbackSettings: {
      hardwareAcceleration: "auto",
      detected: {
        name: "Intel Quick Sync",
        ok: true,
        testedAt: instant(t(-2)),
        detail: "i7-7700K · H.264 and HEVC · constant-quality mode only",
      },
      preference: "quality",
      maxConversions: 2,
      quality: { home: "original", away: "auto", mobile: "4000" },
    },
    // Three Tatort episodes Kim deleted: her series recording keeps them out (§3.2).
    history: [1239, 1241, 1244].map((episode, index): EpisodeHistoryEntry => ({
      userId: kim.id,
      ruleId: tatortRule.id,
      showKey: "tatort",
      class: "Episode",
      episode,
      airedAt: instant(t(-(5 - index) * 7 * 24 * 60)),
      channelId: ard.id,
      title: "Tatort",
    })),
  };
};
