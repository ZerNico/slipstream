import type { ComponentProps, ReactNode } from "react";
import { Icon } from "~/ui/icon.tsx";
import { SearchIcon, WarningIcon } from "~/ui/icons.ts";
import { Input } from "~/ui/primitives/input.tsx";
import { Toggle } from "~/ui/primitives/toggle.tsx";
import { ToggleGroup, ToggleGroupItem } from "~/ui/primitives/toggle-group.tsx";
import { cn } from "~/ui/utils.ts";

/** One segment of a segmented control. */
export interface Segment<V extends string> {
  readonly value: V;
  readonly label: ReactNode;
}

/**
 * A segmented control (SPEC §4): one value out of a few, `md` tall, `role=group` with pressed
 * segments. The guide's "Timeline | Channels", the library's group-by.
 */
export function Segmented<V extends string>({
  label,
  value,
  onChange,
  segments,
  className,
}: {
  label: string;
  value: V;
  onChange: (value: V) => void;
  segments: readonly Segment<V>[];
  className?: string;
}) {
  return (
    <ToggleGroup
      aria-label={label}
      value={[value]}
      onValueChange={(next) => {
        const picked = next.find((item): item is V =>
          segments.some((segment) => segment.value === item),
        );
        if (picked !== undefined) onChange(picked);
      }}
      className={className}
    >
      {segments.map((segment) => (
        <ToggleGroupItem key={segment.value} value={segment.value}>
          {segment.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

/** A filter chip (SPEC §4 Chip): toggles with `aria-pressed`, an optional count. */
export function Chip({
  pressed,
  onPressedChange,
  count,
  size,
  children,
  className,
}: {
  pressed: boolean;
  onPressedChange: (pressed: boolean) => void;
  count?: number;
  size?: "sm" | "md";
  children: ReactNode;
  className?: string;
}) {
  return (
    <Toggle pressed={pressed} onPressedChange={onPressedChange} size={size} className={className}>
      {children}
      {count === undefined ? null : <span className="chip-count">{count}</span>}
    </Toggle>
  );
}

/** A search field with its leading icon, `md` tall and round. */
export function SearchField({ className, ...props }: ComponentProps<typeof Input>) {
  return (
    <span className={cn("search", className)}>
      <Icon icon={SearchIcon} className="search-icon" />
      <Input type="search" {...props} />
    </span>
  );
}

/** The kinds of badge (SPEC §4 Badge). Zero counts are neutral, never ok-green. */
export type BadgeTone = "live" | "rec" | "sched" | "warn" | "ok" | "neutral" | "glass";

/** A 22 px status badge. Live and Rec pulse their dot; colour is never the only signal. */
export function Badge({
  tone,
  children,
  className,
}: {
  tone: BadgeTone;
  children: ReactNode;
  className?: string;
}) {
  return <span className={cn("badge", `badge-${tone}`, className)}>{children}</span>;
}

/**
 * A labelled field: the label on top, the control, then a hint or an error with its icon.
 * `reserve` keeps that message line even when empty, for a field that validates: its error
 * then lands in the line, and nothing below the field moves.
 */
export function Field({
  label,
  hint,
  error,
  children,
  htmlFor,
  reserve = false,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
  htmlFor?: string;
  reserve?: boolean;
}) {
  return (
    <div className="field" data-reserve={reserve ? "" : undefined}>
      <label className="field-label" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {error === undefined ? null : (
        <span className="field-error" role="alert">
          <Icon icon={WarningIcon} size={16} />
          {error}
        </span>
      )}
      {hint === undefined || error !== undefined ? null : (
        <span className="field-hint">{hint}</span>
      )}
      {reserve && hint === undefined && error === undefined ? (
        <span className="field-hint" aria-hidden="true" />
      ) : null}
    </div>
  );
}
