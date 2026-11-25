/**
 * The words, timeline and actions of each hero state (SPEC §8.1), as plain data. The hero
 * component only lays this out, so every state shares one geometry and the copy rules (wall
 * clock for running things, position of length for finished ones, SPEC §7.9) are tested here.
 */
import type { RecordingEntry } from "@slipstream/api";
import {
  type Channel,
  epochMs,
  MINUTE,
  type Profile,
  type Programme,
  renderSegment,
} from "@slipstream/domain";
import { formatBehind, formatClock, formatPosition } from "~/i18n/formats.ts";
import { dayPill, m, pathLabels } from "@slipstream/i18n";
import {
  programmeSpan,
  recordedSpan,
  recordingTimeline,
  resumeMillis,
} from "~/modules/library/library.ts";
import type { ArtworkSubject } from "~/ui/artwork/generate.ts";
import { programmeSubject, recordingSubject } from "~/ui/artwork/subjects.ts";
import type { TimelineData } from "~/ui/timeline/geometry.ts";
import type { Hero } from "./model.ts";
import { channelOf } from "./present.ts";
import type { HeroBadge, HeroIcon } from "./shape.ts";

export type { HeroBadge, HeroIcon } from "./shape.ts";

/** The id of the hero's content, which the switcher's tabs control. */
export const heroPanelId = "home-hero-panel";

/**
 * The title's size step inside its fixed line box (SPEC §6.1): long titles step down before
 * they truncate, 64 → 51 → 40 px (phones 34 → 29 → 23), so every state keeps one geometry.
 */
export const titleSteps = (title: string) => ({
  "data-s2": title.length > 16 ? "" : undefined,
  "data-s3": title.length > 24 ? "" : undefined,
  "data-p2": title.length > 20 ? "" : undefined,
});
const HALF_HOUR = 30 * MINUTE;

/** The read line above the timeline, with the parts that are set in bold kept apart. */
export type ReadLine =
  | { readonly kind: "text"; readonly text: string }
  /** "You stopped at 18:11 · **−31:30** behind live". */
  | { readonly kind: "behind"; readonly stoppedAt: number; readonly behind: string }
  /** "Nothing recording. Next at **19:25**, in **43 min**." */
  | { readonly kind: "next"; readonly at: number; readonly inText: string }
  /** "Stopped at **46:30** of 1:15:00 · 28 min left". */
  | {
      readonly kind: "position";
      readonly position: string;
      readonly length: string;
      readonly leftSeconds: number;
    };

/** Where a hero action goes. */
export type HeroTarget =
  | { readonly to: "recording"; readonly id: string; readonly at: "resume" | "start" | "live" }
  | { readonly to: "detail"; readonly id: string }
  | { readonly to: "live"; readonly channel: string }
  | { readonly to: "sheet"; readonly programmeId: string }
  | { readonly to: "sources" }
  | { readonly to: "guide" }
  | { readonly to: "library" };

/** One hero action. */
export interface HeroAction {
  /** primary (amber), glass, the Live button that folds to an icon on phones, or the info icon. */
  readonly kind: "primary" | "glass" | "fold" | "info";
  readonly label: string;
  /** The phone label that keeps the time ("Resume 18:11"). */
  readonly short?: string;
  readonly icon: HeroIcon;
  readonly target: HeroTarget;
}

/** Everything a hero state shows. */
export interface HeroView {
  readonly kind: Hero["kind"];
  /** The section's name for assistive tech. */
  readonly label: string;
  readonly badges: readonly HeroBadge[];
  readonly eyebrow: string;
  readonly title: string;
  readonly description: string;
  readonly read: ReadLine | undefined;
  readonly timeline: TimelineData | undefined;
  /** Positions read as time into a finished recording. */
  readonly relative: boolean;
  readonly actions: readonly HeroAction[];
  /** The picture behind the hero and on the poster; `undefined` for onboarding's wall. */
  readonly art: ArtworkSubject | undefined;
}

