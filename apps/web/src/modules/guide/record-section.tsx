import { type ReactNode, useId, useState } from "react";

import {
  clampPaddingMinutes,
  type Collection,
  type CollectionId,
  type ExtraTimeHint,
  type Padding,
  type RecordOptions,
} from "@slipstream/domain";
import { m, pathLabels } from "@slipstream/i18n";
import { Segmented } from "~/ui/controls.tsx";
import { Select } from "~/ui/primitives/select.tsx";
import { Icon } from "~/ui/icon.tsx";
import { ChevronDownIcon } from "~/ui/icons.ts";
import { MinutesSelect } from "~/ui/minutes-select.tsx";
import { Button } from "~/ui/primitives/button.tsx";
import { cn } from "~/ui/utils.ts";
import { groupName } from "./record-options.ts";

/** This one, or every episode / broadcast (the series recording). */
export type RecordMode = "once" | "every";

/** What the reader set up in the record section; the footer's Record acts on it. */
export interface RecordPlan {
  readonly mode: RecordMode;
  /** Values the reader picked; absent means the default. */
  readonly chosen: Padding | undefined;
  /** The Goes-to pick: Automatic or a collection. */
  readonly goes: "auto" | CollectionId;
}

function OptionRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-4 py-2.5 text-[14px]">
      <span>{label}</span>
      {children}
    </div>
  );
}

/**
 * The record section of a programme nobody records yet: This episode / All episodes (or Every
 * “Live F1”; nothing to choose for a film), then Options, folded, with its values as the summary:
 * start early, end late and where the recording goes. The footer's Record acts on it. `status`
 * (an episode the viewer already has) sits above.
 */
export function RecordSection({
  options,
  plan,
  onPlan,
  hint,
  collections,
  status,
}: {
  options: RecordOptions;
  plan: RecordPlan;
  onPlan: (plan: RecordPlan) => void;
  hint: ExtraTimeHint;
  collections: readonly Collection[];
  /** "Already recorded Sun 22, 15:00 on ONE · Play it", above the choice. */
  status?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const goesTo = options.goesTo;
  const { every } = options;
  const automatic = groupName(options.automaticGroup, pathLabels());
  const collectionName = (id: CollectionId) =>
    collections.find((collection) => collection.id === id)?.name ?? "";
  const padding = hint.padding;
  const setPadding = (side: keyof Padding, value: number) =>
    onPlan({ ...plan, chosen: { ...padding, [side]: clampPaddingMinutes(value) } });

  const choices = goesTo
    ? goesTo.collectionIds.filter(
        (id) =>
          id === plan.goes || !(goesTo.automatic && options.automaticGroup.collectionId === id),
      )
    : [];
  const goesLabel =
    plan.goes === "auto"
      ? goesTo?.automatic === false
        ? collectionName(goesTo.collectionIds[0] ?? ("" as CollectionId))
        : undefined
      : collectionName(plan.goes);
  const summary = [m.padding_value(padding), ...(goesLabel === undefined ? [] : [goesLabel])].join(
    " · ",
  );

  return (
    <div className="grid gap-3">
      {status}
      {every.kind === "none" ? null : (
        <Segmented
          className="w-full [&>*]:flex-1"
          label={m.guide_record_options()}
          value={plan.mode}
          onChange={(mode) => onPlan({ ...plan, mode })}
          segments={[
            {
              value: "once",
              label: every.kind === "series" ? m.guide_this_episode() : m.guide_just_this(),
            },
            {
              value: "every",
              label:
                every.kind === "series"
                  ? m.guide_all_episodes()
                  : m.guide_every_broadcast({ title: every.name }),
            },
          ]}
        />
      )}
      <div className="overflow-hidden rounded-lg shadow-[inset_0_0_0_1px_var(--line-2)]">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          className="flex w-full items-center gap-3 px-4 py-3 text-left text-[14px] fine:hover:bg-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus"
          onClick={() => setOpen((was) => !was)}
        >
          <span className="font-semibold">{m.action_options()}</span>
          <span className="ml-auto min-w-0 truncate text-fg-2" data-extra-summary="">
            {summary}
          </span>
          <Icon
            icon={ChevronDownIcon}
            size={16}
            className={cn(
              "flex-none text-fg-3 transition-transform duration-(--t-fast)",
              open && "rotate-180",
            )}
          />
        </button>
        {open ? (
          <div id={panelId} className="border-t border-line py-1">
            <OptionRow label={m.padding_before()}>
              <MinutesSelect
                label={m.padding_before()}
                side="early"
                value={padding.beforeMinutes}
                text={(minutes) => m.guide_minutes({ minutes })}
                onChange={(value) => setPadding("beforeMinutes", value)}
              />
            </OptionRow>
            <OptionRow label={m.padding_after()}>
              <MinutesSelect
                label={m.padding_after()}
                side="late"
                value={padding.afterMinutes}
                text={(minutes) => m.guide_minutes({ minutes })}
                onChange={(value) => setPadding("afterMinutes", value)}
              />
            </OptionRow>
            {goesTo === undefined ? null : (
              <OptionRow label={m.series_section_goes()}>
                <Select
                  aria-label={m.series_section_goes()}
                  className="w-auto max-w-full min-w-[12rem]"
                  value={plan.goes}
                  options={[
                    ...(goesTo.automatic
                      ? [{ value: "auto", label: m.guide_goes_automatic({ group: automatic }) }]
                      : []),
                    ...choices.map((id) => ({ value: id as string, label: collectionName(id) })),
                  ]}
                  onChange={(value) =>
                    onPlan({ ...plan, goes: value === "auto" ? "auto" : (value as CollectionId) })
                  }
                />
              </OptionRow>
            )}
            {plan.chosen === undefined ? null : (
              <div className="px-2 pb-1">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => onPlan({ ...plan, chosen: undefined })}
                >
                  {m.action_reset()}
                </Button>
              </div>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}
