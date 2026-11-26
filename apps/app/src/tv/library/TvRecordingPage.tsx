import type { RecordingEntry } from "@slipstream/api";
import { formatters, m, pathLabels, recordingFacts } from "@slipstream/i18n";
import { householdZone } from "../../data/zone.ts";
import { captureMarks, placeOf } from "../../data/capture-marks.ts";
import { type ReactNode, useEffect, useState } from "react";
import { BackHandler, StyleSheet, Text, View } from "react-native";
import { problemLine } from "../../data/recording-text.ts";
import { useRecordings } from "../../recordings/use-recordings.ts";
import { playRows, useRecordingActions } from "../../recordings/use-recording-actions.ts";
import { useTheme } from "../../theme/theme.ts";
import { CaptureTimeline } from "../../ui/CaptureTimeline.tsx";
import { Chip } from "../../ui/Chip.tsx";
import { FocusButton } from "../../ui/FocusButton.tsx";
import { Icon } from "../../ui/Icon.tsx";
import { Bone, Skeleton } from "../../ui/Skeleton.tsx";
import { useNow } from "../../ui/use-now.ts";
import { Backdrop } from "../Backdrop.tsx";
import { Rail, RailContent } from "../Rail.tsx";
import { TvStatus } from "../TvStatus.tsx";
import { useOpenPlace, useReturnFocus, useTvBack } from "./use-tv-navigation.ts";

/** How wide the words and the timeline run, in em: the picture stays in view to the right. */
const TEXT_EM = 52;
const TIMELINE_EM = 34;

/** Focus keys of the buttons after the ways to watch. */
const PROTECT_KEY = "protect";
const DELETE_KEY = "delete";
const PLACE_KEY = "place";

/** The page's frame: the backdrop, the rail, and the column the content sits in. */
const Frame = ({
  subject,
  children,
}: {
  readonly subject: RecordingEntry | undefined;
  readonly children: ReactNode;
}) => {
  const { colors, em } = useTheme();
  return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.bg }]}>
      <Backdrop subject={subject} />
      <Rail current="recordings" />
      <RailContent>
        <View
          style={[
            StyleSheet.absoluteFill,
            {
              paddingLeft: 3 * em,
              paddingRight: 4 * em,
              // The chips sit level with the logo in the rail, as Home's eyebrow does.
              paddingTop: 2.75 * em,
              gap: 0.8 * em,
            },
          ]}
        >
          {children}
        </View>
      </RailContent>
    </View>
  );
};

/** The page while the library loads: its shapes where the words and buttons will be. */
const PageSkeleton = () => {
  const { em } = useTheme();
  return (
    <Frame subject={undefined}>
      <Skeleton>
        <View style={{ gap: 0.8 * em }}>
          <View style={{ height: 2.1 * em }} />
          <Bone width={36 * em} height={3.1 * em} />
          <Bone width={24 * em} height={1.4 * em} />
          <Bone width={TEXT_EM * em} height={4.8 * em} />
          <View style={{ flexDirection: "row", gap: em, paddingTop: 0.6 * em }}>
            <Bone width={14 * em} height={3.4 * em} />
            <Bone width={11 * em} height={3.4 * em} />
            <Bone width={11 * em} height={3.4 * em} />
          </View>
        </View>
      </Skeleton>
    </Frame>
  );
};

