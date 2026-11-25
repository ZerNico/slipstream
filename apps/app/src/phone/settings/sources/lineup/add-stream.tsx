import type { ChannelRef } from "@slipstream/api";
import { ChannelId, type SourceView, SourceStreamId } from "@slipstream/domain";
import { m } from "@slipstream/i18n";
import { useQueries, useQuery } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";
import { useEffect, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { useApiQueries } from "../../../../data/hooks.ts";
import { useSession } from "../../../../session/session-context.ts";
import { useTheme } from "../../../../theme/theme.ts";
import { FocusButton } from "../../../../ui/FocusButton.tsx";
import { Segmented } from "../../../../ui/Segmented.tsx";
import { Sheet, SheetTitle } from "../../../../ui/Sheet.tsx";
import { TextField } from "../../../../ui/TextField.tsx";
import { useToast } from "../../../../ui/toast.ts";
import { Hairline, Panel } from "../../../ui/settings.tsx";
import { useRefreshAfterChange } from "../use-sources.ts";
import { lineupActions, useLineupQueries } from "./queries.ts";
import { addKind, type FoundStream } from "@slipstream/domain";

/** Typing settles for this long before the sources are searched. */
const SEARCH_DELAY_MS = 250;

/** One found stream: its name, source and channel, and Add, Move here or "On this channel". */
const FoundRow = ({
  stream,
  channelId,
  busy,
  onAdd,
}: {
  readonly stream: FoundStream;
  readonly channelId: ChannelId;
  readonly busy: boolean;
  readonly onAdd: () => void;
}) => {
  const { colors, em, fonts } = useTheme();
  const kind = addKind(stream, channelId);
  const where = [
    stream.sourceName,
    stream.channel === undefined
      ? stream.group
      : m.stream_in_channel({ name: stream.channel.name }),
  ]
    .filter((part) => part !== undefined)
    .join(" · ");
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 0.6 * em,
        minHeight: 3.6 * em,
        paddingLeft: em,
        paddingRight: 0.6 * em,
        paddingVertical: 0.4 * em,
      }}
    >
      <View style={{ flex: 1, gap: 0.1 * em }}>
        <Text
          numberOfLines={1}
          style={{ fontFamily: fonts.fUiSemiBold, fontSize: 0.95 * em, color: colors.fg }}
        >
          {stream.name}
        </Text>
        <Text
          numberOfLines={1}
          style={{ fontFamily: fonts.fUi, fontSize: 0.8 * em, color: colors.fg3 }}
        >
          {where}
        </Text>
      </View>
      {kind === "here" ? (
        <Text style={{ fontFamily: fonts.fUi, fontSize: 0.8 * em, color: colors.fg3 }}>
          {m.stream_on_this_channel()}
        </Text>
      ) : (
        <FocusButton
          label={kind === "add" ? m.stream_add() : m.stream_move_here()}
          size={0.8}
          variant={kind === "add" ? "default" : "ghost"}
          disabled={busy}
          onPress={onAdd}
        />
      )}
    </View>
  );
};

/**
 * Adds a stream from any source to a channel as its last fallback ("Add stream from another
 * source…", and "Choose stream…" for a channel with none left): a search over every source's
 * streams, narrowed to one source if wanted. A stream on another channel moves here.
 */
export const AddStreamSheet = ({
  channel,
  onClose,
}: {
  readonly channel: ChannelRef;
  readonly onClose: () => void;
}) => {
  const { colors, em, fonts } = useTheme();
  const queries = useApiQueries();
  const lineup = useLineupQueries();
  const { runAction } = useSession();
  const toast = useToast();
  const refreshAfter = useRefreshAfterChange();
  const sources = useQuery(queries.sources());
  const list: readonly SourceView[] = sources.data ?? [];
  const [text, setText] = useState("");
  const [search, setSearch] = useState("");
  const [only, setOnly] = useState<string>("all");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setSearch(text.trim()), SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [text]);
  const searched = list.filter((source) => only === "all" || source.id === only);
  const found = useQueries({
    queries: searched.map((source) => ({
      ...lineup.search(source.id, search),
      enabled: search !== "",
      placeholderData: <A,>(previous: A) => previous,
    })),
    combine: (results) => ({
      loading: results.some((result) => result.data === undefined),
      streams: searched.flatMap((source, index): FoundStream[] =>
        (results[index]?.data?.streams ?? []).map((entry) => ({
          id: entry.id,
          name: entry.name,
          sourceId: source.id,
          sourceName: source.name,
          group: entry.group,
          channel: entry.channel,
        })),
      ),
    }),
  });

  const add = (stream: FoundStream) => {
    if (busy) return;
    setBusy(true);
    const from = stream.channel === undefined ? undefined : ChannelId.make(stream.channel.id);
    runAction(lineupActions.addStream(channel.id, SourceStreamId.make(stream.id), from))
      .then(() => refreshAfter("channels"))
      .then(() => {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        toast({ text: m.stream_added_named({ stream: stream.name, channel: channel.name }) });
        onClose();
      })
      .catch(() => toast({ text: m.state_not_saved() }))
      .finally(() => setBusy(false));
  };

  const note = (words: string) => (
    <Text style={{ padding: em, fontFamily: fonts.fUi, fontSize: 0.9 * em, color: colors.fg3 }}>
      {words}
    </Text>
  );
  return (
    <Sheet label={m.stream_add_title({ name: channel.name })} onClose={onClose}>
      <SheetTitle>{m.stream_add_title({ name: channel.name })}</SheetTitle>
      <TextField
        label={m.stream_add_search()}
        value={text}
        onChangeText={setText}
        autoCapitalize="none"
        returnKeyType="search"
        inSheet
      />
      {list.length > 1 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <Segmented
            label={m.stream_add_sources()}
            selected={only}
            onPick={setOnly}
            segments={[
              { value: "all", label: m.stream_add_all_sources() },
              ...list.map((source) => ({ value: source.id as string, label: source.name })),
            ]}
          />
        </ScrollView>
      ) : null}
      <Panel inset={false}>
        {search === ""
          ? note(m.stream_type_to_search())
          : !found.loading && found.streams.length === 0
            ? note(m.stream_none_match())
            : found.streams.map((stream, index) => (
                <View key={stream.id}>
                  {index === 0 ? null : <Hairline />}
                  <FoundRow
                    stream={stream}
                    channelId={channel.id}
                    busy={busy}
                    onAdd={() => add(stream)}
                  />
                </View>
              ))}
      </Panel>
    </Sheet>
  );
};
