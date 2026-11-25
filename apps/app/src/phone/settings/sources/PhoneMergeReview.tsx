import type { MergeSuggestionView } from "@slipstream/api";
import type { ChannelId } from "@slipstream/domain";
import { m } from "@slipstream/i18n";
import { useQuery } from "@tanstack/react-query";
import { Effect } from "effect";
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
import { lineupActions, useLineupQueries } from "./lineup/queries.ts";
import { suggestionGroups, suggestionKey } from "@slipstream/domain";
import { ChannelLogo } from "./parts.tsx";
import { FormSkeleton } from "./SourcesSkeletons.tsx";
import { useRefreshAfterChange } from "./use-sources.ts";

/** What became of a suggestion on this screen. */
type Outcome = "merged" | "apart";

/** The channel kept and the others merged into it. */
const parties = (suggestion: MergeSuggestionView) => {
  const [keep, ...others] = suggestion.channels.map((channel) => channel.id);
  return { keep, others };
};

/** "2 series recordings and 14 recordings move to ZDF", from the merge preview. */
const MovesLine = ({
  keepId,
  otherIds,
  name,
}: {
  readonly keepId: ChannelId;
  readonly otherIds: readonly ChannelId[];
  readonly name: string;
}) => {
  const { colors, em, fonts } = useTheme();
  const lineup = useLineupQueries();
  const preview = useQuery({ ...lineup.mergePreview(keepId, otherIds), staleTime: 60_000 });
  return (
    <Text
      numberOfLines={1}
      style={{ fontFamily: fonts.fUi, fontSize: 0.8 * em, color: colors.fg3 }}
    >
      {preview.data === undefined
        ? " "
        : m.review_moves({
            series: preview.data.seriesRecordings,
            recordings: preview.data.recordings,
            name,
          })}
    </Text>
  );
};

/**
 * One suggestion: the channel kept (its logo and name) and every stream in the order they will
 * play ("1 Das Erste HD  Zattoo-Proxy"), what moves, and Merge and Not the same. Once decided
 * the outcome takes the buttons' place at the same height.
 */
const SuggestionRow = ({
  suggestion,
  outcome,
  busy,
  onMerge,
  onApart,
}: {
  readonly suggestion: MergeSuggestionView;
  readonly outcome: Outcome | undefined;
  readonly busy: boolean;
  readonly onMerge: () => void;
  readonly onApart: () => void;
}) => {
  const { colors, em, fonts } = useTheme();
  const [kept] = suggestion.channels;
  const { keep, others } = parties(suggestion);
  if (kept === undefined || keep === undefined) return null;
  const streams = suggestion.channels.flatMap((channel) => channel.streams);
  const faded = outcome === undefined ? 1 : 0.55;
  return (
    <View style={{ flexDirection: "row", gap: 0.8 * em, padding: em }}>
      <View style={{ opacity: faded }}>
        <ChannelLogo name={kept.name} logoUrl={kept.logoUrl} size={1.8 * em} />
      </View>
      <View style={{ flex: 1, gap: 0.25 * em }}>
        <Text
          numberOfLines={1}
          style={{
            fontFamily: fonts.fUiSemiBold,
            fontSize: 1 * em,
            color: colors.fg,
            opacity: faded,
          }}
        >
          {kept.name}
        </Text>
        {streams.map((stream, index) => (
          <View
            // Stream names repeat across sources; the place in the order does not.
            key={`${String(index)}:${stream.name}`}
            style={{ flexDirection: "row", alignItems: "center", gap: 0.5 * em, opacity: faded }}
          >
            <Text
              style={{
                width: 1.2 * em,
                textAlign: "center",
                fontFamily: fonts.fUi,
                fontSize: 0.75 * em,
                color: colors.fg3,
              }}
            >
              {String(index + 1)}
            </Text>
            <Text
              numberOfLines={1}
              style={{
                flexShrink: 1,
                fontFamily: fonts.fUi,
                fontSize: 0.85 * em,
                color: colors.fg,
              }}
            >
              {stream.name}
            </Text>
            <Text
              numberOfLines={1}
              style={{
                flexShrink: 1,
                fontFamily: fonts.fUi,
                fontSize: 0.85 * em,
                color: colors.fg3,
              }}
            >
              {stream.sourceName}
            </Text>
          </View>
        ))}
        {outcome === undefined ? (
          <MovesLine keepId={keep} otherIds={others} name={kept.name} />
        ) : null}
        {/* Buttons and outcome share one height, so deciding moves nothing. */}
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 0.6 * em,
            minHeight: 2.6 * em,
            marginTop: 0.2 * em,
          }}
        >
          {outcome === undefined ? (
            <>
              <FocusButton label={m.review_merge()} size={0.85} disabled={busy} onPress={onMerge} />
              <FocusButton
                label={m.review_not_same()}
                size={0.85}
                variant="ghost"
                disabled={busy}
                onPress={onApart}
              />
            </>
          ) : (
            <>
              <Icon
                name={outcome === "merged" ? "check" : "tv"}
                size={1.1 * em}
                color={outcome === "merged" ? colors.okText : colors.fg3}
              />
              <Text style={{ fontFamily: fonts.fUi, fontSize: 0.9 * em, color: colors.fg2 }}>
                {outcome === "merged" ? m.review_merged() : m.review_kept_apart()}
              </Text>
            </>
          )}
        </View>
      </View>
    </View>
  );
};

