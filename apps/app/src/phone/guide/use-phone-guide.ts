import {
  epochMs,
  gridWindow,
  guideDays,
  programmeMarks,
  rowsByChannel,
  visibleChannels,
} from "@slipstream/domain";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { useApiQueries, useGuideWindow, useHouseholdDays } from "../../data/hooks.ts";

/**
 * The phone guide's data, as the web's timeline has it: {@link useGuideWindow} over the
 * household's days from today, around the day in view (`shownDay`; today until the grid reports
 * one), as rows and marks. The grid is as wide as the server's guide data reaches
 * (`GET /guide/extent`), so it never grows while the days load.
 */
export const usePhoneGuide = (now: number, shownDay: string | undefined) => {
  const queries = useApiQueries();
  const { days, today } = useHouseholdDays(now, guideDays);
  const window = useGuideWindow(days, shownDay ?? today);
  const extent = useQuery(queries.guideExtent());
  const dataEnd = extent.data?.end === undefined ? undefined : epochMs(extent.data.end);
  const derived = useMemo(
    () => ({
      channels: visibleChannels(window.channels),
      rows: rowsByChannel(window.programmes),
      marks: programmeMarks(window.recordings, window.conflicts, window.programmes, window.repeats),
      window: gridWindow(days, dataEnd),
    }),
    [
      window.channels,
      window.programmes,
      window.repeats,
      window.recordings,
      window.conflicts,
      days,
      dataEnd,
    ],
  );
  return {
    ...derived,
    days,
    pending: window.pending,
    recordings: window.recordings,
    conflicts: window.conflicts,
    loading: window.loading || extent.isPending,
    error: window.error ?? extent.error,
    retry: () => {
      window.retry();
      void extent.refetch();
    },
  };
};
