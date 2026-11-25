import { m } from "@slipstream/i18n";
import { useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { problemItems } from "../../recordings/problem-items.ts";
import { RecordingSheet } from "../../recordings/RecordingSheet.tsx";
import { useRecordings } from "../../recordings/use-recordings.ts";
import { useTheme } from "../../theme/theme.ts";
import { useNow } from "../../ui/use-now.ts";
import { OptionRow } from "../../ui/OptionRow.tsx";
import { Rail, RailContent } from "../Rail.tsx";
import { ListBones, TvSkeleton, TvStatus, TvTitle } from "../TvStatus.tsx";
import { useReturnFocus } from "./use-tv-navigation.ts";

/**
 * What needs attention, on TV (the web's Problems tab): one row per damaged recording and its
 * repeats, newest first, titled as failed or incomplete, with what is missing and where the
 * search for the repeat stands; a repeat that replaced its original leads for a day. OK opens
 * the recording's sheet: Play (watch anyway) for an incomplete one, its details, Delete. Closing
 * it brings focus back to the row.
 */
export const TvProblems = () => {
  const { colors, em, fonts } = useTheme();
  const now = useNow(60_000);
  const [open, setOpen] = useState<string | undefined>(undefined);
  const { all: entries, names, loading, error, retry } = useRecordings();
  const items = problemItems(entries, now);
  const opened = entries.find((entry) => entry.id === open);
  const keys = items.map((item) => item.key);
  const { target, opening } = useReturnFocus({
    keys,
    first: keys[0],
    covered: opened !== undefined,
  });

  if (loading) {
    return (
      <TvSkeleton current="recordings" title={m.recordings_tab_problems()}>
        <ListBones />
      </TvSkeleton>
    );
  }
  if (error !== null && entries.length === 0) {
    return <TvStatus current="recordings" title={m.library_error_title()} onRetry={retry} />;
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
          <TvTitle>{m.recordings_tab_problems()}</TvTitle>
          {items.length === 0 ? (
            <Text style={{ fontFamily: fonts.fUiSemiBold, fontSize: 2 * em, color: colors.fg }}>
              {m.library_problems_none()}
            </Text>
          ) : (
            <View style={{ gap: 0.4 * em, maxWidth: 70 * em }}>
              {items.map((item) => (
                <OptionRow
                  key={item.key}
                  icon={item.kind === "replaced" ? "check" : "warn"}
                  title={item.title}
                  hint={item.kind === "problem" ? item.text : undefined}
                  preferredFocus={target === item.key}
                  onPress={() => {
                    opening(item.key);
                    setOpen(item.entry.id);
                  }}
                />
              ))}
            </View>
          )}
        </ScrollView>
      </RailContent>
      {opened === undefined ? null : (
        <RecordingSheet
          entry={opened}
          entries={entries}
          channelName={names.get(opened.channelId) ?? ""}
          onClose={() => setOpen(undefined)}
        />
      )}
    </View>
  );
};
