import type { RecordingEntry } from "@slipstream/api";
import { formatters, m, pathLabels, recordingFacts } from "@slipstream/i18n";
import { householdZone } from "../../data/zone.ts";
import { ActionRow } from "../ui/settings.tsx";
import { captureMarks, placeOf } from "../../data/capture-marks.ts";
import { useRouter } from "expo-router";
import { Alert, ScrollView, Text, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { problemLine } from "../../data/recording-text.ts";
import { playRows, useRecordingActions } from "../../recordings/use-recording-actions.ts";
import { useTheme } from "../../theme/theme.ts";
import { Artwork } from "../../ui/Artwork.tsx";
import { CaptureTimeline } from "../../ui/CaptureTimeline.tsx";
import { Chip } from "../../ui/Chip.tsx";
import { FocusButton } from "../../ui/FocusButton.tsx";
import { Icon } from "../../ui/Icon.tsx";
import { useNow } from "../../ui/use-now.ts";
import { BackHeader } from "../BackHeader.tsx";
import { PageStatus } from "../ui/PageStatus.tsx";
import { DetailSkeleton } from "../PhoneSkeletons.tsx";
import { useRecordings } from "../../recordings/use-recordings.ts";
import { groupHref } from "../../routes.ts";

const Detail = ({
  entry,
  all,
  channelName,
  place,
}: {
  readonly entry: RecordingEntry;
  readonly all: readonly RecordingEntry[];
  readonly channelName: string;
  /** The show or collection it belongs to, when that holds more. */
  readonly place: { readonly key: string; readonly name: string } | undefined;
}) => {
  const { colors, em, fonts, radii } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const now = useNow(30_000);
  const { play, protect, remove } = useRecordingActions(entry, () => undefined);
  const rows = playRows(entry, now);
  const problem = problemLine(entry, all, now);
  const running = entry.state === "recording";
  const side = 1.1 * em;
  const { marks, watched } = captureMarks(entry, now);
  const askDelete = () =>
    Alert.alert(
      m.library_delete_question({ size: formatters().size(entry.sizeBytes) }),
      undefined,
      [
        { text: m.action_cancel(), style: "cancel" },
        {
          text: m.action_delete(),
          style: "destructive",
          onPress: () => {
            remove();
            router.back();
          },
        },
      ],
    );
  const [primary, ...others] = rows;

  return (
    <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 2 * em }}>
      <View style={{ width, aspectRatio: 16 / 9, backgroundColor: colors.raised }}>
        <Artwork subject={entry} logoHeight={3.4 * em} />
      </View>
      <View style={{ paddingHorizontal: side, paddingTop: 1.1 * em, gap: 0.55 * em }}>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 0.5 * em }}>
          {running ? <Chip label={m.status_recording()} tone="rec" size={0.8} /> : null}
          {entry.protected ? (
            <Chip label={m.recordings_protected()} tone="outline" size={0.8} />
          ) : null}
        </View>
        <Text
          accessibilityRole="header"
          style={{ fontFamily: fonts.fUiSemiBold, fontSize: 1.65 * em, color: colors.fg }}
        >
          {entry.title}
        </Text>
        {entry.subtitle === undefined ? null : (
          <Text style={{ fontFamily: fonts.fUi, fontSize: 1.02 * em, color: colors.fg2 }}>
            {entry.subtitle}
          </Text>
        )}
        <Text style={{ fontFamily: fonts.fUi, fontSize: 0.88 * em, color: colors.fg3 }}>
          {recordingFacts(entry, now, householdZone(), channelName)}
        </Text>
        {problem === undefined ? null : (
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 0.5 * em,
              padding: 0.7 * em,
              borderRadius: radii.rM,
              backgroundColor: colors.surface,
            }}
          >
            <Icon
              name="warn"
              size={1.1 * em}
              color={problem.failed ? colors.liveText : colors.warnText}
            />
            <Text
              style={{
                flex: 1,
                fontFamily: fonts.fUi,
                fontSize: 0.9 * em,
                color: problem.failed ? colors.liveText : colors.warnText,
              }}
            >
              {problem.text}
            </Text>
          </View>
        )}
        {running ? (
          <View style={{ paddingVertical: 0.4 * em }}>
            <CaptureTimeline width={width - 2 * side} marks={marks} />
          </View>
        ) : watched === undefined ? null : (
          // A finished recording: only how far the viewer got.
          <View
            style={{
              height: 0.3 * em,
              borderRadius: 0.15 * em,
              marginVertical: 0.4 * em,
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
        {primary === undefined ? null : (
          <View style={{ gap: 0.6 * em, paddingTop: 0.3 * em }}>
            <FocusButton
              label={primary.title}
              icon={primary.icon}
              variant="primary"
              onPress={() => play(primary.target)}
            />
            {others.length === 0 ? null : (
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 0.6 * em }}>
                {others.map((row) => (
                  <FocusButton
                    key={row.key}
                    label={row.title}
                    icon={row.icon}
                    size={0.9}
                    onPress={() => play(row.target)}
                  />
                ))}
              </View>
            )}
          </View>
        )}
        {entry.description === undefined ? null : (
          <Text
            style={{
              fontFamily: fonts.fUi,
              fontSize: 0.95 * em,
              lineHeight: 1.45 * em,
              color: colors.fg2,
              paddingTop: 0.5 * em,
            }}
          >
            {entry.description}
          </Text>
        )}
      </View>
      <View
        style={{
          marginTop: 1.4 * em,
          marginHorizontal: side,
          borderRadius: radii.rL,
          backgroundColor: colors.surface,
          overflow: "hidden",
        }}
      >
        {place === undefined ? null : (
          <ActionRow
            icon="series"
            title={place.name}
            trailing="chevron"
            onPress={() => router.push(groupHref(place.key))}
          />
        )}
        <ActionRow
          icon="lock"
          title={m.library_protect()}
          trailing={entry.protected ? "check" : undefined}
          onPress={protect}
        />
        <ActionRow icon="delete" title={m.library_delete_ask()} tone="danger" onPress={askDelete} />
      </View>
    </ScrollView>
  );
};

/**
 * A recording's page on a phone (the web's recording page): its picture across the top, the
 * title, one quiet line, the problem when it has one, how far it is captured and watched, the
 * ways to watch, the description, then the show it belongs to, Protect and Delete.
 */
export const PhoneRecordingDetail = ({ id }: { readonly id: string }) => {
  const { colors } = useTheme();
  const library = useRecordings();
  const entry = library.all.find((candidate) => candidate.id === id);
  if (library.loading) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg }}>
        <BackHeader floating />
        <DetailSkeleton />
      </View>
    );
  }
  if (library.error !== null) {
    return <PageStatus title={m.library_error_title()} onRetry={library.retry} />;
  }
  if (entry === undefined) return <PageStatus title={m.library_missing_title()} />;
  const labels = pathLabels();
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <BackHeader floating />
      <Detail
        entry={entry}
        all={library.all}
        channelName={library.names.get(entry.channelId) ?? ""}
        place={placeOf(entry, library.all, library.collections, labels)}
      />
    </View>
  );
};
