import { type KeyboardEvent, type ReactNode, useRef, useState } from "react";
import type { Weekday } from "@slipstream/domain";
import { m } from "@slipstream/i18n";
import { Icon } from "./icon.tsx";
import { AddIcon, CloseIcon, MinusIcon } from "./icons.ts";
import { IconButton } from "./primitives/button.tsx";
import { cn } from "./utils.ts";

/*
 * Form controls the editors share (SPEC §4): the minutes stepper, the token field and the
 * weekday pills (the select is `primitives/select.tsx`). The rule editor, the collection editor, the
 * programme sheet and Settings all use these, so a stepper looks and sounds the same everywhere.
 */

/**
 * A stepper (SPEC §4): minus, the value, plus; `sm` tall with tabular figures. Each button is
 * named with what it changes, so "Start early, less" is heard. `display` defaults to minutes.
 */
export function Stepper({
  label,
  value,
  display,
  onChange,
  step = 1,
  min = 0,
  max = 24 * 60,
  disabled = false,
  size = "sm",
  className,
}: {
  label: string;
  value: number;
  display?: string;
  onChange: (value: number) => void;
  step?: number;
  min?: number;
  max?: number;
  disabled?: boolean;
  size?: "sm" | "md";
  className?: string;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cn("stepper", size === "md" && "stepper-md", className)}
    >
      <IconButton
        size="sm"
        label={m.field_less({ label })}
        tooltip={false}
        disabled={disabled || value - step < min}
        onClick={() => onChange(Math.max(min, value - step))}
      >
        <Icon icon={MinusIcon} size={14} />
      </IconButton>
      <output className="stepper-value sk" aria-live="polite" data-stepper-value="">
        {display ?? m.field_minutes({ count: value })}
      </output>
      <IconButton
        size="sm"
        label={m.field_more({ label })}
        tooltip={false}
        disabled={disabled || value + step > max}
        onClick={() => onChange(Math.min(max, value + step))}
      >
        <Icon icon={AddIcon} size={14} />
      </IconButton>
    </div>
  );
}

/**
 * One token: its words and, when it can go, a remover named "Remove …". `tone` colours the
 * layout parts in the collection editor (info for the first part, ok for the event).
 */
export function Token({
  label,
  onRemove,
  disabled = false,
  tone,
}: {
  label: string;
  onRemove?: (() => void) | undefined;
  disabled?: boolean;
  tone?: "info" | "ok" | undefined;
}) {
  return (
    <span className="token" data-tone={tone}>
      <span className="sk truncate">{label}</span>
      {onRemove === undefined ? null : (
        <button
          type="button"
          disabled={disabled}
          className="token-remove tap-area"
          aria-label={m.field_remove_value({ value: label })}
          onClick={onRemove}
        >
          <Icon icon={CloseIcon} size={14} />
        </button>
      )}
    </span>
  );
}

/** Tokens show their value as is unless a field says otherwise. */
const sameText = (value: string): string => value;

/**
 * A token field (SPEC §4 Tokens input): Enter or comma adds what was typed, Backspace in an
 * empty input removes the last token, × removes one. Tapping anywhere in it focuses the input.
 * 44 px tall on touch.
 */
export function TokenField({
  id,
  label,
  values,
  onChange,
  tokenLabel = sameText,
  extra,
  invalid = false,
  disabled = false,
  input = true,
}: {
  id?: string;
  label: string;
  values: readonly string[];
  onChange: (values: readonly string[]) => void;
  tokenLabel?: (value: string) => string;
  /** A control after the tokens, such as the "Add channel" select. */
  extra?: ReactNode;
  invalid?: boolean;
  disabled?: boolean;
  /** False for fields that add through `extra` only. */
  input?: boolean;
}) {
  const [text, setText] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const add = () => {
    const value = text.trim();
    setText("");
    if (value === "" || values.includes(value)) return;
    onChange([...values, value]);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter" || event.key === ",") {
      event.preventDefault();
      add();
    } else if (event.key === "Backspace" && text === "" && values.length > 0) {
      onChange(values.slice(0, -1));
    }
  };
  return (
    // oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- the input inside takes the keys; a tap anywhere just focuses it
    <div
      className="token-field"
      data-invalid={invalid ? "" : undefined}
      onClick={(event) => {
        if (event.target === event.currentTarget) inputRef.current?.focus();
      }}
    >
      {values.map((value) => (
        <Token
          key={value}
          label={tokenLabel(value)}
          disabled={disabled}
          onRemove={() => onChange(values.filter((candidate) => candidate !== value))}
        />
      ))}
      {input ? (
        <input
          id={id}
          ref={inputRef}
          value={text}
          disabled={disabled}
          aria-label={label}
          aria-invalid={invalid || undefined}
          enterKeyHint="enter"
          autoComplete="off"
          placeholder={values.length > 0 ? m.field_value_more() : m.field_value_first()}
          className="token-input"
          onChange={(event) => setText(event.target.value)}
          onKeyDown={onKeyDown}
          onBlur={add}
        />
      ) : null}
      {extra}
    </div>
  );
}

const weekdays: readonly Weekday[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

/** The weekday pills: pressed is the soft amber fill with an amber hairline (SPEC §8.6). */
export function WeekdayPills({
  label,
  value,
  onChange,
  disabled = false,
}: {
  label: string;
  value: readonly Weekday[];
  onChange: (value: readonly Weekday[]) => void;
  disabled?: boolean;
}) {
  return (
    <div role="group" aria-label={label} className="flex gap-1.5 max-sm:flex-nowrap">
      {weekdays.map((day) => {
        const pressed = value.includes(day);
        return (
          <button
            key={day}
            type="button"
            aria-pressed={pressed}
            aria-label={m.weekday_long({ day })}
            disabled={disabled}
            className="weekday tap-area"
            onClick={() =>
              onChange(
                pressed
                  ? value.filter((candidate) => candidate !== day)
                  : weekdays.filter((candidate) => candidate === day || value.includes(candidate)),
              )
            }
          >
            {m.weekday_short({ day })}
          </button>
        );
      })}
    </div>
  );
}
