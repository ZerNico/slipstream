import { useQuery } from "@tanstack/react-query";
import { hasReview, reviewSummary } from "@slipstream/domain";
import { m } from "@slipstream/i18n";
import { Fragment, type ReactNode } from "react";
import { useQueries } from "~/api/hooks.ts";
import { formatList } from "~/i18n/formats.ts";
import { Icon, type IconSvgElement } from "~/ui/icon.tsx";
import { AddIcon, LinkIcon, UnlinkIcon } from "~/ui/icons.ts";
import { useOverlay } from "~/ui/overlay/use-overlay.tsx";
import { Button } from "~/ui/primitives/button.tsx";
import { LoadingScope, Sk } from "~/ui/skeleton.tsx";
import { rememberedList } from "~/ui/skeleton-state.ts";
import { toast } from "~/ui/toast-manager.ts";
import { cn } from "~/ui/utils.ts";
import { SettingsSection } from "../parts.tsx";
import { useOpenPicker } from "../stream-picker/open-picker.ts";
import { GoneReviewDialog } from "./gone-dialog.tsx";
import { MergeReviewDialog } from "./merge-dialog.tsx";
import { type CardKind, mergesOf, reviewCards } from "./model.ts";
import { useMarkReviewed, useMerge } from "./queries.ts";

/** One quiet card: an icon, what is waiting, where from, and its actions. */
function ReviewCard({
  icon,
  title,
  detail,
  alert = false,
  children,
}: {
  icon: IconSvgElement;
  title: string;
  detail: ReactNode;
  alert?: boolean;
  children: ReactNode;
}) {
  return (
    <article
      aria-label={title}
      className={cn(
        "panel grid content-between gap-4 p-4",
        alert && "shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--live)_40%,transparent)]",
      )}
    >
      <div className="flex items-start gap-3">
        <span className="grid size-9 flex-none place-items-center rounded-md text-fg-2 shadow-[inset_0_0_0_1px_var(--line-2)]">
          <Icon icon={icon} size={16} />
        </span>
        <span className="grid min-w-0">
          <span className="font-semibold">
            <Sk>{title}</Sk>
          </span>
          <span className="text-meta text-fg-2">
            <Sk>{detail}</Sk>
          </span>
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-1">{children}</div>
    </article>
  );
}

const placeholderCard = (): CardKind => "merge";

/**
 * Needs review (Settings › Sources & channels › Sources): up to three quiet cards above the
 * sources while something waits: channels that look like one channel, new streams, and streams
 * a playlist dropped. Only a channel left without a stream is red. The section is gone when
 * nothing is left; while loading it keeps the room it had last time.
 */
export function NeedsReview() {
  const queries = useQueries();
  const overlay = useOverlay();
  const openPicker = useOpenPicker();
  const review = useQuery(queries.lineupReview());
  const merge = useMerge();
  const reviewed = useMarkReviewed();
  const summary = review.data === undefined ? undefined : reviewSummary(review.data);
  const cards = rememberedList(
    "settings.review",
    summary === undefined ? undefined : reviewCards(summary),
    0,
    placeholderCard,
  );
  const empty = cards.length === 0 || (summary !== undefined && !hasReview(summary));
  const loading = summary === undefined;
  const card = (kind: CardKind) => {
    switch (kind) {
      case "merge":
        return (
          <ReviewCard
            icon={LinkIcon}
            title={m.review_merge_card({
              count: summary?.merge ?? 8,
              sources: summary?.mergeSources ?? 2,
            })}
            detail={formatList(
              [
                ...new Set(
                  (review.data?.mergeSuggestions ?? []).flatMap((suggestion) =>
                    suggestion.channels.flatMap((channel) =>
                      channel.streams.map((stream) => stream.sourceName),
                    ),
                  ),
                ),
              ].slice(0, 3),
            )}
          >
            <Button size="sm" onClick={() => overlay.open({ kind: "dlg", name: "merge-review" })}>
              {m.review_open()}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              busy={merge.isPending}
              onClick={() =>
                merge.mutate(mergesOf(review.data?.mergeSuggestions ?? []), {
                  onSuccess: () => toast({ title: m.review_merged(), type: "success" }),
                  onError: () => toast({ title: m.state_not_saved(), type: "error" }),
                })
              }
            >
              {m.review_merge_all()}
            </Button>
          </ReviewCard>
        );
      case "new": {
        const first = summary?.newSources[0];
        return (
          <ReviewCard
            icon={AddIcon}
            title={m.review_new_card({ count: summary?.newStreams ?? 0 })}
            detail={formatList((summary?.newSources ?? []).map((source) => source.name))}
          >
            <Button
              size="sm"
              disabled={first === undefined}
              onClick={() => {
                if (first !== undefined) openPicker(first.id, { onlyNew: true });
              }}
            >
              {m.review_open()}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              busy={reviewed.isPending}
              onClick={() =>
                reviewed.mutate(
                  (summary?.newSources ?? []).map((source) => source.id),
                  {
                    onError: () => toast({ title: m.state_not_saved(), type: "error" }),
                  },
                )
              }
            >
              {m.review_ignore()}
            </Button>
          </ReviewCard>
        );
      }
      case "gone": {
        const gone = summary?.goneStreams ?? 0;
        const without = summary?.withoutStreams ?? 0;
        return (
          <ReviewCard
            icon={UnlinkIcon}
            alert={without > 0}
            title={
              gone > 0
                ? m.review_gone_card({ count: gone })
                : m.review_no_stream_count({ count: without })
            }
            detail={
              <>
                {formatList(summary?.goneSources ?? [])}
                {gone > 0 && without > 0 ? (
                  <>
                    {summary?.goneSources.length === 0 ? "" : " · "}
                    <span className="text-live-fg">
                      {m.review_no_stream_count({ count: without })}
                    </span>
                  </>
                ) : null}
              </>
            }
          >
            <Button size="sm" onClick={() => overlay.open({ kind: "dlg", name: "gone-review" })}>
              {m.review_open()}
            </Button>
          </ReviewCard>
        );
      }
    }
  };
  return (
    <>
      {empty ? null : (
        <LoadingScope loading={loading}>
          <SettingsSection id="needs-review" title={m.review_heading()}>
            <div className="grid gap-3 md:grid-cols-3">
              {cards.map((kind, index) => (
                <Fragment key={loading ? index : kind}>{card(kind)}</Fragment>
              ))}
            </div>
          </SettingsSection>
        </LoadingScope>
      )}
      {/* Mounted whatever the cards show, so a dialog keeps its rows when the last card goes. */}
      <MergeReviewDialog />
      <GoneReviewDialog />
    </>
  );
}
