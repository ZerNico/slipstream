import type { SourceGroup, SourceStreamEntry } from "@slipstream/api";
import { groupQualities, SourceId, type StreamQuality, type TickState } from "@slipstream/domain";
import { m } from "@slipstream/i18n";
import { FlashList } from "@shopify/flash-list";
import { useQuery } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, Text, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { readProblem } from "../../../api/failure.ts";
import { useApiQueries } from "../../../data/hooks.ts";
import { useSession } from "../../../session/session-context.ts";
import { useTheme } from "../../../theme/theme.ts";
import { FocusButton } from "../../../ui/FocusButton.tsx";
import { Icon } from "../../../ui/Icon.tsx";
import { Segmented } from "../../../ui/Segmented.tsx";
import { Bone, Skeleton } from "../../../ui/Skeleton.tsx";
import { TextField } from "../../../ui/TextField.tsx";
import { useToast } from "../../../ui/toast.ts";
import { BackHeader } from "../../BackHeader.tsx";
import { AdminOnly, PageStatus } from "../../ui/PageStatus.tsx";
import { sourceActions } from "./api.ts";
import { type PhonePickerState, type PickerShow, useStreamPicker } from "./use-stream-picker.ts";
import { useRefreshAfterChange } from "./use-sources.ts";

/** A quality as its tag writes it. */
const qualityText = (quality: StreamQuality): string | undefined => {
  switch (quality) {
    case "uhd":
      return m.picker_quality_uhd();
    case "fhd":
      return m.picker_quality_fhd();
    case "hd":
      return m.picker_quality_hd();
    case "sd":
      return m.picker_quality_sd();
    case "unknown":
      return undefined;
  }
};

/** A tick box with a third state (some of a group ticked). */
const TickBox = ({ state }: { readonly state: TickState }) => {
  const { colors, em, radii } = useTheme();
  const on = state !== "off";
  return (
    <View
      style={{
        width: 1.35 * em,
        height: 1.35 * em,
        borderRadius: radii.rS,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: on ? colors.brand : "transparent",
        borderWidth: on ? 0 : 1.5,
        borderColor: colors.fg3,
      }}
    >
      {state === "on" ? <Icon name="check" size={1.05 * em} color={colors.onBrand} /> : null}
      {state === "some" ? (
        <View
          style={{ width: 0.7 * em, height: 2, borderRadius: 1, backgroundColor: colors.onBrand }}
        />
      ) : null}
    </View>
  );
};

const groupHints = (group: SourceGroup, streams: readonly SourceStreamEntry[]) => {
  const qualities = groupQualities(streams)
    .map(qualityText)
    .filter((text) => text !== undefined);
  const joining = streams.filter(
    (stream) => stream.channel === undefined && stream.match?.reason === "sameGuide",
  ).length;
  return [
    m.picker_group_guide({ percent: group.guideCoverage }),
    qualities.length === 0 ? undefined : qualities.join(" + "),
    joining === 0 ? undefined : m.picker_group_joins({ count: joining }),
  ]
    .filter((part) => part !== undefined)
    .join(" · ");
};

