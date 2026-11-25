import { m } from "@slipstream/i18n";
import { useRef } from "react";
import { Chip } from "~/ui/controls.tsx";
import { Icon } from "~/ui/icon.tsx";
import { ClockIcon } from "~/ui/icons.ts";
import { Sk } from "~/ui/skeleton.tsx";
import { slotLabel, slotSub } from "./labels.ts";
import { asClock, type GuideAt, type GuideDay, isSlot, slotsFor } from "./model.ts";

/**
 * The last chip: any time of the day. It opens the browser's time picker; a picked time stays on
 * the chip, pressed, and in the URL (`at=21:30`).
 */
function TimeChip({
  day,
  now,
  value,
  onChange,
}: {
  day: GuideDay;
  now: number;
  value: GuideAt;
  onChange: (at: GuideAt) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const picked = isSlot(value) ? undefined : value;
  const open = () => {
    const element = input.current;
    if (!element) return;
    try {
      element.showPicker();
    } catch {
      // No picker from a script here: the field takes the keys instead.
      element.focus();
    }
  };
  return (
    <span className="relative inline-flex flex-none">
      <Chip pressed={picked !== undefined} onPressedChange={open}>
        <Icon icon={ClockIcon} size={14} />
        <Sk>{picked === undefined ? m.guide_slot_custom() : slotLabel(picked, day, now)}</Sk>
      </Chip>
      <input
        ref={input}
        type="time"
        step={300}
        tabIndex={-1}
        aria-label={m.guide_slot_custom_label()}
        className="pointer-events-none absolute inset-0 opacity-0"
        value={picked ?? ""}
        onChange={(event) => {
          const time = asClock(event.target.value);
          if (time !== undefined) onChange(time);
        }}
      />
    </span>
  );
}

/**
 * The time-slot chips with meaning (SPEC §8.2): Now 18:42 · 19:00 Early evening · 20:15 Prime
 * time · 22:00 Late, then any other time. One is pressed; picking another answers "what's on
 * then?".
 */
export function SlotChips({
  day,
  now,
  value,
  label,
  onChange,
}: {
  day: GuideDay;
  now: number;
  value: GuideAt;
  label: string;
  onChange: (slot: GuideAt) => void;
}) {
  return (
    <div className="scroller min-w-0 flex-1 gap-2" role="group" aria-label={label}>
      {slotsFor(day).map((slot) => {
        const sub = slotSub(slot);
        return (
          <Chip key={slot} pressed={value === slot} onPressedChange={() => onChange(slot)}>
            {slot === "now" ? (
              <i className="size-2 rounded-full bg-live" aria-hidden="true" />
            ) : null}
            <Sk>{slotLabel(slot, day, now)}</Sk>
            {sub === undefined ? null : <span className="chip-count">{sub}</span>}
          </Chip>
        );
      })}
      <TimeChip day={day} now={now} value={value} onChange={onChange} />
    </div>
  );
}
