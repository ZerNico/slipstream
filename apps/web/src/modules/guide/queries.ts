import {
  keepPreviousData,
  type QueryClient,
  useQueries as useQueryList,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";

import {
  daysAround,
  draftFromRule,
  type GuideDay,
  type GuideEntry,
  type GuideRepeat,
  previewInput,
  previewUntil,
  type ProgrammeId,
  recordedCount,
  requestWindow,
  type Rule,
  toRuleInput,
} from "@slipstream/domain";
import { m } from "@slipstream/i18n";
import { useApi, useQueries } from "~/api/hooks.ts";
import { keys } from "~/api/queries.ts";

/** The guide's own cache keys, beside the shared tree in `~/api/queries.ts`. */
export const guideKeys = {
  programme: (id: ProgrammeId) => ["programmes", "detail", id] as const,
};

/** Each day's answer of a per-day read, by day key, and the days whose answer is in. */
interface DayAnswers<A> {
  readonly byDay: readonly (readonly A[] | undefined)[];
  readonly error: Error | null;
}

/** The per-day reads as one: their answers in day order and the first error. */
const dayAnswers = <A>(
  results: readonly { readonly data: readonly A[] | undefined; readonly error: Error | null }[],
): DayAnswers<A> => ({
  byDay: results.map((result) => result.data),
  error: results.find((result) => result.error !== null)?.error ?? null,
});

/**
 * Every read the guide page makes. The programmes and the airings the viewer already has load
 * per household day: the day in view (`focus`) and its neighbours, so scrolling finds the next
 * day there; a day once loaded stays (TanStack's cache), and one loaded earlier still shows.
 * How far the data reaches comes first and alone, so the timeline has its width at once.
 * Recordings and conflicts are one read each. The day-bound reads wait until the days are real
 * household days (`settled`), so no day is asked twice.
 */
export function useGuideData(
  days: readonly GuideDay[],
  focus: string | undefined,
  settled: boolean,
) {
  const queries = useQueries();
  const channels = useQuery(queries.channels());
  const extent = useQuery({ ...queries.guideExtent(), enabled: settled });
  const recordings = useQuery(queries.recordings());
  const span = requestWindow(days);
  // Kept while the window moves (a new day at midnight): a pending read here would turn the
  // whole guide back into its skeleton for a moment.
  const conflicts = useQuery({
    ...queries.conflicts(span.from, span.to),
    placeholderData: keepPreviousData,
    enabled: settled,
  });
  const wanted = new Set(daysAround(days, focus).map((day) => day.key));
  const programmes = useQueryList({
    queries: days.map((day) => ({
      ...queries.guideWindow(day.start, day.end),
      enabled: settled && wanted.has(day.key),
    })),
    // Module-level, so TanStack combines again only when an answer changes.
    combine: dayAnswers<GuideEntry>,
  });
  const repeats = useQueryList({
    queries: days.map((day) => ({
      ...queries.guideRepeats(day.start, day.end),
      enabled: settled && wanted.has(day.key),
    })),
    combine: dayAnswers<GuideRepeat>,
  });
  return { channels, extent, recordings, conflicts, programmes, repeats };
}

/**
 * The server's record options for a programme: what recording it would make, where it would
 * go, and with which extra time. The server's answer is the only source.
 */
export function useRecordOptions(id: ProgrammeId) {
  return useQuery(useQueries().recordOptions(id));
}

/**
 * One programme by id, in full (description, pictures), for the sheet: the guide's own answer
 * carries only what its cells show. The sheet waits for the record options in parallel, so
 * this adds no wait of its own.
 */
export function useProgramme(id: ProgrammeId) {
  const api = useApi();
  return useQuery({
    queryKey: guideKeys.programme(id),
    queryFn: () => api.call((c) => c.guide.programme({ params: { programmeId: id } })),
  });
}

/** Marks the record options stale after the sheet changed something. */
export function useInvalidateRecordOptions(): () => Promise<void> {
  const client = useQueryClient();
  return () => client.invalidateQueries({ queryKey: keys.programmes });
}

/**
 * A saved series recording's preview, asked exactly as its editor and the editor's route ask
 * (same input, same horizon), so the sheet and the editor read one cached answer.
 */
const savedRulePreview = (queries: ReturnType<typeof useQueries>, rule: Rule) =>
  queries.rulePreview(
    previewInput(toRuleInput(draftFromRule(rule), rule.padding), m.series_new()),
    previewUntil(Date.now()),
  );

/**
 * How many airings a series recording will record: the series preview's count
 * (`recordedCount`), the one definition the sheet's "6 will record", its toast and the series
 * recording editor share. Undefined while it is being asked.
 */
export function useWillRecord(rule: Rule): number | undefined {
  const preview = useQuery(savedRulePreview(useQueries(), rule));
  return preview.data === undefined ? undefined : recordedCount(preview.data.matches);
}

/** The same count, read once (for the toast after Record series); undefined when it failed. */
export const fetchWillRecord = async (
  client: QueryClient,
  queries: ReturnType<typeof useQueries>,
  rule: Rule,
): Promise<number | undefined> => {
  try {
    return recordedCount((await client.fetchQuery(savedRulePreview(queries, rule))).matches);
  } catch {
    return undefined;
  }
};
