import { m, pathLabels } from "@slipstream/i18n";
import { useRouter } from "expo-router";
import { FlatList, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { libraryCard } from "../../data/library.ts";
import { playerParams } from "../../player/playback.ts";
import { problemItems, watchAnyway } from "../../recordings/problem-items.ts";
import { useTheme } from "../../theme/theme.ts";
import { FocusButton } from "../../ui/FocusButton.tsx";
import { useNow } from "../../ui/use-now.ts";
import { BackHeader } from "../BackHeader.tsx";
import { EmptyState } from "../EmptyState.tsx";
import { PageStatus } from "../ui/PageStatus.tsx";
import { ListSkeleton } from "../PhoneSkeletons.tsx";
import { EntryRow } from "./EntryRow.tsx";
import { useRecordings } from "../../recordings/use-recordings.ts";
import { recordingHref } from "../../routes.ts";

/**
 * What needs attention, on a phone (the web's Problems tab): one item per damaged recording and
 * its repeats, newest first, titled as failed or incomplete, with what is missing and where the
 * search for the repeat stands, and the web's fix: Details for a failed one, Watch anyway for an
 * incomplete one. A tap opens the recording's page. A repeat that replaced its original leads for a day.
 */
export const PhoneProblems = () => {
  const { colors, em } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const now = useNow(60_000);
  const library = useRecordings();
  const labels = pathLabels();
  if (library.loading) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg }}>
        <BackHeader title={m.recordings_tab_problems()} />
        <ListSkeleton />
      </View>
    );
  }
  if (library.error !== null) {
    return (
      <PageStatus
        heading={m.recordings_tab_problems()}
        title={m.library_error_title()}
        onRetry={library.retry}
      />
    );
  }
  const items = problemItems(library.all, now);
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <BackHeader title={m.recordings_tab_problems()} />
      <FlatList
        data={items}
        keyExtractor={(item) => item.key}
        contentContainerStyle={{ flexGrow: 1, paddingBottom: insets.bottom + 1.5 * em }}
        ListEmptyComponent={<EmptyState title={m.library_problems_none()} />}
        renderItem={({ item }) => (
          <View>
            <EntryRow
              entry={item.entry}
              card={libraryCard(item.entry, library.names, labels)}
              title={item.title}
              meta={item.kind === "problem" ? item.text : undefined}
              onPress={() => router.push(recordingHref(item.entry.id))}
            />
            {item.kind === "problem" ? (
              <View
                style={{
                  flexDirection: "row",
                  flexWrap: "wrap",
                  // Under the title, past the picture (8 em) and the gap.
                  paddingLeft: 9.8 * em,
                  paddingRight: em,
                  paddingBottom: 0.6 * em,
                }}
              >
                {item.failed ? (
                  <FocusButton
                    label={m.action_details()}
                    variant="ghost"
                    size={0.8}
                    onPress={() => router.push(recordingHref(item.entry.id))}
                  />
                ) : (
                  <FocusButton
                    label={m.library_watch_anyway()}
                    icon="play"
                    variant="ghost"
                    size={0.8}
                    onPress={() =>
                      router.push({
                        pathname: "/player",
                        params: playerParams(watchAnyway(item.entry)),
                      })
                    }
                  />
                )}
              </View>
            ) : null}
          </View>
        )}
      />
    </View>
  );
};
