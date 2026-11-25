import { useQuery } from "@tanstack/react-query";
import type { MergeSuggestionView } from "@slipstream/api";
import { channelMark, type MatchReason, suggestionGroups, suggestionKey } from "@slipstream/domain";
import { m } from "@slipstream/i18n";
import { useState } from "react";
import { useQueries } from "~/api/hooks.ts";
import { ChannelLogo } from "~/ui/artwork/artwork.tsx";
import { Dialog } from "~/ui/dialog.tsx";
import { Icon } from "~/ui/icon.tsx";
import { CheckIcon, MinusIcon } from "~/ui/icons.ts";
import { useOverlay, useOverlayBinding } from "~/ui/overlay/use-overlay.tsx";
import { Button } from "~/ui/primitives/button.tsx";
import { toast } from "~/ui/toast-manager.ts";
import { cn } from "~/ui/utils.ts";
import { mergeOf, mergesOf } from "./model.ts";
import { type MergeInput, useKeepApart, useMerge, useReviewQueries } from "./queries.ts";

/** What became of a suggestion in this dialog. */
type Outcome = "merged" | "apart";

const notSaved = () => toast({ title: m.state_not_saved(), type: "error" });

/** "2 series recordings and 14 recordings move to ZDF", from the merge preview. */
function MovesLine({ merge }: { merge: MergeInput }) {
  const queries = useReviewQueries();
  const preview = useQuery(queries.mergePreview(merge.keepId, merge.otherIds));
  return (
    <span className="block min-h-5 truncate text-caption text-fg-3">
      {preview.data === undefined
        ? " "
        : m.review_moves({
            series: preview.data.seriesRecordings,
            recordings: preview.data.recordings,
            name: preview.data.keep.name,
          })}
    </span>
  );
}

/**
 * One suggestion: the channel kept (logo and name), every stream it would have in fallback
 * order with its source, what moves, and Not the same and Merge. Once decided, the outcome
 * takes the buttons' place at the same height.
 */
function SuggestionRow({
  suggestion,
  outcome,
  busy,
  onMerge,
  onApart,
}: {
  suggestion: MergeSuggestionView;
  outcome: Outcome | undefined;
  busy: boolean;
  onMerge: () => void;
  onApart: () => void;
}) {
  const [keep] = suggestion.channels;
  const merge = mergeOf(suggestion);
  if (keep === undefined || merge === undefined) return null;
  const streams = suggestion.channels.flatMap((channel) => channel.streams);
  return (
    <li
      className={cn(
        "grid grid-cols-[auto_minmax(0,1fr)] items-start gap-x-3 gap-y-2 px-4 py-3 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-center",
        outcome !== undefined && "text-fg-3",
      )}
    >
      <ChannelLogo
        mark={channelMark(keep.name)}
        size="sm"
        {...(keep.logoUrl === undefined ? {} : { logoUrl: keep.logoUrl })}
      />
      <div className="grid min-w-0 gap-0.5">
        <span className={cn("truncate font-semibold", outcome === undefined && "text-fg")}>
          {keep.name}
        </span>
        <ol className="grid gap-0.5">
          {streams.map((stream, index) => (
            <li
              key={`${stream.sourceName}:${stream.name}`}
              className="flex min-w-0 gap-2 text-meta"
            >
              <span className="grid size-4.5 flex-none place-items-center rounded-full text-[11px] tabular-nums shadow-[inset_0_0_0_1px_var(--line-2)]">
                {index + 1}
              </span>
              <span className={cn("truncate", outcome === undefined && "text-fg")}>
                {stream.name}
              </span>
              <span className="flex-none text-fg-3">{stream.sourceName}</span>
            </li>
          ))}
        </ol>
        {outcome === undefined ? <MovesLine merge={merge} /> : <span className="min-h-5" />}
      </div>
      <div className="col-start-2 flex min-h-9 items-center gap-1 sm:col-start-3 sm:justify-end">
        {outcome === "merged" ? (
          <span className="flex items-center gap-2 px-3 text-meta" role="status">
            <Icon icon={CheckIcon} size={16} className="text-ok-fg" />
            {m.review_merged()}
          </span>
        ) : outcome === "apart" ? (
          <span className="flex items-center gap-2 px-3 text-meta" role="status">
            <Icon icon={MinusIcon} size={16} />
            {m.review_kept_apart()}
          </span>
        ) : (
          <>
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              aria-label={m.review_not_same_named({ name: keep.name })}
              onClick={onApart}
            >
              {m.review_not_same()}
            </Button>
            <Button
              size="sm"
              disabled={busy}
              aria-label={m.review_merge_named({ name: keep.name })}
              onClick={onMerge}
            >
              {m.review_merge()}
            </Button>
          </>
        )}
      </div>
    </li>
  );
}

