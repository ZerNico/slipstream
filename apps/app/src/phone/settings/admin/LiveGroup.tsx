import {
  keepBufferChoices,
  type KeepRunning,
  keepRunningChoices,
  type LiveKeep,
} from "@slipstream/domain";
import { keepBufferLabel, keepRunningLabel, m } from "@slipstream/i18n";
import { useState } from "react";
import { useTheme } from "../../../theme/theme.ts";
import { Icon } from "../../../ui/Icon.tsx";
import { PickerSheet } from "../../../ui/PickerSheet.tsx";
import { Group, Row } from "./parts.tsx";

/** A keep-running choice back from its picker value. */
const runningOf = (value: string): KeepRunning =>
  value === "programmeEnd" ? "programmeEnd" : Number(value);

/** The chevron that says a row opens its choices. */
const Chevron = () => {
  const { colors, em } = useTheme();
  return <Icon name="fwd" size={0.9 * em} color={colors.fg3} />;
};

/**
 * Live TV in Settings › Recording on a phone: how long a channel keeps running after its last
 * viewer left, and how long its rewind buffer stays once it stopped, each picked in a sheet.
 */
export const LiveGroup = ({
  value,
  onChange,
}: {
  readonly value: LiveKeep;
  readonly onChange: (next: LiveKeep) => void;
}) => {
  const [picking, setPicking] = useState<"running" | "buffer" | undefined>(undefined);
  const running = keepRunningLabel(value.keepRunning);
  const buffer = keepBufferLabel(value.keepBufferMinutes);
  // A value saved outside the offered steps still shows as itself.
  const runningChoices = keepRunningChoices.includes(value.keepRunning)
    ? keepRunningChoices
    : [...keepRunningChoices, value.keepRunning];
  const bufferChoices = keepBufferChoices.includes(value.keepBufferMinutes)
    ? keepBufferChoices
    : [...keepBufferChoices, value.keepBufferMinutes].toSorted((a, b) => a - b);
  return (
    <>
      <Group title={m.rec_live_title()} footer={m.rec_live_note()}>
        <Row
          key="running"
          title={m.rec_keep_running()}
          sub={running}
          label={`${m.rec_keep_running()}, ${running}`}
          end={<Chevron />}
          onPress={() => setPicking("running")}
        />
        <Row
          key="buffer"
          title={m.rec_keep_buffer()}
          sub={buffer}
          label={`${m.rec_keep_buffer()}, ${buffer}`}
          end={<Chevron />}
          onPress={() => setPicking("buffer")}
        />
      </Group>
      {picking === "running" ? (
        <PickerSheet
          title={m.rec_keep_running()}
          choices={runningChoices.map((keep) => ({
            value: String(keep),
            label: keepRunningLabel(keep),
          }))}
          selected={String(value.keepRunning)}
          onPick={(next) => onChange({ ...value, keepRunning: runningOf(next) })}
          onClose={() => setPicking(undefined)}
        />
      ) : null}
      {picking === "buffer" ? (
        <PickerSheet
          title={m.rec_keep_buffer()}
          choices={bufferChoices.map((minutes) => ({
            value: String(minutes),
            label: keepBufferLabel(minutes),
          }))}
          selected={String(value.keepBufferMinutes)}
          onPick={(next) => onChange({ ...value, keepBufferMinutes: Number(next) })}
          onClose={() => setPicking(undefined)}
        />
      ) : null}
    </>
  );
};
