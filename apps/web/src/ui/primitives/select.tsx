import { Select as SelectPrimitive } from "@base-ui/react/select";
import type { Ref } from "react";
import { Icon } from "~/ui/icon.tsx";
import { CheckIcon, ChevronDownIcon } from "~/ui/icons.ts";
import { cn } from "~/ui/utils.ts";

/** One option of a {@link Select}. */
export interface SelectOption<V extends string> {
  readonly value: V;
  readonly label: string;
}

/** Options under a small heading. */
export interface SelectGroup<V extends string> {
  readonly label: string;
  readonly options: readonly SelectOption<V>[];
}

/**
 * A select in the input's look (SPEC §4): the trigger reads like a field with its chevron, the
 * options open in the app's own menu with the picked one ticked, the same in every browser.
 * Base UI semantics: arrow keys, type-ahead, Esc, focus back to the trigger. `className` sizes
 * the trigger. As a picker (`value` null, a `placeholder` such as "+ Add channel", `quiet`) it
 * reads as a quiet line inside a token field and hands each pick to `onChange`.
 */
export function Select<V extends string>({
  value,
  options,
  groups,
  placeholder,
  quiet = false,
  onChange,
  id,
  ref,
  disabled = false,
  className,
  "aria-label": ariaLabel,
  "aria-labelledby": ariaLabelledBy,
}: {
  value: V | null;
  options?: readonly SelectOption<V>[];
  groups?: readonly SelectGroup<V>[];
  placeholder?: string;
  quiet?: boolean;
  onChange: (value: V) => void;
  id?: string;
  ref?: Ref<HTMLButtonElement>;
  disabled?: boolean;
  className?: string;
  "aria-label"?: string;
  "aria-labelledby"?: string;
}) {
  const all = [...(options ?? []), ...(groups ?? []).flatMap((group) => group.options)];
  const item = (option: SelectOption<V>) => (
    <SelectPrimitive.Item key={option.value} value={option.value} className="menu-item">
      <SelectPrimitive.ItemText>{option.label}</SelectPrimitive.ItemText>
      <SelectPrimitive.ItemIndicator className="menu-item-end">
        <Icon icon={CheckIcon} size={16} />
      </SelectPrimitive.ItemIndicator>
    </SelectPrimitive.Item>
  );
  return (
    <SelectPrimitive.Root
      value={value}
      items={all}
      disabled={disabled}
      modal={false}
      onValueChange={(next) => {
        const picked = all.find((option) => option.value === next);
        if (picked) onChange(picked.value);
      }}
    >
      <SelectPrimitive.Trigger
        ref={ref}
        id={id}
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        data-slot="select-trigger"
        className={cn(
          quiet
            ? "select-quiet"
            : "input flex min-w-0 cursor-default items-center gap-2 pr-3 text-left data-popup-open:inset-ring-2 data-popup-open:inset-ring-brand",
          className,
        )}
      >
        <SelectPrimitive.Value className="min-w-0 flex-1 truncate" placeholder={placeholder} />
        {quiet ? null : (
          <SelectPrimitive.Icon className="flex-none text-fg-3">
            <Icon icon={ChevronDownIcon} size={16} />
          </SelectPrimitive.Icon>
        )}
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Positioner
          className="z-(--z-menu) outline-none"
          sideOffset={6}
          alignItemWithTrigger={false}
          collisionPadding={8}
        >
          <SelectPrimitive.Popup
            data-slot="select-content"
            className="menu max-h-(--available-height) min-w-(--anchor-width) overflow-y-auto"
          >
            <SelectPrimitive.List>
              {(options ?? []).map(item)}
              {(groups ?? []).map((group, index) => (
                <SelectPrimitive.Group key={group.label}>
                  {index > 0 || (options ?? []).length > 0 ? <div className="menu-sep" /> : null}
                  <SelectPrimitive.GroupLabel className="menu-head">
                    {group.label}
                  </SelectPrimitive.GroupLabel>
                  {group.options.map(item)}
                </SelectPrimitive.Group>
              ))}
            </SelectPrimitive.List>
          </SelectPrimitive.Popup>
        </SelectPrimitive.Positioner>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}
