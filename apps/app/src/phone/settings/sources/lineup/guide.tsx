import type { GuideChannelView } from "@slipstream/api";
import { type Channel, epochMs } from "@slipstream/domain";
import { formatters, m } from "@slipstream/i18n";
import { useQuery } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";
import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useSession } from "../../../../session/session-context.ts";
import { useTheme } from "../../../../theme/theme.ts";
import { OptionRow } from "../../../../ui/OptionRow.tsx";
import { Sheet, SheetTitle } from "../../../../ui/Sheet.tsx";
import { TextField } from "../../../../ui/TextField.tsx";
import { useToast } from "../../../../ui/toast.ts";
import { Panel, Hairline } from "../../../ui/settings.tsx";
import { useRefreshAfterChange } from "../use-sources.ts";
import { lineupActions, useLineupQueries } from "./queries.ts";

/** Typing settles for this long before the guide channels are searched. */
const SEARCH_DELAY_MS = 250;

/** What is on now, why a suggestion fits, and how many channels use it already. */
const guideHint = (guide: GuideChannelView): string =>
  [
    guide.now === undefined ? guide.xmltvId : m.guide_picker_now({ title: guide.now }),
    guide.reason === "sameGuide"
      ? m.lineup_guide_same_id()
      : guide.reason === "similarName"
        ? m.lineup_guide_similar()
        : undefined,
    guide.channels > 0 ? m.lineup_guide_used({ count: guide.channels }) : undefined,
  ]
    .filter((part) => part !== undefined)
    .join(" · ");

/** A small uppercase-free heading over a group of choices in the sheet. */
const ListHeading = ({ text, end }: { readonly text: string; readonly end?: string }) => {
  const { colors, em, fonts } = useTheme();
  return (
    <View style={{ flexDirection: "row", paddingTop: 0.6 * em }}>
      <Text
        style={{ flex: 1, fontFamily: fonts.fUiSemiBold, fontSize: 0.85 * em, color: colors.fg3 }}
      >
        {text}
      </Text>
      {end === undefined ? null : (
        <Text style={{ fontFamily: fonts.fUi, fontSize: 0.85 * em, color: colors.fg3 }}>{end}</Text>
      )}
    </View>
  );
};

/**
 * Choosing a channel's guide: No guide, suggestions by name (and guide id), then a search over
 * every guide channel of every source; each says what is on now. A pick saves and closes.
 */
export const GuideSheet = ({
  channel,
  onClose,
}: {
  readonly channel: Channel;
  readonly onClose: () => void;
}) => {
  const { em } = useTheme();
  const lineup = useLineupQueries();
  const { runAction } = useSession();
  const toast = useToast();
  const refreshAfter = useRefreshAfterChange();
  const [text, setText] = useState("");
  const [search, setSearch] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setSearch(text.trim()), SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [text]);
  const suggestions = useQuery(lineup.suggestions(channel.id));
  const all = useQuery({
    ...lineup.guideChannels(search),
    placeholderData: (previous) => previous,
  });
  const suggested = suggestions.data ?? [];
  const shown = new Set(suggested.map((guide) => `${guide.sourceId}:${guide.xmltvId}`));
  const others = (all.data ?? []).filter(
    (guide) => !shown.has(`${guide.sourceId}:${guide.xmltvId}`),
  );

  /** Maps the channel to a guide channel, or (`null`) to none. */
  const pick = (xmltvId: string | null) => {
    void Haptics.selectionAsync();
    onClose();
    if (xmltvId === (channel.guideChannelId ?? null)) return;
    runAction(lineupActions.update(channel.id, { guideChannelId: xmltvId }))
      .then(() => refreshAfter("channels"))
      .catch(() => toast({ text: m.state_not_saved() }));
  };
  const row = (guide: GuideChannelView) => (
    <OptionRow
      key={`${guide.sourceId}:${guide.xmltvId}`}
      title={guide.displayName}
      hint={guideHint(guide)}
      selected={guide.xmltvId === channel.guideChannelId}
      onPress={() => pick(guide.xmltvId)}
    />
  );

  return (
    <Sheet label={m.lineup_guide_choose()} onClose={onClose}>
      <SheetTitle>{m.lineup_guide_choose()}</SheetTitle>
      <TextField
        label={m.lineup_guide_search()}
        value={text}
        onChangeText={setText}
        returnKeyType="search"
        inSheet
      />
      <View style={{ gap: 0.2 * em }}>
        {search === "" ? (
          <OptionRow
            title={m.guide_none_option()}
            hint={m.guide_none_hint()}
            selected={channel.guideChannelId === undefined}
            onPress={() => pick(null)}
          />
        ) : null}
        {search === "" && suggested.length > 0 ? (
          <>
            <ListHeading text={m.lineup_guide_suggested()} />
            {suggested.map(row)}
          </>
        ) : null}
        <ListHeading text={m.lineup_guide_all()} />
        {all.data !== undefined && others.length === 0 ? (
          <OptionRow title={m.lineup_guide_none_found()} />
        ) : (
          others.map(row)
        )}
      </View>
    </Sheet>
  );
};