const groupTitle = (reason: MatchReason) =>
  reason === "sameGuide" ? m.review_group_same_guide() : m.review_group_similar();

/** The dialog's body, mounted while it is open: the suggestions as they were when it opened. */
function MergeBody({
  suggestions,
  onDone,
}: {
  suggestions: readonly MergeSuggestionView[];
  onDone: () => void;
}) {
  // The suggestions as they were on opening: a decided row keeps its place with its outcome.
  const [shown] = useState(suggestions);
  const [outcomes, setOutcomes] = useState<ReadonlyMap<string, Outcome>>(new Map());
  const merge = useMerge();
  const apart = useKeepApart();
  const busy = merge.isPending || apart.isPending;
  const decide = (keys: readonly string[], outcome: Outcome) =>
    setOutcomes((before) => new Map([...before, ...keys.map((key) => [key, outcome] as const)]));
  const open = (list: readonly MergeSuggestionView[]) =>
    list.filter((suggestion) => !outcomes.has(suggestionKey(suggestion)));
  const mergeAll = (list: readonly MergeSuggestionView[]) =>
    merge.mutate(mergesOf(list), {
      onSuccess: () => decide(list.map(suggestionKey), "merged"),
      onError: notSaved,
    });
  const undecided = open(shown);
  return (
    <>
      <div className="grid gap-5 p-4 sm:p-5.5">
        <p className="-mt-2 text-meta text-fg-2">{m.review_suggestions({ count: shown.length })}</p>
        {suggestionGroups(shown).map((group) => {
          const left = open(group.suggestions);
          return (
            <section
              key={group.reason}
              className="grid gap-2"
              aria-label={groupTitle(group.reason)}
            >
              <header className="flex min-h-9 items-center gap-2 px-1">
                <h3 className="type-eyebrow">{groupTitle(group.reason)}</h3>
                <span className="text-caption text-fg-3 tabular-nums">
                  {group.suggestions.length}
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  className={cn("ml-auto", left.length === 0 && "invisible")}
                  disabled={busy || left.length === 0}
                  onClick={() => mergeAll(left)}
                >
                  {m.review_merge_count({ count: Math.max(1, left.length) })}
                </Button>
              </header>
              <ul className="panel divide-y divide-line overflow-hidden">
                {group.suggestions.map((suggestion) => {
                  const key = suggestionKey(suggestion);
                  return (
                    <SuggestionRow
                      key={key}
                      suggestion={suggestion}
                      outcome={outcomes.get(key)}
                      busy={busy}
                      onMerge={() => mergeAll([suggestion])}
                      onApart={() =>
                        apart.mutate(
                          suggestion.channels.map((channel) => channel.id),
                          { onSuccess: () => decide([key], "apart"), onError: notSaved },
                        )
                      }
                    />
                  );
                })}
              </ul>
            </section>
          );
        })}
      </div>
      <div className="sticky bottom-0 flex items-center justify-end gap-2 border-t border-line bg-surface px-4 py-3 sm:px-5.5">
        <Button variant="ghost" onClick={onDone}>
          {m.action_done()}
        </Button>
        <Button
          variant="primary"
          className={cn(undecided.length === 0 && "invisible")}
          busy={merge.isPending}
          disabled={busy || undecided.length === 0}
          onClick={() => mergeAll(undecided)}
        >
          {m.review_merge_count({ count: Math.max(1, undecided.length) })}
        </Button>
      </div>
    </>
  );
}

/**
 * `?dlg=merge-review`: channels that look like one channel, grouped by how sure the match is
 * ("Same guide channel", then "Similar name"). Each row merges into the channel the lineup had
 * first (its number, rules and recordings stay) or is kept apart for good.
 */
export function MergeReviewDialog() {
  const binding = useOverlayBinding("dlg", "merge-review");
  const overlay = useOverlay();
  const queries = useQueries();
  const review = useQuery({ ...queries.lineupReview(), enabled: binding.open });
  return (
    <Dialog
      open={binding.open && review.data !== undefined}
      onOpenChange={binding.onOpenChange}
      label={m.review_merge_title()}
      showTitle
    >
      {review.data === undefined ? null : (
        <MergeBody suggestions={review.data.mergeSuggestions} onDone={() => void overlay.close()} />
      )}
    </Dialog>
  );
}
