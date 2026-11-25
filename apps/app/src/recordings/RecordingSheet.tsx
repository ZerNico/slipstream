import type { RecordingEntry } from "@slipstream/api";
import { formatters, m, recordingFacts } from "@slipstream/i18n";
import { householdZone } from "../data/zone.ts";
import { useState } from "react";
import { Text, View } from "react-native";
import { problemLine } from "../data/recording-text.ts";
import { useTheme } from "../theme/theme.ts";
import { OptionRow } from "../ui/OptionRow.tsx";
import { Chip } from "../ui/Chip.tsx";
import { Icon } from "../ui/Icon.tsx";
import { Sheet } from "../ui/Sheet.tsx";
import { useNow } from "../ui/use-now.ts";
import { playRows, useRecordingActions } from "./use-recording-actions.ts";

/**
 * A recording's own sheet (the web's recording page, TV side sheet or phone bottom sheet): the
 * title, one quiet meta line (channel · when · length · size), the problem in one line when it
 * has one, then the ways to watch, Protect, and Delete with a confirm step.
 */
export const RecordingSheet = ({
  entry,
  entries,
  channelName,
  onClose,
}: {
  readonly entry: RecordingEntry;
  /** The library, for the repeat that replaces a damaged recording. */
  readonly entries: readonly RecordingEntry[];
  readonly channelName: string;
  readonly onClose: () => void;
}) => {
  const { colors, em, fonts } = useTheme();
  const now = useNow(30_000);
  const [confirming, setConfirming] = useState(false);
  const problem = problemLine(entry, entries, now);
  const rows = playRows(entry, now);
  const { play, protect, remove } = useRecordingActions(entry, onClose);

  const running = entry.state === "recording";
  const size = formatters().size(entry.sizeBytes);

  return (
    <Sheet label={entry.title} onClose={onClose}>
      <View style={{ gap: 0.45 * em }}>
        {running ? (
          <View style={{ flexDirection: "row" }}>
            <Chip label={m.status_recording()} tone="rec" size={0.85} />
          </View>
        ) : null}
        <Text
          numberOfLines={3}
          style={{ fontFamily: fonts.fUiSemiBold, fontSize: 1.6 * em, color: colors.fg }}
        >
          {entry.title}
        </Text>
        <Text style={{ fontFamily: fonts.fUi, fontSize: 0.95 * em, color: colors.fg2 }}>
          {recordingFacts(entry, now, householdZone(), channelName)}
        </Text>
        {problem === undefined ? null : (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 0.5 * em }}>
            <Icon
              name="warn"
              size={1.1 * em}
              color={problem.failed ? colors.liveText : colors.warnText}
            />
            <Text
              style={{
                flex: 1,
                fontFamily: fonts.fUi,
                fontSize: 0.95 * em,
                color: problem.failed ? colors.liveText : colors.warnText,
              }}
            >
              {problem.text}
            </Text>
          </View>
        )}
      </View>
      {confirming ? (
        <View style={{ gap: 0.3 * em, marginTop: 0.6 * em }}>
          <Text style={{ fontFamily: fonts.fUi, fontSize: em, color: colors.fg2 }}>
            {m.library_delete_question({ size })}
          </Text>
          <OptionRow icon="delete" title={m.action_delete()} preferredFocus onPress={remove} />
          <OptionRow title={m.action_cancel()} onPress={() => setConfirming(false)} />
        </View>
      ) : (
        <View style={{ gap: 0.3 * em, marginTop: 0.6 * em }}>
          {rows.map((row, index) => (
            <OptionRow
              key={row.key}
              icon={row.icon}
              title={row.title}
              preferredFocus={index === 0}
              onPress={() => play(row.target)}
            />
          ))}
          <OptionRow
            icon="lock"
            title={m.library_protect()}
            selected={entry.protected}
            preferredFocus={rows.length === 0}
            onPress={protect}
          />
          <OptionRow
            icon="delete"
            title={m.library_delete_ask()}
            onPress={() => setConfirming(true)}
          />
        </View>
      )}
    </Sheet>
  );
};