/** What the hero copy needs besides the hero itself. */
export interface HeroContext {
  readonly now: number;
  readonly channels: readonly Channel[];
  /** The household's zone, which the eyebrow's day ("Today 23", "Sun 22") is counted in. */
  readonly timeZone: string;
}

const date = (millis: number) => new Date(millis);
const minutes = (millis: number) => Math.round(millis / MINUTE);

/** A recording's place for the eyebrow: its folders without plain years, "Formel 1 · GP Katar". */
export const groupLine = (entry: RecordingEntry): readonly string[] => {
  const labels = pathLabels();
  const named = entry.group.item._tag === "Airing" || entry.group.item._tag === "Other";
  return entry.group.folders
    .filter((segment) => segment._tag !== "Month")
    .map((segment) => renderSegment(segment, labels))
    .filter((part) => !/^\p{N}{4}$/u.test(part) && !(named && part === entry.title));
};

/**
 * The recording's own name, "Qualifying" under "Formel 1 › 2026 › GP Katar". An item named by
 * its air time (grouped by title and date) is called by its title instead.
 */
export const itemTitle = (entry: RecordingEntry): string => {
  const { item } = entry.group;
  if (item._tag === "Airing" || item._tag === "Other") return entry.title;
  return renderSegment(item, pathLabels());
};

/** Who a recording belongs to, by name. */
export const ownerName = (
  entry: RecordingEntry,
  profiles: readonly Pick<Profile, "id" | "displayName">[],
): string => profiles.find((profile) => profile.id === entry.ownerIds[0])?.displayName ?? "";

const recordingView = (entry: RecordingEntry, context: HeroContext): HeroView => {
  const { now } = context;
  const channel = channelOf(context.channels, entry.channelId);
  const span = recordedSpan(entry);
  const position = resumeMillis(entry);
  const resumeAt = position === undefined ? undefined : span.start + position;
  const started = Math.max(0, now - epochMs(entry.start));
  const startedSeconds = Math.round(started / 1000 / 60) * 60;
  const info: readonly HeroAction[] =
    entry.programmeId === undefined
      ? []
      : [
          {
            kind: "info",
            label: m.home_programme_details(),
            icon: "none",
            target: { to: "sheet", programmeId: entry.programmeId },
          },
        ];
  const actions: readonly HeroAction[] =
    resumeAt === undefined
      ? [
          {
            kind: "primary",
            label: m.player_watch_from_start(),
            icon: "fromStart",
            target: { to: "recording", id: entry.id, at: "start" },
          },
          {
            kind: "glass",
            label: m.player_watch_live(),
            icon: "liveDot",
            target: { to: "recording", id: entry.id, at: "live" },
          },
          ...info,
        ]
      : [
          {
            kind: "primary",
            label: m.home_resume_at({ start: date(resumeAt) }),
            short: m.home_resume_short({ time: m.home_clock({ start: date(resumeAt) }) }),
            icon: "play",
            target: { to: "recording", id: entry.id, at: "resume" },
          },
          {
            kind: "glass",
            label: m.player_from_start(),
            icon: "fromStart",
            target: { to: "recording", id: entry.id, at: "start" },
          },
          {
            kind: "fold",
            label: m.player_watch_live(),
            short: m.player_badge_live(),
            icon: "live",
            target: { to: "recording", id: entry.id, at: "live" },
          },
          ...info,
        ];
  return {
    kind: "recording",
    label: m.recordings_recording_now(),
    badges: [{ tone: "live", text: m.status_recording() }],
    // Not watched yet, the read line says when it started; the eyebrow doesn't repeat it.
    eyebrow: m.home_join({
      parts: [
        ...groupLine(entry),
        ...(resumeAt === undefined ? [] : [m.home_started_ago({ seconds: startedSeconds })]),
      ],
    }),
    title: itemTitle(entry),
    description: entry.description ?? "",
    read:
      resumeAt === undefined
        ? { kind: "text", text: m.home_started_ago({ seconds: startedSeconds }) }
        : { kind: "behind", stoppedAt: resumeAt, behind: formatBehind(now - resumeAt) },
    timeline: recordingTimeline(entry, now, position),
    relative: false,
    actions,
    art: recordingSubject(entry, channel),
  };
};