/** A group's head: open or close by its chevron and name, tick the whole group by its box. */
const GroupRow = ({
  picker,
  group,
  open,
  narrowed,
}: {
  readonly picker: PhonePickerState;
  readonly group: SourceGroup;
  readonly open: boolean;
  readonly narrowed: boolean;
}) => {
  const { colors, em, fonts } = useTheme();
  const name = group.name ?? m.picker_group_none();
  const pickable = group.streams - group.added;
  const tick = picker.groupTick(group);
  const canOpen = !picker.streamsLoading && !narrowed;
  return (
    <View
      style={{
        height: 3.6 * em,
        flexDirection: "row",
        alignItems: "center",
        backgroundColor: colors.bg,
        borderBottomWidth: 1,
        borderBottomColor: colors.line,
      }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={open ? m.picker_group_close({ name }) : m.picker_group_open({ name })}
        accessibilityState={{ expanded: open, disabled: !canOpen }}
        disabled={!canOpen}
        onPress={() => picker.toggleOpen(group)}
        style={{ flexDirection: "row", alignItems: "center", flex: 1, height: "100%" }}
      >
        <View
          style={{
            width: 2.6 * em,
            alignItems: "center",
            transform: [{ rotate: open ? "270deg" : "180deg" }],
          }}
        >
          <Icon name="chevronLeft" size={1.1 * em} color={colors.fg3} />
        </View>
        <Pressable
          accessibilityRole="checkbox"
          accessibilityLabel={name}
          accessibilityState={{
            checked: tick === "some" ? "mixed" : tick === "on",
            disabled: picker.streamsLoading || pickable === 0,
          }}
          disabled={picker.streamsLoading || pickable === 0}
          hitSlop={0.6 * em}
          onPress={() => {
            void Haptics.selectionAsync();
            picker.pickGroup(group, tick !== "on");
          }}
          style={{ paddingRight: 0.8 * em }}
        >
          <TickBox state={tick} />
        </Pressable>
        <View style={{ flex: 1, gap: 0.1 * em }}>
          <Text
            numberOfLines={1}
            style={{ fontFamily: fonts.fUiSemiBold, fontSize: 0.95 * em, color: colors.fg }}
          >
            {name}
          </Text>
          <Text
            numberOfLines={1}
            style={{ fontFamily: fonts.fUi, fontSize: 0.78 * em, color: colors.fg3 }}
          >
            {picker.streamsLoading ? " " : groupHints(group, picker.streamsOf(group))}
          </Text>
        </View>
      </Pressable>
      <Text
        style={{
          paddingHorizontal: em,
          fontFamily: fonts.fUi,
          fontSize: 0.85 * em,
          color: colors.fg2,
          fontVariant: ["tabular-nums"],
        }}
      >
        {tick === "some"
          ? m.picker_group_picked({ picked: picker.groupPicked(group), total: pickable })
          : String(pickable)}
      </Text>
    </View>
  );
};

/** One stream: its box, name, a quiet hint (joins a channel, no guide, added) and its quality. */
const StreamRow = ({
  picker,
  stream,
}: {
  readonly picker: PhonePickerState;
  readonly stream: SourceStreamEntry;
}) => {
  const { colors, em, fonts, radii } = useTheme();
  const added = stream.channel !== undefined;
  const on = added || picker.picked.has(stream.id);
  const quality = qualityText(stream.quality);
  const hint = added
    ? m.picker_added()
    : stream.match?.reason === "sameGuide"
      ? m.picker_joins({ name: stream.match.name })
      : stream.hasGuide
        ? undefined
        : m.picker_no_guide();
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityLabel={hint === undefined ? stream.name : `${stream.name}, ${hint}`}
      accessibilityState={{ checked: on, disabled: added }}
      disabled={added}
      onPress={() => {
        void Haptics.selectionAsync();
        picker.pickStream(stream, !on);
      }}
      style={({ pressed }) => ({
        height: 2.8 * em,
        flexDirection: "row",
        alignItems: "center",
        gap: 0.7 * em,
        paddingLeft: 2.6 * em,
        paddingRight: em,
        backgroundColor: pressed ? colors.raised : "transparent",
        opacity: added ? 0.6 : 1,
      })}
    >
      <TickBox state={on ? "on" : "off"} />
      <Text
        numberOfLines={1}
        style={{ flex: 1, fontFamily: fonts.fUi, fontSize: 0.92 * em, color: colors.fg }}
      >
        {stream.name}
      </Text>
      {hint === undefined ? null : (
        <Text
          numberOfLines={1}
          style={{ maxWidth: "40%", fontFamily: fonts.fUi, fontSize: 0.75 * em, color: colors.fg3 }}
        >
          {hint}
        </Text>
      )}
      <View style={{ width: 2.4 * em, alignItems: "flex-end" }}>
        {quality === undefined ? null : (
          <Text
            style={{
              paddingHorizontal: 0.35 * em,
              borderRadius: radii.rS,
              borderWidth: 1,
              borderColor: colors.line,
              fontFamily: fonts.fUiSemiBold,
              fontSize: 0.65 * em,
              color: colors.fg2,
            }}
          >
            {quality}
          </Text>
        )}
      </View>
    </Pressable>
  );
};

