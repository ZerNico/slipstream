import type { RecordingEntry, ScheduleConflict } from "@slipstream/api";
import { epochMs, type RepeatAiring } from "@slipstream/domain";
import { m } from "@slipstream/i18n";
import { Icon } from "~/ui/icon.tsx";
import { WarningIcon } from "~/ui/icons.ts";
import { Button } from "~/ui/primitives/button.tsx";

/**
 * The conflict box (SPEC §8.3): when the overlap is, what it overlaps with, and every way out:
 * skip one of them, record the repeat instead (the later airing the server picked, when it
 * found one), or see everything scheduled.
 */
export function ConflictBox({
  conflict,
  self,
  entries,
  repeat,
  dayAt,
  repeatBusy,
  onSkip,
  onRepeat,
  onAll,
}: {
  conflict: ScheduleConflict;
  self: string;
  entries: readonly RecordingEntry[];
  /** The server's "Record the repeat instead" airing (`RecordOptions.repeatAiring`). */
  repeat: RepeatAiring | undefined;
  /** A moment's household day inside a sentence: "today", "Wed 25". */
  dayAt: (at: number) => string;
  repeatBusy: boolean;
  onSkip: (id: RecordingEntry["id"], title: string) => void;
  onRepeat: (repeat: RepeatAiring) => void;
  onAll: () => void;
}) {
  const involved = conflict.recordingIds.flatMap((id) => {
    const found = entries.find((candidate) => candidate.id === id);
    return found ? [found] : [];
  });
  const others = involved.filter((candidate) => candidate.id !== self);
  const repeatAt = repeat === undefined ? undefined : epochMs(repeat.start);
  return (
    <div className="grid gap-2.5 rounded-lg bg-warn-soft px-4 py-3.5 text-[13.5px] shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--warn)_30%,transparent)]">
      <div className="flex items-center gap-2 font-[650] text-warn-fg">
        <Icon icon={WarningIcon} size={16} />
        {m.guide_conflict_title({
          start: new Date(epochMs(conflict.range.start)),
          end: new Date(epochMs(conflict.range.end)),
        })}
      </div>
      <div>{m.guide_conflict_text({ titles: others.map((candidate) => candidate.title) })}</div>
      <div className="flex flex-wrap gap-2">
        {involved.map((candidate) => (
          <Button
            key={candidate.id}
            size="sm"
            variant="secondary"
            onClick={() => onSkip(candidate.id, candidate.title)}
          >
            {m.library_resolve_skip({ title: candidate.title })}
          </Button>
        ))}
        {repeat === undefined || repeatAt === undefined ? null : (
          <Button size="sm" variant="secondary" busy={repeatBusy} onClick={() => onRepeat(repeat)}>
            {m.guide_record_repeat_instead({ day: dayAt(repeatAt), time: new Date(repeatAt) })}
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={onAll}>
          {m.guide_all_scheduled()}
        </Button>
      </div>
    </div>
  );
}
