import type { ChannelRef } from "@slipstream/api";
import type { ChannelId } from "@slipstream/domain";
import { formatters, m } from "@slipstream/i18n";
import { useQuery } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";
import { useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { readProblem } from "../../../api/failure.ts";
import { useSession } from "../../../session/session-context.ts";
import { useTheme } from "../../../theme/theme.ts";
import { FocusButton } from "../../../ui/FocusButton.tsx";
import { Icon } from "../../../ui/Icon.tsx";
import { useToast } from "../../../ui/toast.ts";
import { BackHeader } from "../../BackHeader.tsx";
import { Hairline, Panel } from "../../ui/settings.tsx";
import { AdminOnly, PageStatus } from "../../ui/PageStatus.tsx";
import { AddStreamSheet } from "./lineup/add-stream.tsx";
import { lineupActions, useLineupQueries } from "./lineup/queries.ts";
import { type GoneChannel, goneChannels, reviewSummary } from "@slipstream/domain";
import { ChannelLogo } from "./parts.tsx";
import { FormSkeleton } from "./SourcesSkeletons.tsx";
import { useRefreshAfterChange } from "./use-sources.ts";

/**
 * One channel a dropped stream touched: with a stream left it plays on (a quiet tick and its
 * source); with none left it is red, with Choose stream… and Hide.
 */
const GoneRow = ({
  entry,
  hidden,
  onChoose,
  onHide,
}: {
  readonly entry: GoneChannel;
  readonly hidden: boolean;
  readonly onChoose: () => void;
  readonly onHide: () => void;
}) => {
  const { colors, em, fonts } = useTheme();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 0.8 * em, padding: em }}>
      <ChannelLogo name={entry.channel.name} logoUrl={undefined} size={1.8 * em} />
      <View style={{ flex: 1, gap: 0.15 * em }}>
        <Text
          numberOfLines={1}
          style={{ fontFamily: fonts.fUiSemiBold, fontSize: 0.98 * em, color: colors.fg }}
        >
          {entry.channel.name}
        </Text>
        {entry.noStream ? (
          <Text style={{ fontFamily: fonts.fUi, fontSize: 0.85 * em, color: colors.liveText }}>
            {hidden
              ? m.review_hidden_named({ name: entry.channel.name })
              : m.review_no_stream_left()}
          </Text>
        ) : (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 0.3 * em }}>
            <Icon name="check" size={0.9 * em} color={colors.fg3} />
            <Text
              numberOfLines={1}
              style={{
                flexShrink: 1,
                fontFamily: fonts.fUi,
                fontSize: 0.85 * em,
                color: colors.fg2,
              }}
            >
              {entry.playsFrom === undefined
                ? formatters().list(entry.gone)
                : m.review_plays_from({ source: entry.playsFrom })}
            </Text>
          </View>
        )}
        {entry.noStream && !hidden ? (
          <View style={{ flexDirection: "row", gap: 0.5 * em, marginTop: 0.3 * em }}>
            <FocusButton label={m.review_choose_stream()} size={0.8} onPress={onChoose} />
            <FocusButton
              label={m.review_hide_named({ name: entry.channel.name })}
              size={0.8}
              variant="ghost"
              onPress={onHide}
            />
          </View>
        ) : null}
      </View>
    </View>
  );
};

/**
 * Streams gone, on a phone (admin): every channel a playlist dropped a stream of, those with no
 * stream left first. A stream from any source can take the place of the one gone.
 */
const PhoneGoneReviewPage = () => {
  const { colors, em, fonts } = useTheme();
  const insets = useSafeAreaInsets();
  const lineup = useLineupQueries();
  const { runAction } = useSession();
  const toast = useToast();
  const refreshAfter = useRefreshAfterChange();
  const review = useQuery(lineup.review());
  const [choosing, setChoosing] = useState<ChannelRef | undefined>(undefined);
  const [hidden, setHidden] = useState<ReadonlySet<ChannelId>>(new Set());

  if (review.isError) {
    return (
      <PageStatus
        heading={m.review_gone_title()}
        title={readProblem(review.error)}
        onRetry={() => void review.refetch()}
      />
    );
  }
  const hide = (channel: ChannelRef) => {
    void Haptics.selectionAsync();
    setHidden((before) => new Set([...before, channel.id]));
    runAction(lineupActions.update(channel.id, { hidden: true }))
      .then(() => refreshAfter("channels"))
      .catch(() => {
        setHidden((before) => new Set([...before].filter((id) => id !== channel.id)));
        toast({ text: m.state_not_saved() });
      });
  };
  const entries = review.data === undefined ? undefined : goneChannels(review.data);
  const summary = review.data === undefined ? undefined : reviewSummary(review.data);

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <BackHeader title={m.review_gone_title()} />
      {entries === undefined || summary === undefined ? (
        <FormSkeleton fields={3} />
      ) : (
        <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 2 * em }}>
          <Text
            numberOfLines={1}
            style={{
              paddingHorizontal: em,
              paddingBottom: 0.6 * em,
              fontFamily: fonts.fUi,
              fontSize: 0.85 * em,
              color: colors.fg3,
            }}
          >
            {summary.goneStreams === 0
              ? m.review_no_stream_count({ count: summary.withoutStreams })
              : m.review_gone_subtitle({
                  count: summary.goneStreams,
                  sources: formatters().list(summary.goneSources),
                })}
          </Text>
          <Panel>
            {entries.length === 0 ? (
              <Text
                style={{
                  padding: em,
                  fontFamily: fonts.fUi,
                  fontSize: 0.9 * em,
                  color: colors.fg3,
                }}
              >
                {m.review_all_done()}
              </Text>
            ) : (
              entries.map((entry, index) => (
                <View key={entry.channel.id}>
                  {index === 0 ? null : <Hairline />}
                  <GoneRow
                    entry={entry}
                    hidden={hidden.has(entry.channel.id)}
                    onChoose={() => setChoosing(entry.channel)}
                    onHide={() => hide(entry.channel)}
                  />
                </View>
              ))
            )}
          </Panel>
        </ScrollView>
      )}
      {choosing === undefined ? null : (
        <AddStreamSheet channel={choosing} onClose={() => setChoosing(undefined)} />
      )}
    </View>
  );
};

/** The gone-streams review behind the admin gate. */
export const PhoneGoneReview = () => (
  <AdminOnly heading={m.review_gone_title()}>
    <PhoneGoneReviewPage />
  </AdminOnly>
);
