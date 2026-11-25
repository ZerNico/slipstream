import { formatClock } from "~/i18n/formats.ts";
import { m } from "@slipstream/i18n";

import { MenuItem, ResponsiveMenu } from "~/ui/menu.tsx";
import { useOverlay } from "~/ui/overlay/use-overlay.tsx";
import { useShellData } from "./use-shell-data.ts";
import { epochMs } from "@slipstream/domain";

/**
 * The recording pill (SPEC §2.4): "Recording" opens the one running recording's watch choice;
 * "Recording · 2" opens a menu of every running recording (title, since), and picking one opens
 * its choice. Nothing is rendered while nothing records.
 */
export function RecordingPill() {
  const { running } = useShellData();
  const overlay = useOverlay();
  const [only] = running;
  if (only === undefined) return null;
  if (running.length === 1) {
    return (
      <button
        type="button"
        className="shell-recpill"
        aria-label={m.recpill_one_label({ title: only.title })}
        onClick={() => overlay.open({ kind: "choice", name: only.id })}
      >
        <span className="shell-recpill-dot" aria-hidden="true" />
        {m.recpill_one()}
      </button>
    );
  }
  return (
    <ResponsiveMenu
      name="recording"
      label={m.recpill_many_label({ count: running.length })}
      trigger={
        <button type="button" className="shell-recpill">
          <span className="shell-recpill-dot" aria-hidden="true" />
          {m.recpill_many({ count: running.length })}
        </button>
      }
    >
      {running.map((entry) => (
        <MenuItem
          key={entry.id}
          end={m.recpill_since({ clock: formatClock(epochMs(entry.start)) })}
          onSelect={() => overlay.open({ kind: "choice", name: entry.id })}
        >
          <span className="min-w-0 truncate">{entry.title}</span>
        </MenuItem>
      ))}
    </ResponsiveMenu>
  );
}
