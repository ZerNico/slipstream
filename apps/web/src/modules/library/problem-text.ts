import {
  durationMillis,
  epochMs,
  type RecordingGap,
  recordingGapSummary,
} from "@slipstream/domain";
import { m } from "@slipstream/i18n";
import { type Entry } from "./library.ts";

/** One missing stretch in words, by the cause the domain's gap summary gives it. */
const gapText = ({ range, cause, retries }: RecordingGap): string => {
  const from = new Date(epochMs(range.start));
  const to = new Date(epochMs(range.end));
  switch (cause) {
    case "SourceLimitReached":
      return m.problem_limit({ from, to });
    case "SourceUnreachable":
      return m.problem_unreachable({ from, to, retries });
    case "Gap":
      return m.problem_gap({ seconds: durationMillis(range) / 1000, from, to });
  }
};

/**
 * What went wrong with a recording (SPEC §8.4), ready to show.
 *
 * - `failed`: nothing usable was captured: the recording failed, the source sent no data, or
 *   the gaps cover the whole window. It then reads as a failed recording, whatever its state.
 * - `lines`: one sentence per missing stretch, merged and in time order (or the failed copy).
 * - `total`: how much is missing in all, when there is more than one stretch.
 * - `missingMs`: the summary's missing time, for lines that quote it without reading it again.
 */
export interface ProblemCopy {
  readonly failed: boolean;
  readonly lines: readonly string[];
  readonly total: string | undefined;
  readonly missingMs: number;
}

/**
 * Phrases a recording's gap summary (`recordingGapSummary`, the one reading every client shares):
 * the merged stretches with their causes, and the total Home quotes for the same recording.
 */
export const entryProblem = (entry: Entry): ProblemCopy => {
  const summary = recordingGapSummary(entry);
  const { missingMs } = summary;
  if (summary.failed)
    return { failed: true, lines: [m.problem_no_data()], total: undefined, missingMs };
  return {
    failed: false,
    missingMs,
    lines: summary.gaps.map(gapText),
    total:
      summary.gaps.length > 1
        ? m.problem_missing_total({ gaps: summary.gaps.length, seconds: summary.missingMs / 1000 })
        : undefined,
  };
};

/** The problem as one text, for issue cards: the stretch, or the total when there are several. */
export const entryProblemText = (entry: Entry): string => {
  const copy = entryProblem(entry);
  return copy.total ?? copy.lines[0] ?? m.problem_no_data();
};
