import type { RulePreview } from "@slipstream/api";
import {
  type ChannelId,
  epochMs,
  localParts,
  markTitle,
  recordedCount,
  skipMarkParts,
  type TitleCondition,
} from "@slipstream/domain";
import { formatters, m, seriesSkipMark } from "@slipstream/i18n";
import { Text, View } from "react-native";
import { useTheme } from "../../theme/theme.ts";
import { Bone, Skeleton } from "../../ui/Skeleton.tsx";
import { Section } from "./parts.tsx";
import { Hairline } from "../ui/settings.tsx";

/** What the preview shows: the server's matches, a reason it can't, or that it is working. */
export type PreviewState =
  | { readonly kind: "ready"; readonly preview: RulePreview; readonly refreshing: boolean }
  | { readonly kind: "loading" }
  | { readonly kind: "waiting" }
  | { readonly kind: "failed" };

type Match = RulePreview["matches"][number];

/** One airing: the day, the title with what matched marked, the time and channel, its mark. */
const Row = ({
  match,
  conditions,
  channelName,
  isNew,
  timeZone,
  now,
}: {
  readonly match: Match;
  readonly conditions: readonly TitleCondition[];
  readonly channelName: (id: ChannelId) => string;
  readonly isNew: boolean;
  readonly timeZone: string;
  readonly now: number;
}) => {
  const { colors, em, fonts } = useTheme();
  const { programme } = match;
  const start = epochMs(programme.start);
  const end = epochMs(programme.end);
  const day = localParts(programme.start, timeZone);
  const parts =
    match.skip === undefined ? undefined : skipMarkParts(match.skip, { isNew, timeZone });
  const mark = parts === undefined ? undefined : seriesSkipMark(parts);
  const leftOut = mark?.kind === "left-out";
  const live = !leftOut && start <= now && now < end;
  const meta = [
    formatters().timeRange(new Date(start), new Date(end)),
    channelName(programme.channelId),
    ...(live ? [m.series_preview_now()] : []),
    ...(mark?.kind === "note" ? [mark.text] : []),
  ].join(" · ");
  return (
    <View
      style={{
        flexDirection: "row",
        gap: 0.8 * em,
        paddingHorizontal: em,
        paddingVertical: 0.6 * em,
      }}
    >
      <View style={{ width: 2.4 * em, alignItems: "center" }}>
        <Text style={{ fontFamily: fonts.fUiSemiBold, fontSize: 0.72 * em, color: colors.fg3 }}>
          {m.series_weekday_abbr({ day: day.weekday })}
        </Text>
        <Text style={{ fontFamily: fonts.fDisplay, fontSize: 1.05 * em, color: colors.fg }}>
          {day.day}
        </Text>
      </View>
      <View style={{ flex: 1, gap: 0.15 * em }}>
        <Text
          style={{
            fontFamily: fonts.fUiMedium,
            fontSize: 0.92 * em,
            color: leftOut ? colors.fg2 : colors.fg,
          }}
        >
          {markTitle(programme.title, conditions).map((run, index) => (
            <Text
              // oxlint-disable-next-line react/no-array-index-key -- runs are positional
              key={index}
              style={
                run.marked ? { fontFamily: fonts.fUiSemiBold, color: colors.okText } : undefined
              }
            >
              {run.text}
            </Text>
          ))}
        </Text>
        <Text style={{ fontFamily: fonts.fUi, fontSize: 0.8 * em, color: colors.fg3 }}>{meta}</Text>
        {leftOut ? (
          <Text style={{ fontFamily: fonts.fUi, fontSize: 0.8 * em, color: colors.fg3 }}>
            {mark.text}
          </Text>
        ) : null}
      </View>
    </View>
  );
};

/** A quiet line in place of rows: nothing matches yet, or why the preview can't run. */
const Hint = ({ text }: { readonly text: string }) => {
  const { colors, em, fonts } = useTheme();
  return (
    <Text
      style={{
        paddingHorizontal: em,
        paddingVertical: 0.9 * em,
        fontFamily: fonts.fUi,
        fontSize: 0.88 * em,
        color: colors.fg3,
      }}
    >
      {text}
    </Text>
  );
};

/** Three rows in the rows' shapes while the first answer is out. */
const RowsSkeleton = () => {
  const { em } = useTheme();
  return (
    <Skeleton>
      {[0, 1, 2].map((row) => (
        <View
          key={row}
          style={{
            flexDirection: "row",
            gap: 0.8 * em,
            paddingHorizontal: em,
            paddingVertical: 0.6 * em,
          }}
        >
          <Bone width={2.4 * em} height={2.2 * em} />
          <View style={{ flex: 1, gap: 0.4 * em }}>
            <Bone width={row === 1 ? "60%" : "80%"} height={0.92 * em} />
            <Bone width="50%" height={0.8 * em} />
          </View>
        </View>
      ))}
    </Skeleton>
  );
};

/**
 * The editor's live preview (SPEC §8.6): what the draft will record over the next 14 days, with
 * the airings it leaves out and why. While a change is asked about, the last answer stays (dimmed)
 * so the form below never jumps.
 */
export const Preview = ({
  state,
  conditions,
  channelName,
  isNew,
  timeZone,
  now,
}: {
  readonly state: PreviewState;
  readonly conditions: readonly TitleCondition[];
  readonly channelName: (id: ChannelId) => string;
  readonly isNew: boolean;
  readonly timeZone: string;
  readonly now: number;
}) => {
  const { colors, em, fonts } = useTheme();
  const matches = state.kind === "ready" ? state.preview.matches : [];
  return (
    <Section
      title={m.series_preview()}
      aside={
        <Text style={{ fontFamily: fonts.fUi, fontSize: 0.85 * em, color: colors.fg3 }}>
          {state.kind === "ready" ? m.series_preview_count({ count: recordedCount(matches) }) : ""}
        </Text>
      }
    >
      {state.kind === "loading" ? (
        <RowsSkeleton />
      ) : state.kind === "failed" ? (
        <Hint text={m.series_preview_failed()} />
      ) : state.kind === "waiting" || matches.length === 0 ? (
        <Hint text={m.series_preview_empty()} />
      ) : (
        <View style={{ opacity: state.refreshing ? 0.6 : 1 }}>
          {matches.map((match, index) => (
            <View key={match.programme.id}>
              {index === 0 ? null : <Hairline />}
              <Row
                match={match}
                conditions={conditions}
                channelName={channelName}
                isNew={isNew}
                timeZone={timeZone}
                now={now}
              />
            </View>
          ))}
        </View>
      )}
    </Section>
  );
};
