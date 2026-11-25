import { m } from "@slipstream/i18n";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useApiQueries } from "../../../data/hooks.ts";
import { readProblem } from "../../../api/failure.ts";
import { ActionRow, Panel } from "../../ui/settings.tsx";
import { AdminOnly, PageStatus } from "../../ui/PageStatus.tsx";
import { useTheme } from "../../../theme/theme.ts";
import { FocusButton } from "../../../ui/FocusButton.tsx";
import { useNow } from "../../../ui/use-now.ts";
import { BackHeader } from "../../BackHeader.tsx";
import { useLineupQueries } from "./lineup/queries.ts";
import { NeedsReview } from "./NeedsReview.tsx";
import { GroupHeading } from "./parts.tsx";
import { SourceCard } from "./SourceCard.tsx";
import { SourcesSkeleton } from "./SourcesSkeletons.tsx";
import { channelsHref, newSourceHref } from "../../../routes.ts";

/**
 * Settings › Sources & channels on a phone (admin): Needs review first while something is left
 * (merge, new and gone streams), then every source with its health, what it offers and its
 * stream budget, Refresh, Edit and Pause; Add source in the header; the channel list one row
 * below.
 */
const PhoneSourcesPage = () => {
  const { colors, em, fonts } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const now = useNow(60_000);
  const queries = useApiQueries();
  const sources = useQuery(queries.sources());
  const usage = useQuery(queries.streamsUsage());
  const channels = useQuery(queries.allChannels());
  // Needs review sits above the sources: the page waits for it, so nothing moves down later.
  const review = useQuery(useLineupQueries().review());
  const reviewPending = review.data === undefined && !review.isError;

  if (sources.isError) {
    return (
      <PageStatus
        heading={m.settings_section_sources()}
        title={readProblem(sources.error)}
        onRetry={() => void sources.refetch()}
      />
    );
  }
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <BackHeader
        title={m.settings_section_sources()}
        action={
          <FocusButton
            label={m.source_add()}
            icon="plus"
            iconOnly
            size={0.85}
            onPress={() => router.push(newSourceHref)}
          />
        }
      />
      {sources.data === undefined || reviewPending ? (
        <SourcesSkeleton />
      ) : (
        <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 2 * em }}>
          <NeedsReview />
          <GroupHeading text={m.sources_heading()} />
          {sources.data.length === 0 ? (
            <View style={{ marginHorizontal: em, gap: 0.8 * em, paddingVertical: 0.5 * em }}>
              <Text style={{ fontFamily: fonts.fUi, fontSize: 0.95 * em, color: colors.fg2 }}>
                {m.sources_empty()}
              </Text>
              <FocusButton
                label={m.source_add()}
                icon="plus"
                variant="primary"
                onPress={() => router.push(newSourceHref)}
              />
            </View>
          ) : (
            <View style={{ gap: 0.7 * em }}>
              {sources.data.map((source) => (
                <SourceCard
                  key={source.id}
                  source={source}
                  usage={usage.data?.find((item) => item.sourceId === source.id)}
                  now={now}
                />
              ))}
            </View>
          )}
          <View style={{ height: 1.2 * em }} />
          <Panel>
            <ActionRow
              icon="tv"
              title={m.channels_heading()}
              value={
                channels.data === undefined
                  ? undefined
                  : m.channels_count({ count: channels.data.length })
              }
              onPress={() => router.push(channelsHref)}
            />
          </Panel>
        </ScrollView>
      )}
    </View>
  );
};

/** PhoneSources behind the admin gate. */
export const PhoneSources = () => (
  <AdminOnly heading={m.settings_section_sources()}>
    <PhoneSourcesPage />
  </AdminOnly>
);
