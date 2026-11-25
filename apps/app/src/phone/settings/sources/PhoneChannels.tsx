import {
  type Channel,
  type ChannelId,
  lineupCounts,
  matchesLineup,
  topNumber,
} from "@slipstream/domain";
import { m } from "@slipstream/i18n";
import { useQuery } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { BackHandler, FlatList, Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useApiQueries } from "../../../data/hooks.ts";
import { readProblem } from "../../../api/failure.ts";
import { Hairline } from "../../ui/settings.tsx";
import { AdminOnly, PageStatus } from "../../ui/PageStatus.tsx";
import { useSession } from "../../../session/session-context.ts";
import { useTheme } from "../../../theme/theme.ts";
import { TextField } from "../../../ui/TextField.tsx";
import { useToast } from "../../../ui/toast.ts";
import { BackHeader } from "../../BackHeader.tsx";
import { ChannelRow } from "./ChannelRow.tsx";
import { ChannelsSkeleton } from "./SourcesSkeletons.tsx";
import { useRefreshAfterChange } from "./use-sources.ts";
import { channelHref } from "../../../routes.ts";
import { type BulkAction, FilterChips, type PhoneFilter, SelectBar } from "./lineup/bars.tsx";
import { lineupActions, useChannelStreams } from "./lineup/queries.ts";
import { NumberSheet, RemoveSheet } from "./lineup/sheets.tsx";
import { groupOf, originOf } from "./lineup/streams.ts";

/** A text button in the select-mode header (Cancel, All). */
const HeaderButton = ({
  label,
  onPress,
}: {
  readonly label: string;
  readonly onPress: () => void;
}) => {
  const { colors, em, fonts } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={0.5 * em}
      onPress={onPress}
      style={{ height: 2.6 * em, justifyContent: "center", paddingHorizontal: 0.5 * em }}
    >
      <Text style={{ fontFamily: fonts.fUiSemiBold, fontSize: 1 * em, color: colors.fg }}>
        {label}
      </Text>
    </Pressable>
  );
};

/** The head in select mode: Cancel, how many are chosen, All; as tall as the page's own head. */
const SelectHeader = ({
  count,
  onCancel,
  onAll,
}: {
  readonly count: number;
  readonly onCancel: () => void;
  readonly onAll: () => void;
}) => {
  const { colors, em, fonts } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View
      style={{
        paddingTop: insets.top + 0.4 * em,
        paddingBottom: 0.4 * em,
        paddingHorizontal: 0.5 * em,
        flexDirection: "row",
        alignItems: "center",
        backgroundColor: colors.bg,
      }}
    >
      <HeaderButton label={m.action_cancel()} onPress={onCancel} />
      <Text
        accessibilityRole="header"
        accessibilityLiveRegion="polite"
        style={{
          flex: 1,
          textAlign: "center",
          fontFamily: fonts.fUiSemiBold,
          fontSize: 1.05 * em,
          color: colors.fg,
        }}
      >
        {m.lineup_selected({ count })}
      </Text>
      <HeaderButton label={m.lineup_select_all()} onPress={onAll} />
    </View>
  );
};

/** Which sheet is open over the list. */
type Open = { readonly kind: "number" | "remove"; readonly ids: readonly ChannelId[] } | undefined;

/**
 * The channel lineup on a phone (admin): search and chips (Visible, Hidden, No guide,
 * Favourites with their counts), then every channel by number with its group and streams. A tap
 * opens the channel; a long press starts select mode with Cancel and All above and Hide, Move
 * to…, To top, Favourite and Remove below. Numbers are fixed: a typed number moves its holder to
 * the next free one.
 */
