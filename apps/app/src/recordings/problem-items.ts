import type { RecordingEntry } from "@slipstream/api";
import { epochMs, problemChains, replacedChains } from "@slipstream/domain";
import { m, sentenceDay } from "@slipstream/i18n";
import { householdZone } from "../data/zone.ts";
import type { PlayTarget } from "../player/playback.ts";
import { problemLine } from "../data/recording-text.ts";

/** One item of the Problems list, phone and TV. */
export type ProblemItem =
  | {
      readonly kind: "problem";
      readonly key: string;
      readonly entry: RecordingEntry;
      /** Nothing usable was captured: only its details help. */
      readonly failed: boolean;
      readonly title: string;
      /** What is missing, and where the search for the repeat stands. */
      readonly text: string;
    }
  | {
      readonly kind: "replaced";
      readonly key: string;
      /** The repeat that took the damaged recording's place. */
      readonly entry: RecordingEntry;
      readonly title: string;
    };

/**
 * The web's Problems page as a list: a repeat that replaced its damaged original within the
 * day first, then one item per chain (a damaged recording and its repeats), newest first, each
 * titled as failed or incomplete, with the problem and the repeat's state in one line.
 */
export const problemItems = (
  entries: readonly RecordingEntry[],
  now: number,
): readonly ProblemItem[] => [
  ...replacedChains(entries, now).map((chain): ProblemItem => ({
    kind: "replaced",
    key: chain.key,
    entry: chain.repeat,
    title: m.library_replaced({
      title: chain.repeat.title,
      day: sentenceDay(epochMs(chain.repeat.start), now, householdZone()),
    }),
  })),
  ...problemChains(entries).map((entry): ProblemItem => {
    const problem = problemLine(entry, entries, now);
    const failed = problem?.failed ?? false;
    return {
      kind: "problem",
      key: entry.id,
      entry,
      failed,
      title: failed
        ? m.library_failed_title({ title: entry.title })
        : m.library_incomplete_title({ title: entry.title }),
      text: problem?.text ?? "",
    };
  }),
];

/** "Watch anyway": an incomplete recording from its start, gaps and all. */
export const watchAnyway = (entry: Pick<RecordingEntry, "id">): PlayTarget => ({
  _tag: "Recording",
  recordingId: entry.id,
  from: "start",
});
