import { epochMs } from "@slipstream/domain";
import { dayPill, formatters, m, pathLabels } from "@slipstream/i18n";
import { householdZone } from "../../data/zone.ts";
import { useState } from "react";
import { SectionList, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { libraryCard } from "../../data/library.ts";
import { RecordingSheet } from "../../recordings/RecordingSheet.tsx";
import { ResolvePanel } from "../../recordings/ResolvePanel.tsx";
import { useResolve, useScheduled } from "../../recordings/use-scheduled.ts";
import { useTheme } from "../../theme/theme.ts";
import { useNow } from "../../ui/use-now.ts";
import { BackHeader } from "../BackHeader.tsx";
import { EmptyState } from "../EmptyState.tsx";
import { PageStatus } from "../ui/PageStatus.tsx";
import { ListSkeleton } from "../PhoneSkeletons.tsx";
import { EntryRow } from "./EntryRow.tsx";

/**
 * What is scheduled, on a phone (the web's Scheduled tab): by household day in start order,
 * each row with its time and channel, a clash with another recording said in its line. Under
 * the last item of an overlap, what overlaps and the ways out (skip one, end one early). A tap
 * opens the recording's sheet, where it can be cancelled.
 */
export const PhoneScheduled = () => {
  const { colors, em, fonts } = useTheme();
  const insets = useSafeAreaInsets();
  const now = useNow(60_000);
  const scheduled = useScheduled();
  const resolve = useResolve();
  const [open, setOpen] = useState<string | undefined>(undefined);
  const labels = pathLabels();
  if (scheduled.loading) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg }}>
        <BackHeader title={m.library_title_scheduled()} />
        <ListSkeleton />
      </View>
    );
  }
  if (scheduled.error !== null) {
    return (
      <PageStatus
        heading={m.library_title_scheduled()}
        title={m.library_error_title()}
        onRetry={scheduled.retry}
      />
    );
  }
  const sections = scheduled.days.map((day) => ({
    key: String(day.day),
    midday: day.midday,
    data: day.rows,
  }));
  const opened = scheduled.all.find((entry) => entry.id === open);

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <BackHeader title={m.library_title_scheduled()} />
      <SectionList
        sections={sections}
        keyExtractor={(row) => row.entry.id}
        stickySectionHeadersEnabled
        contentContainerStyle={{ flexGrow: 1, paddingBottom: insets.bottom + 1.5 * em }}
        ListEmptyComponent={<EmptyState title={m.recordings_upcoming_empty()} />}
        renderSectionHeader={({ section }) => (
          <Text
            accessibilityRole="header"
            style={{
              fontFamily: fonts.fUiSemiBold,
              fontSize: 0.95 * em,
              color: colors.fg2,
              backgroundColor: colors.bg,
              paddingHorizontal: em,
              paddingTop: 0.9 * em,
              paddingBottom: 0.35 * em,
            }}
          >
            {dayPill(section.midday, now, householdZone())}
          </Text>
        )}
        renderItem={({ item: row }) => {
          const { entry } = row;
          // The day is the section's heading: the row says only when in it.
          const slot = formatters().timeRange(
            new Date(epochMs(entry.start)),
            new Date(epochMs(entry.end)),
          );
          const channel = scheduled.names.get(entry.channelId) ?? "";
          return (
            <View>
              <EntryRow
                entry={entry}
                card={libraryCard(entry, scheduled.names, labels)}
                meta={[
                  row.conflict ? m.status_conflict() : undefined,
                  slot,
                  channel === "" ? undefined : channel,
                ]
                  .filter((part) => part !== undefined)
                  .join(" · ")}
                onPress={() => setOpen(entry.id)}
              />
              {row.resolution === undefined ? null : (
                <View
                  style={{ paddingHorizontal: em, paddingTop: 0.2 * em, paddingBottom: 0.7 * em }}
                >
                  <ResolvePanel
                    resolution={row.resolution}
                    busy={resolve.busy}
                    onPick={resolve.pick}
                  />
                </View>
              )}
            </View>
          );
        }}
      />
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