const soonView = (
  entry: RecordingEntry,
  onAir: Programme | undefined,
  context: HeroContext,
): HeroView => {
  const { now } = context;
  const channel = channelOf(context.channels, entry.channelId);
  const span = recordedSpan(entry);
  const programme = programmeSpan(entry);
  const waitSeconds = Math.max(60, Math.round((span.start - now) / MINUTE) * 60);
  // Round half hours around now and the programme, so "in 43 min" has its anchor on the bar.
  const from = Math.floor((now - 5 * MINUTE) / HALF_HOUR) * HALF_HOUR;
  const to = Math.ceil((span.end + 5 * MINUTE) / HALF_HOUR) * HALF_HOUR;
  const bands = [
    ...(onAir === undefined
      ? []
      : [
          {
            start: Math.max(from, epochMs(onAir.start)),
            end: Math.min(programme.start, epochMs(onAir.end)),
            title: onAir.title,
          },
        ]),
    { start: programme.start, end: programme.end, title: itemTitle(entry) },
  ].filter((band) => band.end > band.start);
  const actions: HeroAction[] = [];
  if (entry.programmeId !== undefined) {
    actions.push({
      kind: "primary",
      label: m.home_recording_options(),
      icon: "none",
      target: { to: "sheet", programmeId: entry.programmeId },
    });
  }
  if (channel !== undefined) {
    actions.push({
      kind: actions.length === 0 ? "primary" : "glass",
      label: m.home_watch_channel_now({ channel: channel.name }),
      icon: "liveDot",
      target: { to: "live", channel: channel.id },
    });
  }
  return {
    kind: "soon",
    label: m.home_hero_soon(),
    badges: [],
    eyebrow: m.home_join({
      parts: [
        ...groupLine(entry),
        dayPill(programme.start, now, context.timeZone),
        formatClock(programme.start),
      ],
    }),
    title: itemTitle(entry),
    description: entry.description ?? "",
    read: {
      kind: "next",
      at: span.start,
      inText: m.home_duration({ seconds: waitSeconds }),
    },
    timeline: { start: from, end: to, now, bands, marks: [programme.start, programme.end] },
    relative: false,
    actions,
    art: recordingSubject(entry, channel),
  };
};

const continueView = (entry: RecordingEntry, context: HeroContext): HeroView => {
  const channel = channelOf(context.channels, entry.channelId);
  const span = recordedSpan(entry);
  const length = span.end - span.start;
  const position = resumeMillis(entry) ?? 0;
  const at = formatPosition(position);
  return {
    kind: "continue",
    label: m.player_continue_watching(),
    badges: [],
    eyebrow: m.home_join({
      parts: [...groupLine(entry), dayPill(epochMs(entry.start), context.now, context.timeZone)],
    }),
    title: itemTitle(entry),
    description: entry.description ?? "",
    read: {
      kind: "position",
      position: at,
      length: formatPosition(length),
      leftSeconds: Math.round(Math.max(0, length - position) / MINUTE) * 60,
    },
    timeline: recordingTimeline(entry, context.now, position),
    relative: true,
    actions: [
      {
        kind: "primary",
        label: m.choice_resume_from({ position: at }),
        short: m.home_resume_short({ time: at }),
        icon: "play",
        target: { to: "recording", id: entry.id, at: "resume" },
      },
      {
        kind: "glass",
        label: m.player_from_start(),
        icon: "fromStart",
        target: { to: "recording", id: entry.id, at: "start" },
      },
      {
        kind: "info",
        label: m.home_recording_details(),
        icon: "none",
        target: { to: "detail", id: entry.id },
      },
    ],
    art: recordingSubject(entry, channel),
  };
};

