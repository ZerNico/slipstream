import type { SourceCheck, SourceStreams } from "@slipstream/api";
import { epochMs, type SourceView } from "@slipstream/domain";
import { formatters, m, sourceKindText } from "@slipstream/i18n";
import { useQuery } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { sourceProblem } from "../../../api/failure.ts";
import { useApiQueries } from "../../../data/hooks.ts";
import { useSession } from "../../../session/session-context.ts";
import { useTheme } from "../../../theme/theme.ts";
import { Chip } from "../../../ui/Chip.tsx";
import { FocusButton } from "../../../ui/FocusButton.tsx";
import { Icon } from "../../../ui/Icon.tsx";
import { useToast } from "../../../ui/toast.ts";
import { sourceActions } from "./api.ts";
import { ResultNote } from "./parts.tsx";
import { useRefreshAfterChange } from "./use-sources.ts";
import { streamPickerHref, usePickerQueries } from "./use-stream-picker.ts";
import { editSourceHref } from "../../../routes.ts";

/** A chip only when something is off: paused, unreachable, at its limit, not checked. */
const HealthChip = ({ source }: { readonly source: SourceView }) => {
  if (!source.enabled) return <Chip label={m.series_paused()} tone="outline" size={0.7} />;
  switch (source.health) {
    case "ok":
      return null;
    case "unreachable":
      return <Chip label={m.source_health_unreachable()} tone="live" size={0.7} />;
    case "limitReached":
      return <Chip label={m.source_health_limit()} tone="warn" size={0.7} />;
    case "unknown":
      return <Chip label={m.source_health_unknown()} tone="outline" size={0.7} />;
  }
};

/** What the last refresh said, from this card: found so much, or why it failed. */
type Outcome =
  | { readonly kind: "found"; readonly check: SourceCheck }
  | { readonly kind: "failed"; readonly text: string };

/**
 * One source as the web's card shows it: its name and health, kind, streams offered, streams in
 * use against its limit and the last refresh; Refresh now (Test again while unreachable), Edit
 * and Pause or Resume, and what the refresh found.
 */
export const SourceCard = ({
  source,
  usage,
  now,
}: {
  readonly source: SourceView;
  readonly usage: SourceStreams | undefined;
  readonly now: number;
}) => {
  const { colors, em, fonts, radii } = useTheme();
  const router = useRouter();
  const { runAction } = useSession();
  const toast = useToast();
  const refreshAfter = useRefreshAfterChange();
  const queries = useApiQueries();
  const offered = useQuery(queries.sourceStreams(source.id));
  const pickerQueries = usePickerQueries();
  const fresh = useQuery(pickerQueries.newCount(source.id));
  const [busy, setBusy] = useState<"refresh" | "pause" | undefined>(undefined);
  const [outcome, setOutcome] = useState<Outcome | undefined>(undefined);
  const unreachable = source.enabled && source.health === "unreachable";
  const counts = usage?.counts;
  const lastRefresh =
    source.lastRefreshAt === undefined ? undefined : epochMs(source.lastRefreshAt);
  const meta = [
    sourceKindText(source.config._tag),
    offered.data === undefined ? undefined : m.source_streams_count({ count: offered.data.length }),
    counts?.maxStreams === undefined
      ? undefined
      : m.source_streams_of({ used: counts.recording + counts.watching, max: counts.maxStreams }),
    lastRefresh === undefined
      ? undefined
      : m.source_updated_ago({
          duration: formatters().duration(Math.max(60_000, now - lastRefresh) / 1000),
        }),
  ]
    .filter((part) => part !== undefined)
    .join(" · ");

  const refresh = () => {
    setBusy("refresh");
    void Haptics.selectionAsync();
    runAction(sourceActions.refreshSource(source.id))
      .then((check) => {
        setOutcome({ kind: "found", check });
        return refreshAfter("sources");
      })
      .catch((error: unknown) => setOutcome({ kind: "failed", text: sourceProblem(error) }))
      .finally(() => setBusy(undefined));
  };
  const togglePause = () => {
    setBusy("pause");
    void Haptics.selectionAsync();
    runAction(sourceActions.updateSource(source.id, { enabled: !source.enabled }))
      .then(() => refreshAfter("sources"))
      .then(() =>
        toast({
          text: source.enabled
            ? m.source_paused_named({ name: source.name })
            : m.source_resumed_named({ name: source.name }),
        }),
      )
      .catch(() => toast({ text: m.state_not_saved() }))
      .finally(() => setBusy(undefined));
  };

  return (
    <View
      accessibilityLabel={source.name}
      style={{
        marginHorizontal: em,
        padding: em,
        gap: 0.6 * em,
        borderRadius: radii.rL,
        backgroundColor: colors.surface,
        borderWidth: 1,
        borderColor: unreachable ? colors.liveText : "transparent",
      }}
    >
      {/* The card's head opens the source's form: no Edit button competing with the actions. */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${source.name}, ${m.source_edit()}`}
        onPress={() => router.push(editSourceHref(source.id))}
        style={({ pressed }) => ({
          flexDirection: "row",
          alignItems: "center",
          gap: 0.6 * em,
          opacity: pressed ? 0.6 : 1,
        })}
      >
        <View style={{ flex: 1, gap: 0.25 * em }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 0.5 * em }}>
            <Text
              numberOfLines={1}
              style={{
                flexShrink: 1,
                fontFamily: fonts.fUiSemiBold,
                fontSize: 1.02 * em,
                color: source.enabled ? colors.fg : colors.fg3,
              }}
            >
              {source.name}
            </Text>
            <HealthChip source={source} />
          </View>
          <Text style={{ fontFamily: fonts.fUi, fontSize: 0.85 * em, color: colors.fg2 }}>
            {meta}
          </Text>
        </View>
        <View style={{ transform: [{ rotate: "180deg" }] }}>
          <Icon name="chevronLeft" size={1.2 * em} color={colors.fg3} />
        </View>
      </Pressable>
      {outcome === undefined ? (
        unreachable ? (
          <ResultNote tone="error">
            {m.source_unreachable_body(
              lastRefresh === undefined ? {} : { at: new Date(lastRefresh) },
            )}
          </ResultNote>
        ) : null
      ) : outcome.kind === "found" ? (
        <ResultNote tone="ok">
          {m.source_refresh_result({
            streams: outcome.check.streams,
            programmes: outcome.check.programmes,
          })}
        </ResultNote>
      ) : (
        <ResultNote tone="error">{outcome.text}</ResultNote>
      )}
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 0.4 * em }}>
        <FocusButton
          label={unreachable ? m.source_test_again() : m.source_refresh()}
          size={0.85}
          disabled={busy !== undefined}
          onPress={refresh}
        />
        <FocusButton
          label={
            source.reviewedAt !== undefined && (fresh.data ?? 0) > 0
              ? m.picker_new_streams({ count: fresh.data ?? 0 })
              : m.picker_title()
          }
          variant="ghost"
          size={0.85}
          onPress={() => router.push(streamPickerHref(source.id))}
        />

        <FocusButton
          label={source.enabled ? m.action_pause() : m.action_resume()}
          variant="ghost"
          size={0.85}
          disabled={busy !== undefined}
          onPress={togglePause}
        />
      </View>
    </View>
  );
};
