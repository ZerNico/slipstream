import type { Channel, Programme } from "@slipstream/domain";
import { m, pathLabels } from "@slipstream/i18n";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import { type ReactNode, useCallback, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { libraryCard } from "../data/library.ts";
import { BackHeader } from "../phone/BackHeader.tsx";
import { EntryRow } from "../phone/library/EntryRow.tsx";
import { ListSkeleton } from "../phone/PhoneSkeletons.tsx";
import { Thumb } from "../phone/Thumb.tsx";
import { useTheme } from "../theme/theme.ts";
import { RecordSheet } from "../record/RecordSheet.tsx";
import { ChannelArt } from "../ui/ChannelArt.tsx";
import { Chip } from "../ui/Chip.tsx";
import { FocusButton } from "../ui/FocusButton.tsx";
import { Icon } from "../ui/Icon.tsx";
import { programmeMeta, recordingText } from "./result-text.ts";
import { SearchField } from "./SearchField.tsx";
import { channelTarget, useRecentSearches, useSearch } from "./use-search.ts";
import { recordingHref } from "../routes.ts";

/** A group's heading and its rows. */
const Group = ({ title, children }: { readonly title: string; readonly children: ReactNode }) => {
  const { colors, em, fonts } = useTheme();
  return (
    <View>
      <Text
        accessibilityRole="header"
        numberOfLines={1}
        style={{
          fontFamily: fonts.fUiSemiBold,
          fontSize: 0.85 * em,
          color: colors.fg3,
          paddingHorizontal: em,
          paddingTop: 0.8 * em,
          paddingBottom: 0.3 * em,
        }}
      >
        {title}
      </Text>
      {children}
    </View>
  );
};

/** One result row: a 16:9 picture (or the channel's logo), a title and a quiet line. */
const ResultRow = ({
  picture,
  title,
  meta,
  chip,
  onPress,
}: {
  readonly picture: ReactNode;
  readonly title: string;
  readonly meta: string;
  readonly chip?: ReactNode;
  readonly onPress: () => void;
}) => {
  const { colors, em, fonts } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${title}, ${meta}`}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: 0.8 * em,
        paddingHorizontal: em,
        paddingVertical: 0.5 * em,
        backgroundColor: pressed ? colors.surface : "transparent",
      })}
    >
      {picture}
      <View style={{ flex: 1, gap: 0.25 * em }}>
        <Text
          numberOfLines={2}
          style={{ fontFamily: fonts.fUiSemiBold, fontSize: 0.95 * em, color: colors.fg }}
        >
          {title}
        </Text>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 0.5 * em }}>
          {chip}
          <Text
            numberOfLines={1}
            style={{ flex: 1, fontFamily: fonts.fUi, fontSize: 0.82 * em, color: colors.fg3 }}
          >
            {meta}
          </Text>
        </View>
      </View>
    </Pressable>
  );
};

/** A channel's logo in the rows' 16:9 box. */
const ChannelBox = ({ channel }: { readonly channel: Channel }) => {
  const { colors, em, radii } = useTheme();
  return (
    <View
      style={{
        width: 8 * em,
        aspectRatio: 16 / 9,
        borderRadius: radii.rM,
        overflow: "hidden",
        backgroundColor: colors.raised,
      }}
    >
      <ChannelArt channelId={channel.id} height={1.6 * em} />
    </View>
  );
};

/**
 * Phone search: Back and the field (focused, the keyboard up) at the top, recent searches while
 * it is empty, then results as you type in groups: channels (a tap watches live), programmes
 * on now and coming up (a tap opens the record sheet, which also watches), and recordings (a
 * tap opens the recording's page). The previous answer stays while the next loads.
 */
export const PhoneSearch = () => {
  const { colors, em, fonts } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState("");
  const results = useSearch(query);
  const { recent, remember } = useRecentSearches();
  const [recordFor, setRecordFor] = useState<Programme | undefined>(undefined);
  const closeRecord = useCallback(() => setRecordFor(undefined), []);
  const { names, entries, now } = results;
  const channelName = (id: string) => names.get(id) ?? "";
  const labels = pathLabels();

  const openProgramme = (programme: Programme) => {
    void Haptics.selectionAsync();
    remember(query);
    setRecordFor(programme);
  };
  const programmeGroup = (title: string, programmes: readonly Programme[], live: boolean) =>
    programmes.length === 0 ? null : (
      <Group title={title}>
        {programmes.map((programme) => (
          <ResultRow
            key={programme.id}
            picture={<Thumb subject={programme} width={8 * em} />}
            title={programme.title}
            meta={programmeMeta(programme, channelName(programme.channelId), now)}
            chip={live ? <Chip label={m.status_live()} tone="live" size={0.72} /> : undefined}
            onPress={() => openProgramme(programme)}
          />
        ))}
      </Group>
    );
  const quiet = {
    fontFamily: fonts.fUi,
    fontSize: 0.95 * em,
    color: colors.fg2,
    paddingHorizontal: em,
    paddingTop: em,
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <BackHeader
        action={
          <View style={{ flex: 1 }}>
            <SearchField
              value={query}
              onChangeText={setQuery}
              onSubmit={() => remember(query)}
              autoFocus
            />
          </View>
        }
      />
      <ScrollView
        style={{ flex: 1 }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        contentContainerStyle={{ paddingBottom: insets.bottom + 1.5 * em }}
      >
        {results.searched === "" ? (
          recent.length === 0 ? (
            <Text style={quiet}>{m.search_start()}</Text>
          ) : (
            <Group title={m.search_recent()}>
              {recent.map((entry) => (
                <Pressable
                  key={entry}
                  accessibilityRole="button"
                  accessibilityLabel={entry}
                  onPress={() => setQuery(entry)}
                  style={({ pressed }) => ({
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 0.8 * em,
                    paddingHorizontal: em,
                    paddingVertical: 0.75 * em,
                    backgroundColor: pressed ? colors.surface : "transparent",
                  })}
                >
                  <Icon name="clock" size={1.1 * em} color={colors.fg3} />
                  <Text
                    numberOfLines={1}
                    style={{ flex: 1, fontFamily: fonts.fUi, fontSize: em, color: colors.fg }}
                  >
                    {entry}
                  </Text>
                </Pressable>
              ))}
            </Group>
          )
        ) : results.error !== null ? (
          <View style={{ gap: em, paddingRight: em }}>
            <Text style={quiet}>{m.error_unexpected()}</Text>
            <View style={{ paddingHorizontal: em }}>
              <FocusButton label={m.action_try_again()} onPress={results.retry} />
            </View>
          </View>
        ) : results.pending ? (
          <View style={{ paddingTop: 0.8 * em }}>
            <ListSkeleton rows={6} />
          </View>
        ) : results.none ? (
          <Text style={quiet}>{m.palette_none({ query: results.searched })}</Text>
        ) : (
          <>
            {results.channels.length === 0 ? null : (
              <Group title={m.channels_heading()}>
                {results.channels.map((channel) => (
                  <ResultRow
                    key={channel.id}
                    picture={<ChannelBox channel={channel} />}
                    title={channel.name}
                    meta={
                      channel.number === undefined
                        ? m.player_watch_live()
                        : `${channel.number} · ${m.player_watch_live()}`
                    }
                    onPress={() => {
                      const params = channelTarget(channel, entries, now);
                      if (params === undefined) return;
                      remember(query);
                      router.push({ pathname: "/player", params });
                    }}
                  />
                ))}
              </Group>
            )}
            {programmeGroup(m.guide_on_now(), results.onNow, true)}
            {programmeGroup(m.search_coming_up(), results.comingUp, false)}
            {results.recordings.length === 0 ? null : (
              <Group title={m.nav_recordings()}>
                {results.recordings.map((entry) => (
                  <EntryRow
                    key={entry.id}
                    entry={entry}
                    card={libraryCard(entry, names, labels)}
                    title={
                      entry.subtitle === undefined
                        ? entry.title
                        : `${entry.title} · ${entry.subtitle}`
                    }
                    meta={recordingText(entry, names, now).meta}
                    dim={entry.state === "scheduled"}
                    onPress={() => {
                      remember(query);
                      router.push(recordingHref(entry.id));
                    }}
                  />
                ))}
              </Group>
            )}
          </>
        )}
      </ScrollView>
      {recordFor === undefined ? null : (
        <RecordSheet
          programme={recordFor}
          channelName={channelName(recordFor.channelId)}
          recordings={entries}
          conflicts={results.conflicts}
          onClose={closeRecord}
        />
      )}
    </View>
  );
};
