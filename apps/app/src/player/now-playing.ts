import { epochMs, type GuideEntry, programmeAt, rowsByChannel } from "@slipstream/domain";
import { formatters, m } from "@slipstream/i18n";
import type { PlayTarget } from "./playback.ts";

/*
 * What the player says it plays (phone and TV): the programme at the playhead, not the one on air
 * now, so watching from behind live names what is on screen and changes when the playhead moves
 * into the next programme. A recording names itself.
 */

/** The fields of a programme (a guide entry, a recording) the player names it by. */
export type PlayingSubject = Pick<GuideEntry, "title" | "subtitle" | "episode" | "start" | "end">;

/** The top bar's two lines. */
export interface NowPlaying {
  /** The programme's title, or the channel's name when the guide has nothing there. */
  readonly title: string;
  /** "Episode 4 · The Return · Das Erste · 20:15–21:45", whatever of it is known. */
  readonly line: string;
}

/** "Episode 4 · The Return", the episode subtitle alone, or nothing. */
const episodeText = (subject: PlayingSubject): string | undefined => {
  const episode = subject.episode?.episode;
  if (episode !== undefined) {
    return m.path_episode(
      subject.subtitle === undefined ? { episode } : { episode, subtitle: subject.subtitle },
    );
  }
  return subject.subtitle;
};

/**
 * The programme the player shows at `atMs` on the wall clock: a recording is its own programme;
 * live and a captured range take the channel's guide entry airing there.
 */
export const playingSubject = (input: {
  readonly target: PlayTarget;
  readonly atMs: number;
  readonly programmes: readonly GuideEntry[];
  readonly recording: PlayingSubject | undefined;
}): PlayingSubject | undefined => {
  const { target } = input;
  if (target._tag === "Recording") return input.recording;
  const row = rowsByChannel(input.programmes).get(target.channelId) ?? [];
  return programmeAt(row, input.atMs);
};

/** The title and the line under it for the programme playing on `channelName`. */
export const nowPlaying = (
  subject: PlayingSubject | undefined,
  channelName: string | undefined,
): NowPlaying => {
  const channel = channelName !== undefined && channelName.length > 0 ? channelName : undefined;
  if (subject === undefined) return { title: channel ?? "", line: "" };
  const slot = formatters().timeRange(
    new Date(epochMs(subject.start)),
    new Date(epochMs(subject.end)),
  );
  const parts = [episodeText(subject), channel, slot].filter(
    (part): part is string => part !== undefined && part.length > 0,
  );
  return { title: subject.title, line: parts.join(" · ") };
};
