import { Checkbox as CheckboxPrimitive } from "@base-ui/react/checkbox";
import { defaultRangeExtractor, type Range, useVirtualizer } from "@tanstack/react-virtual";
import type { SourceGroup, SourceStreamEntry } from "@slipstream/api";
import { groupQualities, type PickerRow, type TickState } from "@slipstream/domain";
import { m } from "@slipstream/i18n";
import { useCallback, useMemo, useRef } from "react";
import { Segmented, SearchField } from "~/ui/controls.tsx";
import { Icon } from "~/ui/icon.tsx";
import { CheckIcon, ChevronDownIcon, ChevronRightIcon, MinusIcon } from "~/ui/icons.ts";
import { Button } from "~/ui/primitives/button.tsx";
import { LoadingScope, Sk } from "~/ui/skeleton.tsx";
import { cn } from "~/ui/utils.ts";
import { qualityText } from "./picker-text.ts";
import type { StreamPickerState } from "./use-stream-picker.ts";

/** Row heights: fixed, so the list never measures and never moves. */
const groupHeight = 56;
const streamHeight = 40;

/** A group's title, or the words for streams without one. */
const groupName = (group: SourceGroup): string => group.name ?? m.picker_group_none();

/** A 20 px tick box with a third state: some of what it stands for is ticked. */
function TickBox({
  state,
  label,
  disabled = false,
  onChange,
}: {
  state: TickState;
  label: string;
  disabled?: boolean;
  onChange: (on: boolean) => void;
}) {
  return (
    <CheckboxPrimitive.Root
      className="check hit data-[indeterminate]:bg-brand data-[indeterminate]:shadow-none data-[disabled]:opacity-50"
      checked={state === "on"}
      indeterminate={state === "some"}
      disabled={disabled}
      aria-label={label}
      onCheckedChange={(checked) => onChange(state === "some" ? true : checked)}
    >
      <CheckboxPrimitive.Indicator keepMounted={false}>
        <Icon icon={state === "some" ? MinusIcon : CheckIcon} size={14} />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}

/** The hints under a group's name: guide coverage, qualities, streams joining channels. */
function groupHints(group: SourceGroup, streams: readonly SourceStreamEntry[]): string {
  const qualities = groupQualities(streams)
    .map(qualityText)
    .filter((text) => text !== undefined);
  const joining = streams.filter(
    (stream) => stream.channel === undefined && stream.match?.reason === "sameGuide",
  ).length;
  return [
    m.picker_group_guide({ percent: group.guideCoverage }),
    qualities.length === 0 ? undefined : qualities.join(" + "),
    joining === 0 ? undefined : m.picker_group_joins({ count: joining }),
  ]
    .filter((part) => part !== undefined)
    .join(" · ");
}

function GroupRow({
  picker,
  group,
  open,
  narrowed,
}: {
  picker: StreamPickerState;
  group: SourceGroup;
  open: boolean;
  narrowed: boolean;
}) {
  const name = groupName(group);
  const pickable = group.streams - group.added;
  const tick = picker.groupTick(group);
  return (
    <div className="flex h-full items-center gap-2.5 border-b border-line bg-surface px-3">
      <button
        type="button"
        className="grid size-7 flex-none place-items-center rounded-sm text-fg-3 fine:hover:bg-hover disabled:opacity-40"
        aria-expanded={open}
        aria-label={open ? m.picker_group_close({ name }) : m.picker_group_open({ name })}
        disabled={picker.streamsLoading || narrowed}
        onClick={() => picker.toggleOpen(group)}
      >
        <Icon icon={open ? ChevronDownIcon : ChevronRightIcon} size={16} />
      </button>
      <span className="sk-hide flex flex-none">
        <TickBox
          state={tick}
          label={name}
          disabled={picker.streamsLoading || pickable === 0}
          onChange={(on) => picker.pickGroup(group, on)}
        />
      </span>
      <button
        type="button"
        className="grid min-w-0 flex-1 text-left"
        disabled={picker.streamsLoading || narrowed}
        onClick={() => picker.toggleOpen(group)}
      >
        <span className="truncate text-[14px] font-semibold">
          <Sk>{name}</Sk>
        </span>
        <span className="truncate text-caption font-normal text-fg-3">
          <Sk chars={28}>
            {picker.streamsLoading ? "" : groupHints(group, picker.groupStreams(group))}
          </Sk>
        </span>
      </button>
      <span className="flex-none text-meta tabular-nums text-fg-2">
        <Sk chars={3}>
          {tick === "some"
            ? m.picker_group_picked({ picked: picker.groupPicked(group), total: pickable })
            : String(pickable)}
        </Sk>
      </span>
    </div>
  );
}

function StreamRow({ picker, stream }: { picker: StreamPickerState; stream: SourceStreamEntry }) {
  const added = stream.channel !== undefined;
  const quality = qualityText(stream.quality);
  const hint = added
    ? m.picker_added()
    : stream.match?.reason === "sameGuide"
      ? m.picker_joins({ name: stream.match.name })
      : stream.hasGuide
        ? undefined
        : m.picker_no_guide();
  return (
    <label
      className={cn(
        "flex h-full cursor-pointer items-center gap-2.5 pr-3 pl-12.5 fine:hover:bg-hover",
        added && "cursor-default",
      )}
    >
      <TickBox
        state={added || picker.picked.has(stream.id) ? "on" : "off"}
        label={stream.name}
        disabled={added}
        onChange={(on) => picker.pickStream(stream, on)}
      />
      <span className="min-w-0 flex-1 truncate text-[14px]">{stream.name}</span>
      {hint === undefined ? null : (
        <span className="flex-none truncate text-caption font-normal text-fg-3">{hint}</span>
      )}
      <span className="w-10 flex-none text-right">
        {quality === undefined ? null : (
          <span className="inline-grid h-5 place-items-center rounded-sm px-1.5 text-[11px] font-semibold text-fg-2 shadow-[inset_0_0_0_1px_var(--line-2)]">
            {quality}
          </span>
        )}
      </span>
    </label>
  );
}

/** Placeholder groups while the counts load: the list keeps its height. */
const placeholderGroups: readonly SourceGroup[] = Array.from({ length: 9 }, (_, index) => ({
  name: `Group ${index}`,
  streams: 100,
  withGuide: 0,
  guideCoverage: 0,
  added: 0,
  new: 0,
  ignored: 0,
}));

/**
 * The search, All and Selected, Select all and none, and the list of collapsible groups (only
 * the rows near the view are drawn, so 5,000 streams scroll like 50). The open group's head
 * stays at the top while its streams scroll. `className` sizes the list's box.
 */
export function StreamPickerList({
  picker,
  className,
}: {
  picker: StreamPickerState;
  className?: string;
}) {
  // TanStack Virtual hands back one mutable object; the compiler must not cache what it draws.
  "use no memo";
  const scroller = useRef<HTMLDivElement | null>(null);
  const narrowed = picker.search.trim() !== "" || picker.onlyPicked || picker.onlyNew;
  const rows: readonly PickerRow<SourceGroup, SourceStreamEntry>[] = useMemo(
    () =>
      picker.loading
        ? placeholderGroups.map((group, index) => ({
            kind: "group" as const,
            key: `p:${index}`,
            group,
            streams: [],
            open: false,
          }))
        : picker.rows,
    [picker.loading, picker.rows],
  );
  // For every row, the head of the open group it belongs to (-1 for closed groups' heads):
  // that head stays at the top while the group's streams scroll under it.
  const openHead = useMemo(() => {
    let head = -1;
    return rows.map((row, index) => {
      if (row.kind === "group") head = row.open ? index : -1;
      return head;
    });
  }, [rows]);
  const sticky = useRef(-1);
  const rangeExtractor = useCallback(
    (range: Range) => {
      sticky.current = openHead[range.startIndex] ?? -1;
      const shown = defaultRangeExtractor(range);
      return sticky.current === -1
        ? shown
        : [...new Set([sticky.current, ...shown])].toSorted((a, b) => a - b);
    },
    [openHead],
  );
  // oxlint-disable-next-line react/incompatible-library
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scroller.current,
    estimateSize: (index) => (rows[index]?.kind === "stream" ? streamHeight : groupHeight),
    getItemKey: (index) => rows[index]?.key ?? index,
    overscan: 12,
    rangeExtractor,
    initialRect: { width: 0, height: 480 },
  });

  return (
    <div className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)] gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <SearchField
          className="w-full sm:w-60"
          value={picker.search}
          placeholder={m.picker_search({ count: picker.total })}
          aria-label={m.picker_search({ count: picker.total })}
          disabled={picker.streamsLoading}
          onChange={(event) => picker.setSearch(event.target.value)}
        />
        <Segmented
          label={m.picker_show()}
          value={picker.onlyPicked ? "picked" : picker.onlyNew ? "new" : "all"}
          onChange={(value) => {
            picker.setOnlyPicked(value === "picked");
            picker.setOnlyNew(value === "new");
          }}
          segments={[
            { value: "all", label: m.picker_show_all() },
            ...(picker.hasNew || picker.onlyNew
              ? [{ value: "new" as const, label: m.picker_show_new() }]
              : []),
            { value: "picked", label: m.picker_show_selected() },
          ]}
        />
        <span className="ml-auto flex">
          <Button
            size="sm"
            variant="ghost"
            disabled={picker.streamsLoading}
            onClick={() => picker.pickShown(true)}
          >
            {m.picker_select_all()}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={picker.streamsLoading}
            onClick={() => picker.pickShown(false)}
          >
            {m.picker_select_none()}
          </Button>
        </span>
      </div>
      <LoadingScope
        loading={picker.loading}
        className={cn(
          "relative min-h-0 overflow-hidden rounded-md shadow-[inset_0_0_0_1px_var(--line-2)]",
          className,
        )}
      >
        <div
          ref={scroller}
          className="absolute inset-0 overflow-y-auto overscroll-contain"
          role="group"
          aria-label={m.picker_title()}
          data-testid="stream-picker-list"
        >
          <div className="relative" style={{ height: virtualizer.getTotalSize() }}>
            {virtualizer.getVirtualItems().map((item) => {
              const row = rows[item.index];
              if (row === undefined) return null;
              const stuck = row.kind === "group" && item.index === sticky.current;
              return (
                <div
                  key={item.key}
                  data-index={item.index}
                  className={cn("inset-x-0 top-0", stuck ? "sticky z-1" : "absolute")}
                  style={{
                    height: item.size,
                    ...(stuck ? {} : { transform: `translateY(${item.start}px)` }),
                  }}
                >
                  {row.kind === "group" ? (
                    <GroupRow
                      picker={picker}
                      group={row.group}
                      open={row.open}
                      narrowed={narrowed}
                    />
                  ) : (
                    <StreamRow picker={picker} stream={row.stream} />
                  )}
                </div>
              );
            })}
          </div>
          {!picker.loading && rows.length === 0 ? (
            <p className="absolute inset-x-0 top-0 p-4 text-[14px] text-fg-2">
              {picker.onlyPicked && picker.search.trim() === ""
                ? m.picker_none_selected()
                : m.picker_none_match()}
            </p>
          ) : null}
        </div>
      </LoadingScope>
    </div>
  );
}

/** "1,240 of 4,812 selected" and, under it, how many streams join existing channels. */
export function PickerCount({ picker }: { picker: StreamPickerState }) {
  return (
    <span className="grid text-right text-meta tabular-nums" aria-live="polite">
      <span className="font-semibold">
        <Sk chars={20}>
          {picker.loading
            ? ""
            : m.picker_selected_of({ selected: picker.selected, total: picker.total })}
        </Sk>
      </span>
      <span className="text-caption font-normal text-fg-3">
        {picker.plan.joining === 0 ? " " : m.picker_join_existing({ count: picker.plan.joining })}
      </span>
    </span>
  );
}
