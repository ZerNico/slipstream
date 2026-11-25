import { m } from "@slipstream/i18n";
import { Sk } from "~/ui/skeleton.tsx";
import { cn } from "~/ui/utils.ts";
import { Icon } from "~/ui/icon.tsx";
import { ChevronLeftIcon, ChevronRightIcon, FilterIcon } from "~/ui/icons.ts";
import { IconButton } from "~/ui/primitives/button.tsx";
import {
  MenuLabel,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  ResponsiveMenu,
} from "~/ui/menu.tsx";
import { media, useMediaQuery } from "~/ui/use-media-query.ts";
import { categoryLabel, dayHeading, dayPillLabel, slotLabel } from "./labels.ts";
import {
  type GuideCategory,
  type GuideDay,
  guideCategories,
  type GuideAt,
  slotsFor,
} from "./model.ts";

/**
 * The Filter chip (SPEC §8.2): the categories under 768 px and in short landscape, a menu on
 * desktop and a sheet on touch phones (`?dlg=filter`). In short landscape's Channels view it
 * also holds the time slots, so the header stays one row.
 */
export function FilterMenu({
  category,
  onCategory,
  slots,
}: {
  category: GuideCategory;
  onCategory: (category: GuideCategory) => void;
  slots?: {
    readonly day: GuideDay;
    readonly now: number;
    readonly value: GuideAt;
    readonly onChange: (slot: GuideAt) => void;
  };
}) {
  // As a sheet the header already says "Show in the guide"; a second heading would repeat it.
  const asSheet = useMediaQuery(media.menuAsSheet);
  return (
    <ResponsiveMenu
      name="filter"
      label={m.guide_filter_label()}
      trigger={
        <button
          type="button"
          className="chip"
          aria-haspopup="menu"
          aria-pressed={category !== "all"}
        >
          <Icon icon={FilterIcon} size={16} />
          {category === "all" ? m.guide_filter() : categoryLabel(category)}
        </button>
      }
    >
      {slots ? (
        <>
          <MenuLabel>{m.guide_slots_label()}</MenuLabel>
          <MenuRadioGroup
            value={slots.value}
            onValueChange={(value) => {
              const slot = slotsFor(slots.day).find((candidate) => candidate === value);
              if (slot) slots.onChange(slot);
            }}
          >
            {slotsFor(slots.day).map((slot) => (
              <MenuRadioItem key={slot} value={slot}>
                {slotLabel(slot, slots.day, slots.now)}
              </MenuRadioItem>
            ))}
          </MenuRadioGroup>
          <MenuSeparator />
        </>
      ) : null}
      {slots || !asSheet ? <MenuLabel>{m.guide_filter_label()}</MenuLabel> : null}
      <MenuRadioGroup
        value={category}
        onValueChange={(value) => {
          const picked = guideCategories.find((candidate) => candidate === value);
          if (picked) onCategory(picked);
        }}
      >
        {guideCategories.map((candidate) => (
          <MenuRadioItem key={candidate} value={candidate}>
            {categoryLabel(candidate)}
          </MenuRadioItem>
        ))}
      </MenuRadioGroup>
    </ResponsiveMenu>
  );
}

/**
 * The day switcher (SPEC §8.2, owner feedback 2026-11-24): ‹ Today 24 › in place of the eight
 * pills. The arrows step a day; the label opens every day (a menu, a sheet on touch phones,
 * `?dlg=day`). In the timeline it names the day in view and moves the grid there; in the
 * Channels view it picks the day the list shows.
 */
export function DaySwitcher({
  days,
  day,
  onDay,
  compact = false,
}: {
  days: readonly GuideDay[];
  day: GuideDay;
  onDay: (day: GuideDay) => void;
  /** Short landscape: the day alone (it opens every day), no arrows, so the header stays one row. */
  compact?: boolean;
}) {
  const index = days.findIndex((candidate) => candidate.key === day.key);
  const previous = index > 0 ? days[index - 1] : undefined;
  const next = index >= 0 && index < days.length - 1 ? days[index + 1] : undefined;
  const label = dayHeading(day);
  const asSheet = useMediaQuery(media.menuAsSheet);
  return (
    <div
      className="inline-flex h-10 flex-none items-center gap-0.5 rounded-full p-0.5 ring-1 ring-line-2 ring-inset coarse:h-12"
      role="group"
      aria-label={m.guide_days_label()}
    >
      {compact ? null : (
        <IconButton
          size="sm"
          label={m.guide_day_previous()}
          disabled={previous === undefined}
          onClick={() => previous && onDay(previous)}
        >
          <Icon icon={ChevronLeftIcon} size={16} />
        </IconButton>
      )}
      <ResponsiveMenu
        name="day"
        label={m.guide_days_label()}
        trigger={
          <button
            type="button"
            className={cn(
              "h-9 rounded-full px-2.5 text-[14px] font-semibold tabular-nums outline-none focus-visible:outline-2 focus-visible:outline-focus fine:hover:bg-hover coarse:h-11",
              compact ? "px-3.5" : "min-w-[88px]",
            )}
            aria-haspopup="menu"
            aria-label={m.guide_day_menu_label({ day: dayPillLabel(day) })}
            data-day-switcher={day.key}
          >
            <Sk>{label}</Sk>
          </button>
        }
      >
        {asSheet ? null : <MenuLabel>{m.guide_days_label()}</MenuLabel>}
        <MenuRadioGroup
          value={day.key}
          onValueChange={(value) => {
            const picked = days.find((candidate) => candidate.key === value);
            if (picked) onDay(picked);
          }}
        >
          {days.map((candidate) => (
            <MenuRadioItem key={candidate.key} value={candidate.key}>
              {dayPillLabel(candidate)}
            </MenuRadioItem>
          ))}
        </MenuRadioGroup>
      </ResponsiveMenu>
      {compact ? null : (
        <IconButton
          size="sm"
          label={m.guide_day_next()}
          disabled={next === undefined}
          onClick={() => next && onDay(next)}
        >
          <Icon icon={ChevronRightIcon} size={16} />
        </IconButton>
      )}
    </div>
  );
}
