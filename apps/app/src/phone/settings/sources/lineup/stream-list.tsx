import type { Channel, StreamQuality } from "@slipstream/domain";
import { m } from "@slipstream/i18n";
import { useQuery } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useSession } from "../../../../session/session-context.ts";
import { useTheme } from "../../../../theme/theme.ts";
import { Icon } from "../../../../ui/Icon.tsx";
import { OptionRow } from "../../../../ui/OptionRow.tsx";
import { Sheet, SheetTitle } from "../../../../ui/Sheet.tsx";
import { useToast } from "../../../../ui/toast.ts";
import { ActionRow, Hairline, Panel } from "../../../ui/settings.tsx";
import { useRefreshAfterChange } from "../use-sources.ts";
import { AddStreamSheet } from "./add-stream.tsx";
import { lineupActions, useLineupQueries } from "./queries.ts";
import { type LineupStream, moveBy, orderedStreams } from "./streams.ts";

/** A quality as its tag says it; nothing when the name gave none. */
const qualityText = (quality: StreamQuality): string | undefined => {
  switch (quality) {
    case "uhd":
      return m.lineup_quality_uhd();
    case "fhd":
      return m.lineup_quality_fhd();
    case "hd":
      return m.lineup_quality_hd();
    case "sd":
      return m.lineup_quality_sd();
    case "unknown":
      return undefined;
  }
};

/** A round button with a chevron pointing up or down (the left chevron, turned). */
const MoveButton = ({
  direction,
  label,
  disabled,
  onPress,
}: {
  readonly direction: "up" | "down";
  readonly label: string;
  readonly disabled: boolean;
  readonly onPress: () => void;
}) => {
  const { colors, em } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      hitSlop={0.2 * em}
      onPress={onPress}
      style={({ pressed }) => ({
        width: 2.4 * em,
        height: 2.4 * em,
        borderRadius: 1.2 * em,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: pressed ? colors.raised : "transparent",
        opacity: disabled ? 0.3 : 1,
      })}
    >
      <View style={{ transform: [{ rotate: direction === "up" ? "90deg" : "-90deg" }] }}>
        <Icon name="chevronLeft" size={1.2 * em} color={colors.fg} />
      </View>
    </Pressable>
  );
};

/** One stream: its place, source and stream name, quality, Up and Down, and its actions. */
const StreamRow = ({
  stream,
  index,
  count,
  onMove,
  onMore,
}: {
  readonly stream: LineupStream;
  readonly index: number;
  readonly count: number;
  readonly onMove: (direction: -1 | 1) => void;
  readonly onMore: () => void;
}) => {
  const { colors, em, fonts } = useTheme();
  const quality = qualityText(stream.quality);
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 0.5 * em,
        paddingLeft: em,
        paddingRight: 0.4 * em,
        paddingVertical: 0.5 * em,
      }}
    >
      <Text
        style={{ width: 1.2 * em, fontFamily: fonts.fUi, fontSize: 0.88 * em, color: colors.fg3 }}
      >
        {String(index + 1)}
      </Text>
      <View style={{ flex: 1, gap: 0.1 * em }}>
        <Text
          numberOfLines={1}
          style={{ fontFamily: fonts.fUiSemiBold, fontSize: 0.95 * em, color: colors.fg }}
        >
          {stream.sourceName}
        </Text>
        <Text
          numberOfLines={1}
          style={{ fontFamily: fonts.fUi, fontSize: 0.8 * em, color: colors.fg3 }}
        >
          {[stream.name, quality].filter((part) => part !== undefined).join(" · ")}
        </Text>
        {stream.gone ? (
          <Text style={{ fontFamily: fonts.fUi, fontSize: 0.8 * em, color: colors.warnText }}>
            {m.lineup_stream_gone()}
          </Text>
        ) : null}
      </View>
      <MoveButton
        direction="up"
        label={m.channel_move_up({ name: stream.name })}
        disabled={index === 0}
        onPress={() => onMove(-1)}
      />
      <MoveButton
        direction="down"
        label={m.channel_move_down({ name: stream.name })}
        disabled={index === count - 1}
        onPress={() => onMove(1)}
      />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={m.lineup_stream_menu({ name: stream.name })}
        hitSlop={0.2 * em}
        onPress={onMore}
        style={({ pressed }) => ({
          width: 2.4 * em,
          height: 2.4 * em,
          borderRadius: 1.2 * em,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: pressed ? colors.raised : "transparent",
        })}
      >
        <Icon name="more" size={1.2 * em} color={colors.fg2} />
      </Pressable>
    </View>
  );
};

