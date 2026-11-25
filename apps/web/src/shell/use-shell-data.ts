import { useQuery } from "@tanstack/react-query";
import type { RecordingEntry } from "@slipstream/api";
import { useQueries } from "~/api/hooks.ts";
import { useViewer } from "~/api/viewer.ts";
import { useRememberedCount } from "~/ui/skeleton-state.ts";
import { isProblemRecording } from "@slipstream/domain";

/**
 * The shell's own reads: the problem count on the Recordings tab and the running recordings for
 * the recording pill. Both come from the one recordings list (SPEC §7.9: counts from one source).
 * While the list loads the count is the one this browser saw last, so the tab keeps its width.
 */
export function useShellData(): {
  readonly problems: number;
  readonly lineupProblems: number;
  readonly running: readonly RecordingEntry[];
} {
  const queries = useQueries();
  const { data } = useQuery(queries.recordings());
  const list = data ?? [];
  const problems = useRememberedCount(
    "nav.problems",
    data === undefined ? undefined : list.filter(isProblemRecording).length,
    0,
  );
  return {
    problems,
    lineupProblems: useLineupProblems(),
    running: list.filter((entry) => entry.state === "recording"),
  };
}

/**
 * The lineup's problems, on Settings and its Sources & channels: channels left without a stream
 * (admins only; everything else Needs review lists waits quietly). Remembered like the
 * recordings' count, so the badge keeps its place while the review loads.
 */
export function useLineupProblems(): number {
  const queries = useQueries();
  const { isAdmin } = useViewer();
  const review = useQuery({ ...queries.lineupReview(), enabled: isAdmin });
  return useRememberedCount(
    "nav.lineup-problems",
    !isAdmin ? 0 : review.data?.withoutStreams.length,
    0,
  );
}
