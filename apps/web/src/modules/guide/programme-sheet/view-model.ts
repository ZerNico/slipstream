import type { RecordingEntry } from "@slipstream/api";
import {
  type ChannelId,
  epochMs,
  type ProgrammeId,
  type RecordingId,
  type RepeatRef,
  repeatKind,
} from "@slipstream/domain";
import { m } from "@slipstream/i18n";
import { formatClock, formatDuration, formatTimeRange } from "~/i18n/formats.ts";

/*
 * The programme sheet's words and choices as pure logic: the header and facts lines, and what
 * the sheet says and offers about an episode the viewer already has (recording model §3.1).
 */

/** The parts of a programme's when and where both the header and the facts line show. */
export interface SheetWhen {
  /** The channel's full name ("Serienwelt HD"). */
  readonly channel: string;
  /** The household day as the pills write it ("Today 23"). */
  readonly day: string;
  readonly start: number;
  readonly end: number;
}

/** The header line: "Serienwelt HD · Today 23 · 21:15", the facts line's own start. */
export const sheetContext = (when: SheetWhen): string =>
  [when.channel, when.day, formatClock(when.start)].join(" · ");

/** The facts line: "Serienwelt HD · Today 23 · 21:15–22:00 · 45 min · Krimi". */
export const sheetFacts = (when: SheetWhen, categories: readonly string[]): string =>
  [
    when.channel,
    when.day,
    formatTimeRange(when.start, when.end),
    formatDuration(when.end - when.start),
    ...categories.slice(0, 1),
  ].join(" · ");

/** What phrasing an episode the viewer already has needs from the sheet. */
export interface HadContext {
  /** This airing's channel: the copy's channel is named only when it is another one. */
  readonly channelId: ChannelId;
  /** A moment's household day inside a sentence: "today", "Sun 22". */
  readonly dayAt: (at: number) => string;
  /** A channel's name as rows show it, if known. */
  readonly channelName: (id: ChannelId) => string | undefined;
}

/**
 * "Already recorded Sun 22, 15:00 on ONE", "Already scheduled Tue 24, 21:15" or "You had this
 * episode (recorded Sun 22). It was deleted.", by the domain's `repeatKind` of the copy.
 */
export const hadText = (of: RepeatRef, context: HadContext): string => {
  const at = epochMs(of.start);
  const kind = repeatKind(of);
  if (kind === "deleted") return m.guide_had_deleted({ day: context.dayAt(at) });
  const other = of.channelId === context.channelId ? undefined : context.channelName(of.channelId);
  const values = {
    day: context.dayAt(at),
    time: new Date(at),
    ...(other === undefined ? {} : { channel: other }),
  };
  return kind === "recorded" ? m.guide_had_recorded(values) : m.guide_had_scheduled(values);
};

/** Where the copy's action leads: Play it (a recorded copy) or Show it (the planned airing). */
export type HadTarget =
  | { readonly kind: "play"; readonly recordingId: RecordingId }
  | { readonly kind: "show"; readonly programmeId: ProgrammeId };

/**
 * Play it for a recorded copy; Show it for a scheduled one, which opens that airing's own sheet.
 * An airing only planned so far has no recording id: it is the library entry on that channel at
 * that start. A deleted episode has nothing to open.
 */
export const hadTarget = (
  of: RepeatRef,
  entries: readonly RecordingEntry[],
): HadTarget | undefined => {
  const copy = of.recordingId;
  switch (repeatKind(of)) {
    case "recorded":
      return copy === undefined ? undefined : { kind: "play", recordingId: copy };
    case "scheduled": {
      const at = epochMs(of.start);
      const programmeId = entries.find((candidate) =>
        copy === undefined
          ? candidate.channelId === of.channelId && epochMs(candidate.start) === at
          : candidate.id === copy,
      )?.programmeId;
      return programmeId === undefined ? undefined : { kind: "show", programmeId };
    }
    case "deleted":
      return undefined;
  }
};