/** One line of the guide preview: the time, the title and Now or Next at the end. */
const Airing = ({
  at,
  title,
  when,
}: {
  readonly at: number;
  readonly title: string;
  readonly when: string;
}) => {
  const { colors, em, fonts } = useTheme();
  const f = formatters();
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 0.8 * em,
        paddingHorizontal: em,
        paddingVertical: 0.7 * em,
      }}
    >
      <Text
        style={{
          width: 3.2 * em,
          fontFamily: fonts.fUi,
          fontSize: 0.88 * em,
          color: colors.fg2,
          fontVariant: ["tabular-nums"],
        }}
      >
        {f.time(new Date(at))}
      </Text>
      <Text
        numberOfLines={1}
        style={{ flex: 1, fontFamily: fonts.fUiSemiBold, fontSize: 0.92 * em, color: colors.fg }}
      >
        {title}
      </Text>
      <Text style={{ fontFamily: fonts.fUi, fontSize: 0.8 * em, color: colors.fg3 }}>{when}</Text>
    </View>
  );
};

/**
 * A channel's guide on its page: the guide channel it is mapped to with Change, and what is on
 * now and next, so a wrong mapping shows at a glance. A hidden channel has no now and next.
 */
export const GuideSection = ({
  channel,
  onChange,
}: {
  readonly channel: Channel;
  readonly onChange: () => void;
}) => {
  const { colors, em, fonts } = useTheme();
  const lineup = useLineupQueries();
  const nowNext = useQuery({ ...lineup.nowNext(), refetchInterval: 60_000 });
  const slot = nowNext.data?.find((entry) => entry.channelId === channel.id);
  const mapped = channel.guideChannelId;
  return (
    <Panel>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${m.lineup_guide()}: ${mapped ?? m.lineup_no_guide()}. ${m.lineup_guide_change()}`}
        onPress={onChange}
        style={({ pressed }) => ({
          flexDirection: "row",
          alignItems: "center",
          gap: 0.8 * em,
          paddingHorizontal: em,
          paddingVertical: 0.85 * em,
          backgroundColor: pressed ? colors.raised : "transparent",
        })}
      >
        <Text
          numberOfLines={1}
          style={{
            flex: 1,
            fontFamily: fonts.fUiSemiBold,
            fontSize: 0.98 * em,
            color: mapped === undefined ? colors.warnText : colors.fg,
          }}
        >
          {mapped ?? m.lineup_no_guide()}
        </Text>
        <Text
          style={{ fontFamily: fonts.fUiSemiBold, fontSize: 0.92 * em, color: colors.brandText }}
        >
          {m.lineup_guide_change()}
        </Text>
      </Pressable>
      {mapped === undefined ? null : (
        <>
          <Hairline />
          {channel.hidden ? (
            <Text
              style={{ padding: em, fontFamily: fonts.fUi, fontSize: 0.88 * em, color: colors.fg3 }}
            >
              {m.lineup_guide_hidden()}
            </Text>
          ) : slot?.now === undefined && slot?.next === undefined ? (
            <Text
              style={{ padding: em, fontFamily: fonts.fUi, fontSize: 0.88 * em, color: colors.fg3 }}
            >
              {nowNext.data === undefined ? "" : m.lineup_guide_nothing()}
            </Text>
          ) : (
            <>
              {slot.now === undefined ? null : (
                <Airing
                  at={epochMs(slot.now.start)}
                  title={slot.now.title}
                  when={m.lineup_guide_now()}
                />
              )}
              {slot.next === undefined ? null : (
                <Airing
                  at={epochMs(slot.next.start)}
                  title={slot.next.title}
                  when={m.lineup_guide_next()}
                />
              )}
            </>
          )}
        </>
      )}
    </Panel>
  );
};
