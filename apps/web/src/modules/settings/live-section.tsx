import { useQuery } from "@tanstack/react-query";
import {
  initialLiveKeep,
  keepBufferChoices,
  type KeepRunning,
  keepRunningChoices,
} from "@slipstream/domain";
import { keepBufferLabel, keepRunningLabel, m } from "@slipstream/i18n";
import { useQueries } from "~/api/hooks.ts";
import { Select } from "~/ui/primitives/select.tsx";
import { LoadingScope } from "~/ui/skeleton.tsx";
import { ListPanel, ListRow, SettingsSection } from "./parts.tsx";
import { useSaveLiveSettings } from "./queries.ts";
import { SectionProblem } from "./section-problem.tsx";
import { useAutosave } from "./use-autosave.ts";

/** A keep-running choice back from its picker value. */
const runningOf = (value: string): KeepRunning =>
  value === "programmeEnd" ? "programmeEnd" : Number(value);

/**
 * Settings › Recording › Live TV: how long a channel keeps running after its last viewer left
 * (reloads and short breaks keep the whole rewind buffer), and how long that buffer stays once
 * the channel stopped. Changes save themselves and apply to the next viewer who leaves.
 */
export function LiveSection() {
  const queries = useQueries();
  const settings = useQuery(queries.liveSettings());
  const save = useSaveLiveSettings();
  const draft = useAutosave(settings.data, (value, callbacks) => save.mutate(value, callbacks));

  if (settings.isError) return <SectionProblem error={settings.error} />;
  const loading = settings.isPending;
  const value = draft.value ?? settings.data ?? initialLiveKeep;
  // A value saved outside the offered steps still shows as itself.
  const running = keepRunningChoices.includes(value.keepRunning)
    ? keepRunningChoices
    : [...keepRunningChoices, value.keepRunning];
  const buffers = keepBufferChoices.includes(value.keepBufferMinutes)
    ? keepBufferChoices
    : [...keepBufferChoices, value.keepBufferMinutes].toSorted((a, b) => a - b);

  return (
    <LoadingScope loading={loading}>
      <SettingsSection title={m.rec_live_title()}>
        <ListPanel>
          <ListRow
            stackOnPhone
            title={m.rec_keep_running()}
            end={
              <Select
                aria-label={m.rec_keep_running()}
                className="w-[13.5rem] max-w-full"
                value={String(value.keepRunning)}
                disabled={loading}
                options={running.map((keep) => ({
                  value: String(keep),
                  label: keepRunningLabel(keep),
                }))}
                onChange={(next) => draft.change({ ...value, keepRunning: runningOf(next) })}
              />
            }
          />
          <ListRow
            stackOnPhone
            title={m.rec_keep_buffer()}
            end={
              <Select
                aria-label={m.rec_keep_buffer()}
                className="w-[13.5rem] max-w-full"
                value={String(value.keepBufferMinutes)}
                disabled={loading}
                options={buffers.map((minutes) => ({
                  value: String(minutes),
                  label: keepBufferLabel(minutes),
                }))}
                onChange={(next) => draft.change({ ...value, keepBufferMinutes: Number(next) })}
              />
            }
          />
        </ListPanel>
        <p className="mt-2 px-1 text-meta text-fg-2">{m.rec_live_note()}</p>
      </SettingsSection>
    </LoadingScope>
  );
}