/** While the groups load: rows of the same height, so nothing moves when they arrive. */
const PickerSkeleton = () => {
  const { em } = useTheme();
  return (
    <Skeleton>
      {Array.from({ length: 10 }, (_, index) => (
        <View
          key={index}
          style={{
            height: 3.6 * em,
            flexDirection: "row",
            alignItems: "center",
            gap: 0.8 * em,
            paddingLeft: 2.6 * em,
            paddingRight: em,
          }}
        >
          <Bone width={1.35 * em} height={1.35 * em} />
          <View style={{ flex: 1, gap: 0.3 * em }}>
            <Bone width="55%" height={0.9 * em} />
            <Bone width="35%" height={0.7 * em} />
          </View>
        </View>
      ))}
    </Skeleton>
  );
};

/**
 * The stream picker as a full-screen page (phones, admin): search, All or Selected, Select all
 * and none, the groups as collapsible lists (the open group's head stays at the top), and a
 * bottom bar with the count and Add. Copies in HD and SD become one channel; streams with an
 * existing channel's guide id join it.
 */
const PhoneStreamPickerPage = ({
  sourceId,
  show,
}: {
  readonly sourceId: SourceId;
  readonly show: PickerShow;
}) => {
  const { colors, em, fonts } = useTheme();
  const insets = useSafeAreaInsets();
  // A phone on its side: the subtitle goes, search and filters share a row and the bottom bar is
  // one line, so the list keeps most of the short screen.
  const short = useWindowDimensions().height < 520;
  const router = useRouter();
  const { runAction } = useSession();
  const toast = useToast();
  const refreshAfter = useRefreshAfterChange();
  const queries = useApiQueries();
  const sources = useQuery(queries.sources());
  const source = sources.data?.find((candidate) => candidate.id === sourceId);
  const picker = useStreamPicker(sourceId, show);
  const [busy, setBusy] = useState(false);
  const narrowed = picker.search.trim() !== "" || picker.show !== "all";

  if (picker.error !== null) {
    return (
      <PageStatus
        heading={m.picker_title()}
        title={readProblem(picker.error)}
        onRetry={picker.retry}
      />
    );
  }
  const streams = picker.groups.reduce((sum, group) => sum + group.streams, 0);
  const add = () => {
    if (busy) return;
    setBusy(true);
    const ids = picker.pickedIds();
    runAction(sourceActions.addStreams(sourceId, ids))
      .then(async (added) => {
        await refreshAfter("sources");
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        toast({
          text: m.picker_done({ created: added.created.length, joined: added.joined.length }),
        });
        router.back();
      })
      .catch(() => {
        toast({ text: m.state_not_saved() });
        setBusy(false);
      });
  };
  const addText =
    picker.plan.channels === 0 && picker.plan.joining > 0
      ? m.picker_add_to_existing()
      : m.picker_add({ count: picker.streamsLoading ? picker.selected : picker.plan.channels });

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <BackHeader title={m.picker_title()} />
      {short ? null : (
        <Text
          numberOfLines={1}
          style={{
            marginTop: -0.4 * em,
            paddingHorizontal: em,
            paddingBottom: 0.5 * em,
            textAlign: "center",
            fontFamily: fonts.fUi,
            fontSize: 0.8 * em,
            color: colors.fg3,
          }}
        >
          {picker.loading || source === undefined
            ? " "
            : m.picker_subtitle({ source: source.name, streams, groups: picker.groups.length })}
        </Text>
      )}
      <View
        style={
          short
            ? {
                flexDirection: "row",
                alignItems: "center",
                paddingLeft: em,
                paddingBottom: 0.5 * em,
              }
            : undefined
        }
      >
        <View style={short ? { flex: 1 } : { paddingHorizontal: em, paddingBottom: 0.5 * em }}>
          <TextField
            label={m.picker_search({ count: picker.total })}
            value={picker.search}
            onChangeText={picker.setSearch}
            editable={!picker.streamsLoading}
            autoCapitalize="none"
            returnKeyType="search"
          />
        </View>
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            paddingRight: 0.5 * em,
            paddingBottom: short ? 0 : 0.5 * em,
            ...(short ? { paddingLeft: 0.5 * em } : {}),
          }}
        >
          <View style={short ? { width: 23 * em } : { flex: 1, alignItems: "flex-start" }}>
            <Segmented
              label={m.picker_show()}
              selected={picker.show}
              onPick={picker.setShow}
              segments={[
                { value: "all", label: m.picker_show_all() },
                { value: "picked", label: m.picker_show_selected() },
                { value: "new", label: m.picker_show_new() },
              ]}
            />
          </View>
          <FocusButton
            label={m.picker_select_all()}
            variant="ghost"
            size={0.8}
            disabled={picker.streamsLoading}
            onPress={() => picker.pickShown(true)}
          />
          <FocusButton
            label={m.picker_select_none()}
            variant="ghost"
            size={0.8}
            disabled={picker.streamsLoading}
            onPress={() => picker.pickShown(false)}
          />
        </View>
      </View>
      <View style={{ flex: 1, borderTopWidth: 1, borderTopColor: colors.line }}>
        {picker.loading ? (
          <PickerSkeleton />
        ) : (
          <FlashList
            data={picker.rows}
            keyExtractor={(row) => row.key}
            getItemType={(row) => row.kind}
            stickyHeaderIndices={picker.rows.flatMap((row, index) =>
              row.kind === "group" && row.open ? [index] : [],
            )}
            keyboardShouldPersistTaps="handled"
            ListEmptyComponent={
              <Text
                style={{
                  padding: em,
                  fontFamily: fonts.fUi,
                  fontSize: 0.95 * em,
                  color: colors.fg2,
                }}
              >
                {picker.onlyPicked && picker.search.trim() === ""
                  ? m.picker_none_selected()
                  : m.picker_none_match()}
              </Text>
            }
            renderItem={({ item }) =>
              item.kind === "group" ? (
                <GroupRow picker={picker} group={item.group} open={item.open} narrowed={narrowed} />
              ) : (
                <StreamRow picker={picker} stream={item.stream} />
              )
            }
          />
        )}
      </View>
      <View
        style={{
          gap: 0.6 * em,
          paddingHorizontal: em,
          paddingTop: 0.7 * em,
          ...(short ? { flexDirection: "row", alignItems: "center" } : {}),
          paddingBottom: short ? 0.5 * em : insets.bottom + 0.7 * em,
          ...(short ? { paddingTop: 0.5 * em } : {}),
          borderTopWidth: 1,
          borderTopColor: colors.line,
          backgroundColor: colors.surface,
        }}
      >
        <View
          style={{
            flexDirection: "row",
            justifyContent: "space-between",
            gap: em,
            ...(short ? { flex: 1 } : {}),
          }}
        >
          <Text style={{ fontFamily: fonts.fUiSemiBold, fontSize: 0.85 * em, color: colors.fg }}>
            {picker.loading
              ? " "
              : m.picker_selected_of({ selected: picker.selected, total: picker.total })}
          </Text>
          <Text
            numberOfLines={1}
            style={{ flexShrink: 1, fontFamily: fonts.fUi, fontSize: 0.8 * em, color: colors.fg3 }}
          >
            {picker.plan.joining === 0
              ? ""
              : m.picker_join_existing({ count: picker.plan.joining })}
          </Text>
        </View>
        <FocusButton
          label={addText}
          variant="primary"
          disabled={busy || picker.streamsLoading || picker.selected === 0}
          onPress={add}
        />
      </View>
    </View>
  );
};

/** The picker page behind the admin gate. */
export const PhoneStreamPicker = ({
  id,
  show = "all",
}: {
  readonly id: string;
  readonly show?: PickerShow;
}) => (
  <AdminOnly heading={m.picker_title()}>
    <PhoneStreamPickerPage sourceId={SourceId.make(id)} show={show} />
  </AdminOnly>
);
