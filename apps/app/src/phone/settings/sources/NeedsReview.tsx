import { formatters, m } from "@slipstream/i18n";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { Pressable, Text, View } from "react-native";
import { goneReviewHref, mergeReviewHref } from "../../../routes.ts";
import { useTheme } from "../../../theme/theme.ts";
import { Icon, type IconName } from "../../../ui/Icon.tsx";
import { Hairline, Panel } from "../../ui/settings.tsx";
import { useLineupQueries } from "./lineup/queries.ts";
import { hasReview, reviewSummary } from "@slipstream/domain";
import { GroupHeading } from "./parts.tsx";
import { streamPickerHref } from "./use-stream-picker.ts";

/** One row: an icon tile (red for a channel without a stream), title, a line under it, chevron. */
const ReviewRow = ({
  icon,
  title,
  line,
  alarm = false,
  onPress,
}: {
  readonly icon: IconName;
  readonly title: string;
  readonly line: string | undefined;
  /** Something already fails: a channel has no stream left. */
  readonly alarm?: boolean;
  readonly onPress: () => void;
}) => {
  const { colors, em, fonts, radii } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={line === undefined ? title : `${title}, ${line}`}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: 0.8 * em,
        paddingHorizontal: em,
        paddingVertical: 0.7 * em,
        backgroundColor: pressed ? colors.raised : "transparent",
      })}
    >
      <View
        style={{
          width: 2.2 * em,
          height: 2.2 * em,
          borderRadius: radii.rM,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: colors.raised,
        }}
      >
        <Icon name={icon} size={1.15 * em} color={alarm ? colors.liveText : colors.fg2} />
      </View>
      <View style={{ flex: 1, gap: 0.1 * em }}>
        <Text
          numberOfLines={1}
          style={{ fontFamily: fonts.fUiSemiBold, fontSize: 0.98 * em, color: colors.fg }}
        >
          {title}
        </Text>
        {line === undefined ? null : (
          <Text
            numberOfLines={1}
            style={{
              fontFamily: fonts.fUi,
              fontSize: 0.85 * em,
              color: alarm ? colors.liveText : colors.fg2,
            }}
          >
            {line}
          </Text>
        )}
      </View>
      <View style={{ transform: [{ rotate: "180deg" }] }}>
        <Icon name="chevronLeft" size={1.2 * em} color={colors.fg3} />
      </View>
    </Pressable>
  );
};

/**
 * Needs review at the top of Sources & channels (phones): channels in several sources, new
 * streams and streams gone, one row each, only while there is something to look at. Only a
 * channel left without a stream is red.
 */
export const NeedsReview = () => {
  const router = useRouter();
  const lineup = useLineupQueries();
  const review = useQuery(lineup.review());
  if (review.data === undefined) return null;
  const summary = reviewSummary(review.data);
  if (!hasReview(summary)) return null;
  const f = formatters();
  const firstNew = summary.newSources[0];
  const rows = [
    summary.merge === 0 ? null : (
      <ReviewRow
        key="merge"
        icon="tv"
        title={m.review_merge_card({ count: summary.merge, sources: summary.mergeSources })}
        line={undefined}
        onPress={() => router.push(mergeReviewHref)}
      />
    ),
    firstNew === undefined ? null : (
      <ReviewRow
        key="new"
        icon="plus"
        title={m.review_new_card({ count: summary.newStreams })}
        line={f.list(summary.newSources.map((source) => source.name))}
        onPress={() => router.push(streamPickerHref(firstNew.id, "new"))}
      />
    ),
    summary.goneStreams === 0 && summary.withoutStreams === 0 ? null : (
      <ReviewRow
        key="gone"
        icon="warn"
        alarm={summary.withoutStreams > 0}
        title={
          summary.goneStreams > 0
            ? m.review_gone_card({ count: summary.goneStreams })
            : m.review_no_stream_count({ count: summary.withoutStreams })
        }
        line={
          summary.goneStreams > 0 && summary.withoutStreams > 0
            ? m.review_no_stream_count({ count: summary.withoutStreams })
            : summary.goneSources.length > 0
              ? f.list(summary.goneSources)
              : undefined
        }
        onPress={() => router.push(goneReviewHref)}
      />
    ),
  ].filter((row) => row !== null);
  return (
    <>
      <GroupHeading text={m.review_heading()} />
      <Panel>
        {rows.map((row, index) => (
          <View key={row.key}>
            {index === 0 ? null : <Hairline />}
            {row}
          </View>
        ))}
      </Panel>
    </>
  );
};