const newView = (entry: RecordingEntry, context: HeroContext): HeroView => {
  const channel = channelOf(context.channels, entry.channelId);
  const span = recordedSpan(entry);
  return {
    kind: "new",
    label: m.home_row_new(),
    badges: [{ tone: "sched", text: m.status_new() }],
    eyebrow: m.home_join({
      parts: [...groupLine(entry), dayPill(epochMs(entry.start), context.now, context.timeZone)],
    }),
    title: itemTitle(entry),
    description: entry.description ?? "",
    read: {
      kind: "text",
      text: m.home_read_new({
        seconds: minutes(span.end - span.start) * 60,
        start: date(epochMs(entry.start)),
      }),
    },
    timeline: recordingTimeline(entry, context.now),
    relative: true,
    actions: [
      {
        kind: "primary",
        label: m.player_play(),
        icon: "play",
        target: { to: "recording", id: entry.id, at: "start" },
      },
      {
        kind: "glass",
        label: m.action_details(),
        icon: "none",
        target: { to: "detail", id: entry.id },
      },
    ],
    art: recordingSubject(entry, channel),
  };
};

const liveView = (programme: Programme, context: HeroContext): HeroView => {
  const { now } = context;
  const channel = channelOf(context.channels, programme.channelId);
  const start = epochMs(programme.start);
  const end = epochMs(programme.end);
  const channelName = channel?.name ?? "";
  return {
    kind: "live",
    label: m.guide_on_now(),
    badges: [{ tone: "live", text: m.status_live() }],
    eyebrow: m.home_join({
      parts: [channelName, m.home_time_range({ start: date(start), end: date(end) })].filter(
        Boolean,
      ),
    }),
    title: programme.title,
    description: programme.description ?? "",
    read: {
      kind: "text",
      text: m.home_read_live({
        seconds: minutes(now - start) * 60,
        left: minutes(end - now) * 60,
      }),
    },
    timeline: { start, end, now },
    relative: false,
    actions: [
      {
        kind: "primary",
        label: m.player_watch_live(),
        icon: "liveDot",
        target: { to: "live", channel: programme.channelId },
      },
      {
        kind: "glass",
        label: m.home_recording_options(),
        icon: "none",
        target: { to: "sheet", programmeId: programme.id },
      },
    ],
    art: programmeSubject(programme, channel),
  };
};

const idleView = (): HeroView => ({
  kind: "idle",
  label: m.home_hero_idle(),
  badges: [],
  eyebrow: "",
  title: m.home_title_idle(),
  description: "",
  read: undefined,
  timeline: undefined,
  relative: false,
  actions: [
    { kind: "primary", label: m.action_open_guide(), icon: "none", target: { to: "guide" } },
    { kind: "glass", label: m.nav_recordings(), icon: "none", target: { to: "library" } },
  ],
  art: { title: m.home_title_idle() },
});

const onboardingView = (hasSource: boolean): HeroView => ({
  kind: "onboarding",
  label: m.home_hero_welcome(),
  badges: [],
  eyebrow: "",
  title: hasSource ? m.home_record_series() : m.home_title_onboarding(),
  description: "",
  read: undefined,
  timeline: undefined,
  relative: false,
  // A series recording starts from a programme: Record a series opens the guide, where the
  // programme sheet offers All episodes.
  actions: hasSource
    ? [{ kind: "primary", label: m.action_open_guide(), icon: "none", target: { to: "guide" } }]
    : [{ kind: "primary", label: m.home_add_source(), icon: "add", target: { to: "sources" } }],
  art: undefined,
});

/**
 * The view of one hero state. For several running recordings, `selected` names the switcher's
 * tab; the hero shows that recording in the same layout as a single one.
 */
export const heroView = (hero: Hero, selected: number, context: HeroContext): HeroView => {
  switch (hero.kind) {
    case "onboarding":
      return onboardingView(hero.hasSource);
    case "recording": {
      const entry = hero.items[Math.min(Math.max(0, selected), hero.items.length - 1)];
      return entry === undefined ? idleView() : recordingView(entry, context);
    }
    case "soon":
      return soonView(hero.entry, hero.onAir, context);
    case "continue":
      return continueView(hero.entry, context);
    case "new":
      return newView(hero.entry, context);
    case "live":
      return liveView(hero.programme, context);
    case "idle":
      return idleView();
  }
};