/**
 * The merge review on a phone (admin): suggestions grouped by confidence, each merged or kept
 * apart in place, and Merge N at the bottom for every one not decided yet. The list is the one
 * the screen opened with, so a decided row stays with its outcome.
 */
const PhoneMergeReviewPage = () => {
  const { colors, em, fonts } = useTheme();
  const insets = useSafeAreaInsets();
  const lineup = useLineupQueries();
  const { runAction } = useSession();
  const toast = useToast();
  const refreshAfter = useRefreshAfterChange();
  const review = useQuery(lineup.review());
  const [opened, setOpened] = useState<readonly MergeSuggestionView[] | undefined>(undefined);
  const [outcomes, setOutcomes] = useState<ReadonlyMap<string, Outcome>>(new Map());
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());
  const suggestions = opened ?? review.data?.mergeSuggestions;

  if (review.isError) {
    return (
      <PageStatus
        heading={m.review_merge_title()}
        title={readProblem(review.error)}
        onRetry={() => void review.refetch()}
      />
    );
  }
  const undecided = (suggestions ?? []).filter(
    (suggestion) => !outcomes.has(suggestionKey(suggestion)),
  );

  const mark = (keys: readonly string[], on: boolean) =>
    setBusy((before) => {
      const next = new Set(before);
      for (const key of keys) {
        if (on) next.add(key);
        else next.delete(key);
      }
      return next;
    });
  const decide = (list: readonly MergeSuggestionView[], outcome: Outcome) => {
    const keys = list.map(suggestionKey);
    // Keep the list the screen opened with: decided rows stay, showing their outcome.
    setOpened((before) => before ?? suggestions);
    mark(keys, true);
    runAction(
      Effect.forEach(
        list,
        (suggestion) => {
          const { keep, others } = parties(suggestion);
          return outcome === "merged" && keep !== undefined
            ? Effect.asVoid(lineupActions.merge(keep, others))
            : lineupActions.keepApart(suggestion.channels.map((channel) => channel.id));
        },
        { discard: true },
      ),
    )
      .then(() => {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        setOutcomes(
          (before) => new Map([...before, ...keys.map((key) => [key, outcome] as const)]),
        );
        return refreshAfter("channels");
      })
      .catch(() => toast({ text: m.state_not_saved() }))
      .finally(() => mark(keys, false));
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <BackHeader title={m.review_merge_title()} />
      {suggestions === undefined ? (
        <FormSkeleton fields={3} />
      ) : (
        <ScrollView contentContainerStyle={{ paddingBottom: 2 * em }}>
          {suggestionGroups(suggestions).map((group) => (
            <View key={group.reason}>
              <Text
                style={{
                  paddingHorizontal: em,
                  paddingTop: 1.2 * em,
                  paddingBottom: 0.5 * em,
                  fontFamily: fonts.fUiSemiBold,
                  fontSize: 0.85 * em,
                  color: colors.fg3,
                }}
              >
                {`${
                  group.reason === "sameGuide"
                    ? m.review_group_same_guide()
                    : m.review_group_similar()
                } · ${String(group.suggestions.length)}`}
              </Text>
              <Panel>
                {group.suggestions.map((suggestion, index) => {
                  const key = suggestionKey(suggestion);
                  return (
                    <View key={key}>
                      {index === 0 ? null : <Hairline />}
                      <SuggestionRow
                        suggestion={suggestion}
                        outcome={outcomes.get(key)}
                        busy={busy.has(key)}
                        onMerge={() => decide([suggestion], "merged")}
                        onApart={() => decide([suggestion], "apart")}
                      />
                    </View>
                  );
                })}
              </Panel>
            </View>
          ))}
        </ScrollView>
      )}
      <View
        style={{
          paddingHorizontal: em,
          paddingTop: 0.7 * em,
          paddingBottom: insets.bottom + 0.7 * em,
          borderTopWidth: 1,
          borderTopColor: colors.line,
          backgroundColor: colors.surface,
        }}
      >
        <FocusButton
          label={m.review_merge_count({ count: undecided.length })}
          variant="primary"
          disabled={undecided.length === 0 || busy.size > 0}
          onPress={() => decide(undecided, "merged")}
        />
      </View>
    </View>
  );
};

/** The merge review behind the admin gate. */
export const PhoneMergeReview = () => (
  <AdminOnly heading={m.review_merge_title()}>
    <PhoneMergeReviewPage />
  </AdminOnly>
);
