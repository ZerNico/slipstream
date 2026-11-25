import type { RecordingEntry } from "@slipstream/api";
import {
  epochMs,
  type RangedProblemTag,
  recordingGapSummary,
  type RecordingGapSummary,
} from "@slipstream/domain";
import { conflictText, conflictTitle, m, rerunText, sentenceDay } from "@slipstream/i18n";
import type { Issue } from "./attention.ts";
import type { IssueAction, IssueText } from "./shape.ts";

/** What a recording issue needs from the recording. */
type IssueRecording = Pick<
  RecordingEntry,
  "id" | "title" | "state" | "problems" | "start" | "end" | "padding" | "rerun" | "protected"
>;

/**
 * Why most of a recording is missing: the cause that accounts for the most missing time, the
 * more telling one on a tie (every stream busy, then unreachable, then a plain gap).
 */
const dominantCause = (summary: RecordingGapSummary): RangedProblemTag | undefined => {
  const byCause = new Map<RangedProblemTag, number>();
  for (const gap of summary.gaps) {
    const length = epochMs(gap.range.end) - epochMs(gap.range.start);
    byCause.set(gap.cause, (byCause.get(gap.cause) ?? 0) + length);
  }
  const order: readonly RangedProblemTag[] = ["SourceLimitReached", "SourceUnreachable", "Gap"];
  return order.reduce<RangedProblemTag | undefined>(
    (best, cause) =>
      (byCause.get(cause) ?? 0) > (best === undefined ? 0 : (byCause.get(best) ?? 0))
        ? cause
        : best,
    undefined,
  );
};

/**
 * Where the search for the repeat of a damaged series recording stands, as the card's text
 * (recording model §3.7): "Recording the repeat Wed 25, 22:00", "Looking for a repeat until
 * Sun 6", "No repeat found", "Repeat recorded too".
 */
const rerunIssueText = (
  entry: IssueRecording,
  now: number,
  timeZone: string | undefined,
  repeatAt: number | undefined,
): string | undefined => {
  if (entry.rerun?.state === "scheduled") {
    return repeatAt === undefined
      ? undefined
      : m.home_issue_rerun_scheduled({
          day: sentenceDay(repeatAt, now, timeZone),
          start: new Date(repeatAt),
        });
  }
  return rerunText(entry, now, timeZone);
};

/**
 * What a problem recording says on Home, from the one reading every client shows
 * (`recordingGapSummary`, SPEC §8.4). Failed (nothing usable captured, whatever its state):
 * every stream busy, or no picture with the retries made. Incomplete: one sentence over all
 * its gaps, merged and clipped so no report counts twice ("Missing 1 h 25 min in 3 places."),
 * then why, when the source and not a plain gap is to blame. A series recording's damaged
 * recording says instead where the search for its repeat stands ("Tatort had gaps · Recording
 * the repeat Wed 25, 22:00 instead"), so its card keeps its place while the text follows.
 */
export const recordingIssueText = (
  entry: IssueRecording,
  when: {
    readonly now: number;
    readonly timeZone: string | undefined;
    /** When the repeat that replaces it airs, epoch ms, while one is scheduled. */
    readonly repeatAt?: number | undefined;
  },
): { readonly failed: boolean; readonly title: string; readonly text: string } => {
  const summary = recordingGapSummary(entry);
  const cause = dominantCause(summary);
  const rerun = rerunIssueText(entry, when.now, when.timeZone, when.repeatAt);
  if (rerun !== undefined) {
    return {
      failed: summary.failed,
      title: summary.failed
        ? m.library_failed_title({ title: entry.title })
        : m.home_issue_gaps_title({ title: entry.title }),
      text: rerun,
    };
  }
  if (summary.failed) {
    const retries = summary.gaps.reduce((sum, gap) => sum + gap.retries, 0);
    return {
      failed: true,
      title: m.library_failed_title({ title: entry.title }),
      text:
        cause === "SourceLimitReached"
          ? m.home_issue_failed_limit()
          : m.home_issue_no_picture({ retries }),
    };
  }
  const missing = m.home_issue_missing({
    seconds: Math.round(summary.missingMs / 1000),
    places: summary.gaps.length,
  });
  const why =
    cause === "SourceLimitReached"
      ? m.home_issue_cause_limit()
      : cause === "SourceUnreachable"
        ? m.home_issue_cause_unreachable()
        : undefined;
  return {
    failed: false,
    title: m.library_incomplete_title({ title: entry.title }),
    text: why === undefined ? missing : `${missing} ${why}`,
  };
};

/** The statement title and the explanation of one issue (SPEC §1.6: the fix next to it). */
export const issueText = (
  issue: Issue,
  now: number,
  timeZone: string,
): { title: string; text: string } => {
  switch (issue.kind) {
    case "conflict": {
      const { range } = issue.conflict;
      return {
        title: conflictTitle(epochMs(range.start), now, timeZone),
        text: conflictText({
          count: issue.conflict.recordingIds.length,
          from: epochMs(range.start),
          to: epochMs(range.end),
          room: issue.room,
          titles: issue.titles,
        }),
      };
    }
    case "source":
      return issue.source.health === "unreachable"
        ? {
            title: m.home_issue_source({ name: issue.source.name }),
            text: "",
          }
        : {
            title: m.home_issue_source_limit({ name: issue.source.name }),
            text: "",
          };
    case "recording": {
      const { title, text } = recordingIssueText(issue.entry, {
        now,
        timeZone,
        repeatAt: issue.repeatAt,
      });
      return { title, text };
    }
    case "replaced":
      return {
        title: m.library_replaced({
          title: issue.chain.repeat.title,
          day: sentenceDay(epochMs(issue.chain.repeat.start), now, timeZone),
        }),
        text: "",
      };
  }
};

/** The fix next to an issue. */
export const issueActions = (issue: Issue): readonly IssueAction[] => {
  switch (issue.kind) {
    case "conflict":
      return [{ label: m.home_issue_resolve(), target: { to: "scheduled" } }];
    case "source":
      return [{ label: m.source_test(), target: { to: "sources" } }];
    case "recording":
      return !recordingGapSummary(issue.entry).failed
        ? [{ label: m.library_watch_anyway(), target: { to: "choice", id: issue.entry.id } }]
        : [{ label: m.action_details(), target: { to: "detail", id: issue.entry.id } }];
    case "replaced":
      return [{ label: m.action_details(), target: { to: "detail", id: issue.chain.repeat.id } }];
  }
};

/** Everything one attention card says, as the card and the remembered layout both use it. */
export const issueView = (issue: Issue, now: number, timeZone: string): IssueText => ({
  tone: issue.tone,
  glyph:
    issue.kind === "source"
      ? "server"
      : issue.kind === "replaced"
        ? "check"
        : issue.kind === "recording" && issue.tone === "err"
          ? "failed"
          : "warning",

  ...issueText(issue, now, timeZone),
  actions: issueActions(issue),
});
