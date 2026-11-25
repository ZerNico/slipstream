import { Link } from "@tanstack/react-router";
import { useMemo } from "react";
import { epochMs, problemChains, type ReplacedChain, replacedChains } from "@slipstream/domain";
import { m, rerunText, sentenceDay } from "@slipstream/i18n";
import { dismissIssue, restoreIssue, useDismissedIssues } from "~/modules/home/dismissed.ts";
import { Icon } from "~/ui/icon.tsx";
import { CheckIcon, PlayIcon, SuccessIcon } from "~/ui/icons.ts";
import { Wrap } from "~/ui/page.tsx";
import { Button } from "~/ui/primitives/button.tsx";
import { LoadingScope, Sk } from "~/ui/skeleton.tsx";
import { placeholderList } from "~/ui/skeleton-state.ts";
import { ErrorState, ProblemCard } from "~/ui/states.tsx";
import { toast } from "~/ui/toast-manager.ts";
import { useNow } from "~/ui/use-now.ts";
import type { Entry } from "./library.ts";
import { entryProblem, entryProblemText } from "./problem-text.ts";
import { type LibraryData, useLibraryData } from "./queries.ts";
import { RecordingsHeader } from "./recordings-header.tsx";
import { StatusCard } from "./status-card.tsx";

/** A repeat that replaced its damaged original: the chain's card for 24 hours, dismissable. */
function ReplacedCard({
  chain,
  data,
  now,
}: {
  chain: ReplacedChain<Entry>;
  data: LibraryData;
  now: number;
}) {
  const title = m.library_replaced({
    title: chain.repeat.title,
    day: sentenceDay(epochMs(chain.repeat.start), now, data.timeZone),
  });
  return (
    <StatusCard
      tone="ok"
      icon={SuccessIcon}
      title={title}
      actions={
        <Button
          size="sm"
          nativeButton={false}
          render={<Link to="/recordings/r/$id" params={{ id: chain.repeat.id }} />}
        >
          {m.action_details()}
        </Button>
      }
      onDismiss={() => {
        dismissIssue(chain.key);
        toast({ title: m.home_issue_dismissed({ title }), undo: () => restoreIssue(chain.key) });
      }}
    />
  );
}

/** A failed or incomplete recording (one per chain) as an issue card with its fixes. */
function RecordingProblemCard({
  entry,
  data,
  now,
}: {
  entry: Entry;
  data: LibraryData;
  now: number;
}) {
  // Gaps over the whole window read as failed, whatever state the server reported.
  const { failed } = entryProblem(entry);
  return (
    <ProblemCard
      tone={failed ? "err" : "warn"}
      title={
        failed
          ? m.library_failed_title({ title: entry.title })
          : m.library_incomplete_title({ title: entry.title })
      }
      text={rerunText(entry, now, data.timeZone, data.recordings) ?? entryProblemText(entry)}
      actions={
        <>
          {failed ? (
            <Button
              size="sm"
              nativeButton={false}
              render={<Link to="/recordings/r/$id" params={{ id: entry.id }} />}
            >
              {m.action_details()}
            </Button>
          ) : (
            <Button
              size="sm"
              icon={<Icon icon={PlayIcon} size={16} />}
              nativeButton={false}
              render={
                <Link to="/watch/rec/$id" params={{ id: entry.id }} search={{ at: "start" }} />
              }
            >
              {m.library_watch_anyway()}
            </Button>
          )}
        </>
      }
    />
  );
}

/**
 * Recordings › Problems (SPEC §8.4): failed and incomplete recordings as issue cards, one per
 * chain (a damaged recording and its repeats), newest first, with the fix next to the problem
 * and where the search for the repeat stands. A chain whose repeat replaced the damaged
 * recording shows a short-lived ok card instead (recording model §3.7). The count matches the
 * tab and Needs attention.
 */
export function ProblemsPage() {
  const data = useLibraryData();
  const now = useNow(60_000);
  const dismissed = useDismissedIssues();
  const { recordings } = data;
  const problems = useMemo(() => problemChains(recordings), [recordings]);
  const replaced = useMemo(
    () => replacedChains(recordings, now).filter((chain) => !dismissed.has(chain.key)),
    [recordings, now, dismissed],
  );
  // While loading, the list this browser kept already says whether there are problems, so a
  // reload with none draws the empty state under the skeleton, not placeholder cards.
  const known = !data.loading || data.recordings.length > 0;
  return (
    <Wrap>
      <RecordingsHeader data={data} />
      <LoadingScope loading={data.loading}>
        {data.error ? (
          <ErrorState
            title={m.library_error_title()}
            actions={<Button onClick={data.refetch}>{m.action_try_again()}</Button>}
          />
        ) : known && problems.length === 0 && replaced.length === 0 ? (
          <div className="empty">
            <span
              className="mx-auto grid size-18 place-items-center rounded-full bg-ok-soft text-ok-fg"
              aria-hidden="true"
            >
              <Icon icon={CheckIcon} size={24} />
            </span>
            <h2 className="type-h2">
              <Sk>{m.library_problems_none()}</Sk>
            </h2>
          </div>
        ) : (
          <div className="mt-2 grid gap-2.5">
            {!known ? (
              placeholderList(undefined, 3, (index) => index).map((index) => (
                <ProblemCard key={index} tone="warn" title={"0".repeat(28)} text={"0".repeat(72)} />
              ))
            ) : (
              <>
                {replaced.map((chain) => (
                  <ReplacedCard key={chain.key} chain={chain} data={data} now={now} />
                ))}
                {problems.map((entry) => (
                  <RecordingProblemCard key={entry.id} entry={entry} data={data} now={now} />
                ))}
              </>
            )}
          </div>
        )}
      </LoadingScope>
    </Wrap>
  );
}