/** The page once the recording is known. */
const Detail = ({
  entry,
  all,
  channelName,
  place,
  back,
}: {
  readonly entry: RecordingEntry;
  readonly all: readonly RecordingEntry[];
  readonly channelName: string;
  /** The show or collection it belongs to, when that holds more than this one. */
  readonly place: { readonly key: string; readonly name: string } | undefined;
  readonly back: () => void;
}) => {
  const { colors, em, fonts } = useTheme();
  const openPlace = useOpenPlace();
  const now = useNow(30_000);
  const [confirming, setConfirming] = useState(false);
  // Leaving runs before playback opens (the page stays under the player) and after a delete
  // (only asked from the question): then the page goes back.
  const { play, protect, remove } = useRecordingActions(entry, () => {
    if (confirming) back();
  });
  const rows = playRows(entry, now);
  // Focus starts on the first way to watch; back from the player, the show or the question it
  // returns to the button pressed (Delete… after Cancel).
  const { target, opening } = useReturnFocus({
    keys: [
      ...rows.map((row) => row.key),
      PROTECT_KEY,
      DELETE_KEY,
      ...(place === undefined ? [] : [PLACE_KEY]),
    ],
    first: rows[0]?.key ?? PROTECT_KEY,
    covered: confirming,
  });
  const problem = problemLine(entry, all, now);
  const running = entry.state === "recording";
  const { marks, watched } = captureMarks(entry, now);

  // Back while asking closes the question, not the page.
  useEffect(() => {
    if (!confirming) return undefined;
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      setConfirming(false);
      return true;
    });
    return () => subscription.remove();
  }, [confirming]);

  return (
    <Frame subject={entry}>
      <View style={[styles.row, { gap: 0.6 * em, height: 2.1 * em }]}>
        {running ? <Chip label={m.status_recording()} tone="rec" size={0.92} /> : null}
        {entry.protected ? (
          <Chip label={m.recordings_protected()} tone="outline" size={0.92} />
        ) : null}
      </View>
      <Text
        numberOfLines={2}
        style={{
          fontFamily: fonts.fDisplay,
          fontSize: 3.2 * em,
          lineHeight: 3.1 * em,
          color: colors.fg,
          maxWidth: TEXT_EM * em,
        }}
      >
        {entry.title.toUpperCase()}
      </Text>
      {entry.subtitle === undefined ? null : (
        <Text
          numberOfLines={1}
          style={{
            fontFamily: fonts.fUiSemiBold,
            fontSize: 1.4 * em,
            color: colors.fg,
            maxWidth: TEXT_EM * em,
          }}
        >
          {entry.subtitle}
        </Text>
      )}
      <Text
        numberOfLines={1}
        style={{
          fontFamily: fonts.fUi,
          fontSize: 1.2 * em,
          color: colors.fg2,
          maxWidth: TEXT_EM * em,
        }}
      >
        {recordingFacts(entry, now, householdZone(), channelName)}
      </Text>
      {problem === undefined ? null : (
        <View style={[styles.row, { gap: 0.6 * em, maxWidth: TEXT_EM * em }]}>
          <Icon
            name="warn"
            size={1.3 * em}
            color={problem.failed ? colors.liveText : colors.warnText}
          />
          <Text
            numberOfLines={2}
            style={{
              flexShrink: 1,
              fontFamily: fonts.fUi,
              fontSize: 1.15 * em,
              color: problem.failed ? colors.liveText : colors.warnText,
            }}
          >
            {problem.text}
          </Text>
        </View>
      )}
      {running ? (
        <View style={{ paddingVertical: 0.3 * em }}>
          <CaptureTimeline
            width={TIMELINE_EM * em}
            marks={{
              ...marks,
            }}
          />
        </View>
      ) : watched === undefined ? null : (
        // A finished recording: only how far the viewer got.
        <View
          style={{
            width: TIMELINE_EM * em,
            height: 0.4 * em,
            borderRadius: 0.2 * em,
            marginVertical: 0.3 * em,
            backgroundColor: colors.raised,
            overflow: "hidden",
          }}
        >
          <View
            style={{
              width: `${Math.round(Math.min(1, watched) * 100)}%`,
              height: "100%",
              backgroundColor: colors.brand,
            }}
          />
        </View>
      )}
      {entry.description === undefined ? null : (
        <Text
          numberOfLines={4}
          style={{
            fontFamily: fonts.fUi,
            fontSize: 1.1 * em,
            lineHeight: 1.6 * em,
            color: colors.fg2,
            maxWidth: TEXT_EM * em,
          }}
        >
          {entry.description}
        </Text>
      )}
      {/* The question takes the buttons' row, so nothing above or below it moves. */}
      {confirming ? (
        <View style={[styles.row, { gap: em, paddingTop: 0.6 * em, maxWidth: TEXT_EM * em }]}>
          <Text
            numberOfLines={2}
            style={{
              flexShrink: 1,
              fontFamily: fonts.fUiSemiBold,
              fontSize: 1.2 * em,
              color: colors.fg,
            }}
          >
            {m.library_delete_question({ size: formatters().size(entry.sizeBytes) })}
          </Text>
          <FocusButton
            label={m.action_delete()}
            icon="delete"
            size={1.2}
            preferredFocus
            onPress={remove}
          />
          <FocusButton
            label={m.action_cancel()}
            size={1.2}
            variant="ghost"
            onPress={() => setConfirming(false)}
          />
        </View>
      ) : (
        <View style={[styles.row, { gap: em, paddingTop: 0.6 * em, flexWrap: "wrap" }]}>
          {rows.map((row) => (
            <FocusButton
              key={row.key}
              label={row.title}
              icon={row.icon}
              size={1.2}
              preferredFocus={target === row.key}
              onPress={() => {
                opening(row.key);
                play(row.target);
              }}
            />
          ))}
          <FocusButton
            label={entry.protected ? m.library_unprotect() : m.library_protect()}
            icon={entry.protected ? "check" : "lock"}
            size={1.2}
            variant="ghost"
            preferredFocus={target === PROTECT_KEY}
            onPress={protect}
          />
          <FocusButton
            label={m.library_delete_ask()}
            icon="delete"
            size={1.2}
            variant="ghost"
            preferredFocus={target === DELETE_KEY}
            onPress={() => {
              opening(DELETE_KEY);
              setConfirming(true);
            }}
          />
          {place === undefined ? null : (
            <FocusButton
              label={place.name}
              icon="series"
              size={1.2}
              variant="ghost"
              preferredFocus={target === PLACE_KEY}
              onPress={() => {
                opening(PLACE_KEY);
                openPlace(place.key);
              }}
            />
          )}
        </View>
      )}
    </Frame>
  );
};

/**
 * A recording's page on TV (Infuse, Plex; the web's recording page): its picture fills the
 * screen behind, the title large, one quiet line, the problem when it has one, how far it is
 * captured and watched, the description, then one row of buttons: the ways to watch (focus
 * starts on the first), Protect, Delete with a confirm step, and the show it belongs to (back
 * to it, when the page was opened from there).
 */
export const TvRecordingPage = ({ id }: { readonly id: string }) => {
  const back = useTvBack();
  const library = useRecordings();
  if (library.loading) return <PageSkeleton />;
  const entry = library.all.find((candidate) => candidate.id === id);
  // A failed refresh keeps what was loaded; only nothing at all is an error.
  if (entry === undefined && library.error !== null) {
    return (
      <TvStatus current="recordings" title={m.library_error_title()} onRetry={library.retry} />
    );
  }
  if (entry === undefined) {
    return <TvStatus current="recordings" title={m.library_missing_title()} />;
  }
  const labels = pathLabels();
  return (
    <Detail
      entry={entry}
      all={library.all}
      channelName={library.names.get(entry.channelId) ?? ""}
      place={placeOf(entry, library.all, library.collections, labels)}
      back={back}
    />
  );
};

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center" },
});
