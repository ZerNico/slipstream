import type { ScheduleConflict } from "@slipstream/api";
import {
  type Channel,
  type ChannelId,
  channelMark,
  epochMs,
  type GuideEntry,
  type GuideRepeat,
  type MarkState,
  type ProgrammeMark,
  type ProgrammeId,
  programmeMarks,
  type Recording,
  type RepeatKind,
  repeatKind,
  visibleChannels,
} from "@slipstream/domain";
import { m } from "@slipstream/i18n";
import {
  makeGuide,
  type Guide,
  type GuideChannel,
  type GuideProgramme,
} from "../tv/guide/core/index.ts";

/**
 * A programme as the guide shows it. Times are epoch ms for the cursor. The description and
 * pictures are not here: the guide loads them for the focused programme (`queries.programme`).
 */
export interface AppProgramme extends GuideProgramme {
  readonly programmeId: ProgrammeId;
  readonly channelId: ChannelId;
  readonly title: string;
  readonly subtitle: string | undefined;
  readonly live: boolean;
  readonly mark: MarkState | undefined;
  /**
   * With the quiet `repeat` mark: the domain's `repeatKind` of the viewer's copy (recorded,
   * scheduled or deleted), for the cell's label ("already recorded" / "already scheduled").
   */
  readonly already: RepeatKind | undefined;
  /** The guide entry itself, for the record sheet ("Record series" needs its episode data). */
  readonly source: GuideEntry;
}

/** What the `repeat` mark says about the viewer's copy: the domain's `repeatKind` of it. */
export const alreadyFor = (mark: ProgrammeMark | undefined): RepeatKind | undefined =>
  mark?.state === "repeat" ? repeatKind(mark.of) : undefined;

/**
 * What a cell says to a screen reader: its title, and for an airing the viewer already has,
 * "already scheduled", else "already recorded" (a deleted copy was recorded once too); the
 * quiet check says it visually.
 */
export const cellLabel = (programme: Pick<AppProgramme, "title" | "already">): string =>
  programme.already === undefined
    ? programme.title
    : `${programme.title}, ${programme.already === "scheduled" ? m.guide_state_had_scheduled() : m.guide_state_had_recorded()}`;

/** Channel name and logo beside the guide rows. */
export interface ChannelInfo {
  readonly name: string;
  /** Short text for the logo tile when there is no logo image. */
  readonly mark: string;
}

/** The recordings, conflicts and repeats the guide marks programmes with. */
export interface GuideMarks {
  readonly recordings: readonly Recording[];
  readonly conflicts: readonly ScheduleConflict[];
  /** Airings this profile already has, from `GET /guide/repeats` for the loaded window. */
  readonly repeats: readonly GuideRepeat[];
}

/**
 * Builds the guide the cursor runs on from API data: one row per visible channel, programmes
 * as epoch-ms cells, each marked from the scheduled and running recordings, the conflicts and
 * the airings the profile already has (the quiet check).
 * Channels without a number get -1, so digit entry never lands on them by accident.
 */
export const buildGuide = (
  channels: readonly Channel[],
  programmes: readonly GuideEntry[],
  marks: GuideMarks,
): { readonly guide: Guide<AppProgramme>; readonly info: ReadonlyMap<string, ChannelInfo> } => {
  const marked = programmeMarks(marks.recordings, marks.conflicts, programmes, marks.repeats);
  const perChannel = new Map<string, AppProgramme[]>();
  for (const programme of programmes) {
    const mark = marked.get(programme.id);
    const cell: AppProgramme = {
      id: programme.id,
      programmeId: programme.id,
      channelId: programme.channelId,
      start: epochMs(programme.start),
      end: epochMs(programme.end),
      title: programme.title,
      subtitle: programme.subtitle,
      live: programme.live,
      mark: mark?.state,
      already: alreadyFor(mark),
      source: programme,
    };
    const row = perChannel.get(programme.channelId);
    if (row === undefined) perChannel.set(programme.channelId, [cell]);
    else row.push(cell);
  }
  const visible = visibleChannels(channels);
  const rows: GuideChannel<AppProgramme>[] = visible.map((channel) => ({
    id: channel.id,
    number: channel.number ?? -1,
    programmes: perChannel.get(channel.id) ?? [],
  }));
  const info = new Map<string, ChannelInfo>(
    visible.map((channel) => [channel.id, { name: channel.name, mark: channelMark(channel.name) }]),
  );
  return { guide: makeGuide(rows), info };
};

/** What {@link guideReady} weighs. */
export interface GuideProgress {
  /** The channels, recordings or conflicts have not answered yet. */
  readonly marksPending: boolean;
  /** The days whose programmes and repeat marks are in. */
  readonly loaded: ReadonlySet<string>;
  /** The day in view (a day key). */
  readonly focus: string;
  /** A day's request failed: the screen says so instead of waiting. */
  readonly failed: boolean;
  /** The guide was ready once already. */
  readonly settled: boolean;
}

/**
 * Whether a guide can replace its skeleton: the channels and marks are in and the day in view
 * has answered. Another day answering first (yesterday's, often empty) is not enough: the grid
 * would show nothing at now and then fill. Once ready it stays ready, so a day still loading
 * later draws skeleton cells in its stretch instead of hiding the grid.
 */
export const guideReady = (progress: GuideProgress): boolean =>
  !progress.marksPending &&
  (progress.settled || progress.failed || progress.loaded.has(progress.focus));
