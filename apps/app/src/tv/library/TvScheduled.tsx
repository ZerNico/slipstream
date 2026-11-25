import type { RecordingEntry } from "@slipstream/api";
import { epochMs, type ScheduledDay } from "@slipstream/domain";
import { dayPill, m } from "@slipstream/i18n";
import { householdZone } from "../../data/zone.ts";
import { useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { RecordingSheet } from "../../recordings/RecordingSheet.tsx";
import { ResolvePanel } from "../../recordings/ResolvePanel.tsx";
import { useResolve, useScheduled } from "../../recordings/use-scheduled.ts";
import { useTheme } from "../../theme/theme.ts";
import { Chip } from "../../ui/Chip.tsx";
import { useNow } from "../../ui/use-now.ts";
import { OptionRow } from "../../ui/OptionRow.tsx";
import { Rail, RailContent } from "../Rail.tsx";
import { ListBones, TvSkeleton, TvStatus, TvTitle } from "../TvStatus.tsx";
import { useReturnFocus } from "./use-tv-navigation.ts";

/** One household day: its pill, its recordings in start order, a resolution under an overlap. */
const DaySection = ({
  day,
  now,
  names,
  target,
  busy,
  onOpen,
  onPick,
}: {
  readonly day: ScheduledDay<RecordingEntry>;
  readonly now: number;
  readonly names: ReadonlyMap<string, string>;
  /** What asks for focus now (useReturnFocus). */
  readonly target: string | undefined;
  readonly busy: string | undefined;
  readonly onOpen: (entry: RecordingEntry) => void;
  readonly onPick: ReturnType<typeof useResolve>["pick"];
}) => {
  const { colors, em, fonts } = useTheme();
  return (
    <View style={{ gap: 0.4 * em }}>
      <Text style={{ fontFamily: fonts.fUiSemiBold, fontSize: 1.25 * em, color: colors.fg2 }}>
        {dayPill(day.midday, now, householdZone())}
      </Text>
      {day.rows.map((row) => {
        const { entry } = row;
        const channel = names.get(entry.channelId) ?? "";
        const slot = m.recordings_slot({
          start: new Date(epochMs(entry.start)),
          end: new Date(epochMs(entry.end)),
        });
        return (
          <View key={entry.id} style={{ gap: 0.5 * em }}>
            <OptionRow
              icon={row.conflict ? "warn" : "clock"}
              title={entry.title}
              hint={channel === "" ? slot : `${slot} · ${channel}`}
              preferredFocus={target === entry.id}
              onPress={() => onOpen(entry)}
            >
              {row.conflict ? <Chip label={m.status_conflict()} tone="warn" /> : null}
            </OptionRow>
            {row.resolution === undefined ? null : (
              <View style={{ paddingLeft: em, paddingBottom: 0.6 * em }}>
                <ResolvePanel resolution={row.resolution} busy={busy} onPick={onPick} />
              </View>
            )}
          </View>
        );
      })}
    </View>
  );
};

/**
 * What is scheduled, on TV (the web's Scheduled tab): by household day in start order, every
 * item of an overlap flagged, and under the last item of an overlap what overlaps and the ways
 * out (skip one, end one early) as focusable buttons. OK on a row opens the recording's sheet,
 * where it can be cancelled; closing it brings focus back to the row (or the first, when the
 * recording went).
 */
export const TvScheduled = () => {
  const { colors, em, fonts } = useTheme();
  const now = useNow(60_000);
  const scheduled = useScheduled();
  const resolve = useResolve();
  const [open, setOpen] = useState<string | undefined>(undefined);
  // Read from the live list, so a skipped recording's sheet closes.
  const opened = scheduled.all.find((entry) => entry.id === open);
  const keys = scheduled.days.flatMap((day) => day.rows.map((row) => row.entry.id));
  const { target, opening } = useReturnFocus({
    keys,
    first: keys[0],
    covered: opened !== undefined,
  });

  if (scheduled.loading) {
    return (
      <TvSkeleton current="recordings" title={m.library_title_scheduled()}>
        <ListBones />
      </TvSkeleton>
    );
  }
  if (scheduled.error !== null && scheduled.all.length === 0) {
    return (
      <TvStatus current="recordings" title={m.library_error_title()} onRetry={scheduled.retry} />
    );
  }

  return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.bg }]}>
      <Rail current="recordings" />
      <RailContent>
        <ScrollView
          style={StyleSheet.absoluteFill}
          contentContainerStyle={{
            paddingLeft: 3 * em,
            paddingRight: 4 * em,
            paddingTop: 2.7 * em,
            paddingBottom: 3 * em,
            gap: 2 * em,
          }}
        >
          <TvTitle>{m.library_title_scheduled()}</TvTitle>
          {scheduled.days.length === 0 ? (
            <Text style={{ fontFamily: fonts.fUiSemiBold, fontSize: 2 * em, color: colors.fg }}>
              {m.recordings_upcoming_empty()}
            </Text>
          ) : (
            <View style={{ gap: 2 * em, maxWidth: 70 * em }}>
              {scheduled.days.map((day) => (
                <DaySection
                  key={day.day}
                  day={day}
                  now={now}
                  names={scheduled.names}
                  target={target}
                  busy={resolve.busy}
                  onOpen={(entry) => {
                    opening(entry.id);
                    setOpen(entry.id);
                  }}
                  onPick={resolve.pick}
                />
              ))}
            </View>
          )}
        </ScrollView>
      </RailContent>
      {opened === undefined ? null : (
        <RecordingSheet
          entry={opened}
          entries={scheduled.all}
          channelName={scheduled.names.get(opened.channelId) ?? ""}
          onClose={() => setOpen(undefined)}
        />
      )}
    </View>
  );
};
