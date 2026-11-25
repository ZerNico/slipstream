import { useQuery } from "@tanstack/react-query";
import type { GuideChannelView } from "@slipstream/api";
import type { Channel } from "@slipstream/domain";
import { m } from "@slipstream/i18n";
import { useRef, useState } from "react";
import { useUpdateChannel } from "~/api/mutations.ts";
import { SearchField } from "~/ui/controls.tsx";
import { Dialog } from "~/ui/dialog.tsx";
import { Icon } from "~/ui/icon.tsx";
import { CheckIcon } from "~/ui/icons.ts";
import { toast } from "~/ui/toast-manager.ts";
import { useDebouncedValue } from "~/ui/use-debounced-value.ts";
import { cn } from "~/ui/utils.ts";
import { useLineupQueries } from "./queries.ts";

/** Why a suggestion fits, in a few words. */
const reasonText = (option: GuideChannelView): string | undefined => {
  switch (option.reason) {
    case "sameGuide":
      return m.lineup_guide_same_id();
    case "similarName":
      return m.lineup_guide_similar();
    case undefined:
      return option.channels > 0 ? m.lineup_guide_used({ count: option.channels }) : undefined;
  }
};

const optionKey = (option: GuideChannelView) => `${option.sourceId}:${option.xmltvId}`;

/** "No guide": the channel shows without programmes. */
function NoGuideOption({ current, onPick }: { current: boolean; onPick: () => void }) {
  return (
    <li>
      <button
        type="button"
        aria-current={current || undefined}
        className={cn(
          "grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 rounded-md px-3 py-2 text-left",
          "fine:hover:bg-hover focus-visible:outline-2 focus-visible:outline-focus",
          current && "bg-selected",
        )}
        onClick={onPick}
      >
        <span className="min-w-0 truncate font-semibold">{m.guide_none_option()}</span>
        <span className="row-span-2 flex items-center">
          {current ? <Icon icon={CheckIcon} size={16} className="text-brand-fg" /> : null}
        </span>
        <span className="min-w-0 truncate text-meta text-fg-2">{m.guide_none_hint()}</span>
      </button>
    </li>
  );
}

/** One guide channel to pick: its name, its id, and why it fits or who uses it. */
function GuideOption({
  option,
  current,
  onPick,
}: {
  option: GuideChannelView;
  current: boolean;
  onPick: () => void;
}) {
  const why = [
    option.now === undefined ? undefined : m.guide_picker_now({ title: option.now }),
    reasonText(option),
  ]
    .filter((part) => part !== undefined)
    .join(" · ");
  return (
    <li>
      <button
        type="button"
        aria-current={current || undefined}
        className={cn(
          "grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 rounded-md px-3 py-2 text-left",
          "fine:hover:bg-hover focus-visible:outline-2 focus-visible:outline-focus",
          current && "bg-selected",
        )}
        onClick={onPick}
      >
        <span className="min-w-0 truncate font-semibold">{option.displayName}</span>
        <span className="row-span-2 flex items-center gap-2 font-mono text-caption text-fg-3">
          {option.xmltvId}
          {current ? <Icon icon={CheckIcon} size={16} className="text-brand-fg" /> : null}
        </span>
        <span className="min-w-0 truncate text-meta text-fg-2">{why === "" ? " " : why}</span>
      </button>
    </li>
  );
}

/**
 * Choose a channel's guide: suggestions by name first, then a search over every source's guide
 * channels. A dialog on wide screens, a bottom sheet on phones.
 */
export function GuidePicker({
  channel,
  open,
  onOpenChange,
}: {
  channel: Channel;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queries = useLineupQueries();
  const update = useUpdateChannel();
  const field = useRef<HTMLInputElement | null>(null);
  const [search, setSearch] = useState("");
  const term = useDebouncedValue(search.trim(), 250);
  const suggestions = useQuery({ ...queries.guideSuggestions(channel.id), enabled: open });
  const all = useQuery({ ...queries.guideChannels(term), enabled: open });
  const wanted = term.toLowerCase();
  const suggested = (suggestions.data ?? []).filter(
    (option) =>
      wanted === "" ||
      option.displayName.toLowerCase().includes(wanted) ||
      option.xmltvId.toLowerCase().includes(wanted),
  );
  const seen = new Set(suggested.map(optionKey));
  const rest = (all.data ?? []).filter((option) => !seen.has(optionKey(option)));
  const pick = (option: GuideChannelView | undefined) =>
    update.mutate(
      { id: channel.id, update: { guideChannelId: option?.xmltvId ?? null } },
      {
        onSuccess: () => onOpenChange(false),
        onError: () => toast({ title: m.state_not_saved(), type: "error" }),
      },
    );
  const list = (options: readonly GuideChannelView[]) => (
    <ul className="grid gap-0.5">
      {options.map((option) => (
        <GuideOption
          key={optionKey(option)}
          option={option}
          current={option.xmltvId === channel.guideChannelId}
          onPick={() => pick(option)}
        />
      ))}
    </ul>
  );
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      label={m.lineup_guide_choose()}
      showTitle
      size="sm"
      keyboardFocus={field}
    >
      <div className="grid gap-3 p-4">
        <SearchField
          ref={field}
          value={search}
          placeholder={m.lineup_guide_search()}
          aria-label={m.lineup_guide_search()}
          onChange={(event) => setSearch(event.target.value)}
        />
        {/* A fixed height: results come and go while typing, the dialog stays put. */}
        <div className="h-90 overflow-y-auto overscroll-contain">
          {wanted === "" ? (
            <ul className="mb-3 grid gap-0.5" aria-label={m.guide_none_option()}>
              <NoGuideOption
                current={channel.guideChannelId === undefined}
                onPick={() => pick(undefined)}
              />
            </ul>
          ) : null}
          {suggested.length > 0 ? (
            <section aria-label={m.lineup_guide_suggested()} className="mb-3">
              <h3 className="px-3 pb-1 text-caption font-semibold text-fg-3">
                {m.lineup_guide_suggested()}
              </h3>
              {list(suggested)}
            </section>
          ) : null}
          <section aria-label={m.lineup_guide_all()}>
            <h3 className="px-3 pb-1 text-caption font-semibold text-fg-3">
              {m.lineup_guide_all()}
            </h3>
            {rest.length === 0 && all.data !== undefined && suggested.length === 0 ? (
              <p className="px-3 py-2 text-meta text-fg-2">{m.lineup_guide_none_found()}</p>
            ) : (
              list(rest)
            )}
          </section>
        </div>
      </div>
    </Dialog>
  );
}