/**
 * A channel's streams in fallback order ("Tried in this order"): Up and Down change the order,
 * and each stream's actions make it a channel of its own (not the only one) or take it out
 * (back to its source's pool). "Add stream from another source…" appends one as last fallback.
 */
export const StreamList = ({
  channel,
  known,
}: {
  readonly channel: Channel;
  /** What the sources' catalogues know of the channel's streams. */
  readonly known: ReadonlyArray<LineupStream> | undefined;
}) => {
  const { colors, em, fonts } = useTheme();
  const lineup = useLineupQueries();
  const { runAction } = useSession();
  const toast = useToast();
  const refreshAfter = useRefreshAfterChange();
  const links = useQuery(lineup.streams(channel.id));
  // The order being saved, shown until the refetched links replace it.
  const [ahead, setAhead] = useState<readonly LineupStream[] | undefined>(undefined);
  const [menu, setMenu] = useState<LineupStream | undefined>(undefined);
  const [adding, setAdding] = useState(false);
  const streams = ahead ?? orderedStreams(links.data ?? [], known);

  const save = (order: readonly LineupStream[]) => {
    setAhead(order);
    runAction(
      lineupActions.setStreams(
        channel.id,
        order.map((stream) => stream.id),
      ),
    )
      .then(() => refreshAfter("channels"))
      .catch(() => toast({ text: m.state_not_saved() }))
      .finally(() => setAhead(undefined));
  };
  const split = (stream: LineupStream) => {
    runAction(lineupActions.split(channel.id, stream.id))
      .then(() => refreshAfter("channels"))
      .then(() => {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        toast({ text: m.lineup_split_done({ name: stream.name }) });
      })
      .catch(() => toast({ text: m.state_not_saved() }));
  };

  return (
    <>
      <Panel>
        {links.data !== undefined && known !== undefined && streams.length === 0 ? (
          <Text
            style={{ padding: em, fontFamily: fonts.fUi, fontSize: 0.9 * em, color: colors.fg3 }}
          >
            {m.lineup_streams_empty()}
          </Text>
        ) : (
          streams.map((stream, index) => (
            <View key={stream.id}>
              {index === 0 ? null : <Hairline />}
              <StreamRow
                stream={stream}
                index={index}
                count={streams.length}
                onMove={(direction) => {
                  void Haptics.selectionAsync();
                  save(moveBy(streams, index, direction));
                }}
                onMore={() => setMenu(stream)}
              />
            </View>
          ))
        )}
      </Panel>
      <View style={{ marginTop: 0.6 * em }}>
        <Panel>
          <ActionRow
            icon="plus"
            tone="action"
            title={m.stream_add_from_source()}
            onPress={() => setAdding(true)}
          />
        </Panel>
      </View>
      {adding ? (
        <AddStreamSheet
          channel={{ id: channel.id, name: channel.name }}
          onClose={() => setAdding(false)}
        />
      ) : null}
      {menu === undefined ? null : (
        <Sheet label={m.lineup_stream_menu({ name: menu.name })} onClose={() => setMenu(undefined)}>
          <SheetTitle>{menu.name}</SheetTitle>
          {/* A channel's only stream stays: there would be nothing left to split from. */}
          {streams.length > 1 ? (
            <OptionRow
              title={m.lineup_split()}
              onPress={() => {
                setMenu(undefined);
                split(menu);
              }}
            />
          ) : null}
          <OptionRow
            title={m.lineup_stream_remove()}
            onPress={() => {
              setMenu(undefined);
              save(streams.filter((stream) => stream.id !== menu.id));
            }}
          />
        </Sheet>
      )}
    </>
  );
};
