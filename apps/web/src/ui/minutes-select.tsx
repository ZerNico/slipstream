import { Select } from "./primitives/select.tsx";
import { earlyChoices, lateChoices } from "./minutes.ts";
import { cn } from "./utils.ts";

/**
 * A minutes picker for extra time (Settings, the programme sheet, a series recording): a plain
 * select, each option naming itself ("10 min" or "10 min late").
 */
export function MinutesSelect({
  label,
  value,
  side,
  text,
  disabled = false,
  className,
  onChange,
}: {
  label: string;
  value: number;
  side: "early" | "late";
  text: (minutes: number) => string;
  disabled?: boolean;
  className?: string;
  onChange: (minutes: number) => void;
}) {
  const choices = side === "early" ? earlyChoices(value) : lateChoices(value);
  return (
    <Select
      aria-label={label}
      className={cn("w-auto min-w-[9.5rem]", className)}
      value={String(value)}
      disabled={disabled}
      options={choices.map((minutes) => ({ value: String(minutes), label: text(minutes) }))}
      onChange={(next) => onChange(Number(next))}
    />
  );
}