const PhoneChannelsPage = () => {
  const { colors, em, fonts } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { runAction } = useSession();
  const toast = useToast();
  const queries = useApiQueries();
  const refreshAfter = useRefreshAfterChange();
  const channels = useQuery(queries.allChannels());
  const streams = useChannelStreams();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<PhoneFilter>({
    view: "all",
    noGuide: false,
    favourites: false,
  });
  // Select mode is on while this is set, even with nothing chosen.
  const [selected, setSelected] = useState<ReadonlySet<ChannelId> | undefined>(undefined);
  const [open, setOpen] = useState<Open>(undefined);
  const selecting = selected !== undefined;

  // Back leaves select mode before it leaves the page.
  useEffect(() => {
    if (!selecting) return undefined;
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      setSelected(undefined);
      return true;
    });
    return () => subscription.remove();
  }, [selecting]);

  if (channels.isError) {
    return (
      <PageStatus
        heading={m.channels_heading()}
        title={readProblem(channels.error)}
        onRetry={() => void channels.refetch()}
      />
    );
  }
  const all = channels.data ?? [];
  const counts = lineupCounts(all);
  const list = all.filter((channel) =>
    matchesLineup(channel, { ...filter, search }, originOf(streams?.get(channel.id))),
  );
  const chosen = all.filter((channel) => selected?.has(channel.id) === true);
  const chosenIds = chosen.map((channel) => channel.id);

  const lineFor = (channel: Channel): string => {
    if (streams === undefined) return "";
    const own = streams.get(channel.id);
    const group = groupOf(own);
    const count = m.lineup_streams_count({ count: own?.length ?? 0 });
    return group === undefined ? count : `${group} · ${count}`;
  };
  const toggle = (id: ChannelId) => {
    void Haptics.selectionAsync();
    setSelected((before) => {
      const next = new Set(before);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const run = (write: Parameters<typeof runAction>[0]) => {
    runAction(write)
      .then(() => refreshAfter("channels"))
      .then(() => {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        setSelected(undefined);
      })
      .catch(() => toast({ text: m.state_not_saved() }));
  };
  const bulk = (action: BulkAction) => {
    if (chosenIds.length === 0) return;
    switch (action) {
      case "hide":
        run(
          lineupActions.updateMany(chosenIds, {
            hidden: !chosen.every((channel) => channel.hidden),
          }),
        );
        return;
      case "favourite":
        run(
          lineupActions.updateMany(chosenIds, {
            favourite: !chosen.every((channel) => channel.favourite),
          }),
        );
        return;
      case "top":
        run(lineupActions.placeNumbers(chosenIds, topNumber(all)));
        return;
      case "number":
        setOpen({ kind: "number", ids: chosenIds });
        return;
      case "remove":
        setOpen({ kind: "remove", ids: chosenIds });
        return;
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      {selecting ? (
        <SelectHeader
          count={chosen.length}
          onCancel={() => setSelected(undefined)}
          onAll={() => setSelected(new Set(list.map((channel) => channel.id)))}
        />
      ) : (
        <BackHeader
          title={m.channels_heading()}
          action={
            <Text style={{ fontFamily: fonts.fUi, fontSize: 0.9 * em, color: colors.fg3 }}>
              {channels.data === undefined ? "" : m.channels_count({ count: all.length })}
            </Text>
          }
        />
      )}
      <View style={{ paddingHorizontal: em, paddingBottom: 0.6 * em }}>
        <TextField
          label={m.lineup_search()}
          value={search}
          onChangeText={setSearch}
          returnKeyType="search"
        />
      </View>
      <FilterChips filter={filter} counts={counts} onChange={setFilter} />
      {channels.data === undefined ? (
        <ChannelsSkeleton />
      ) : (
        <FlatList
          data={list}
          keyExtractor={(channel) => channel.id}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingBottom: (selecting ? 0 : insets.bottom) + 1.5 * em }}
          ItemSeparatorComponent={Hairline}
          ListEmptyComponent={
            <Text
              style={{
                padding: em,
                fontFamily: fonts.fUi,
                fontSize: 0.95 * em,
                color: colors.fg2,
              }}
            >
              {all.length === 0 ? m.channels_empty() : m.channels_none_match()}
            </Text>
          }
          renderItem={({ item }) => (
            <ChannelRow
              channel={item}
              line={lineFor(item)}
              selecting={selecting}
              selected={selected?.has(item.id) === true}
              onPress={() => (selecting ? toggle(item.id) : router.push(channelHref(item.id)))}
              onLongPress={() => {
                void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                setSelected((before) => new Set(before).add(item.id));
              }}
            />
          )}
        />
      )}
      {selecting ? (
        <SelectBar
          count={chosen.length}
          allHidden={chosen.length > 0 && chosen.every((channel) => channel.hidden)}
          allFavourite={chosen.length > 0 && chosen.every((channel) => channel.favourite)}
          onAction={bulk}
        />
      ) : null}
      {open?.kind === "number" ? (
        <NumberSheet
          lineup={all}
          ids={open.ids}
          onDone={() => setSelected(undefined)}
          onClose={() => setOpen(undefined)}
        />
      ) : null}
      {open?.kind === "remove" ? (
        <RemoveSheet
          channels={all.filter((channel) => open.ids.includes(channel.id))}
          onDone={() => setSelected(undefined)}
          onClose={() => setOpen(undefined)}
        />
      ) : null}
    </View>
  );
};

/** PhoneChannels behind the admin gate. */
export const PhoneChannels = () => (
  <AdminOnly heading={m.channels_heading()}>
    <PhoneChannelsPage />
  </AdminOnly>
);
