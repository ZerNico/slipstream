import {
  type Channel,
  type ChannelChange,
  channelChangePayload,
  isHttpUrl,
} from "@slipstream/domain";
import { m } from "@slipstream/i18n";
import { useQuery } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import { useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, Switch, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useApiQueries } from "../../../data/hooks.ts";
import { readProblem } from "../../../api/failure.ts";
import { ActionRow, FormField, Hairline, Panel } from "../../ui/settings.tsx";
import { AdminOnly, PageStatus } from "../../ui/PageStatus.tsx";
import { useSession } from "../../../session/session-context.ts";
import { useTheme } from "../../../theme/theme.ts";
import { FocusButton } from "../../../ui/FocusButton.tsx";
import { useToast } from "../../../ui/toast.ts";
import { BackHeader } from "../../BackHeader.tsx";
import { sourceActions } from "./api.ts";
import { GuideSection, GuideSheet } from "./lineup/guide.tsx";
import { lineupActions, useChannelStreams } from "./lineup/queries.ts";
import { NumberSheet, RemoveSheet } from "./lineup/sheets.tsx";
import { StreamList } from "./lineup/stream-list.tsx";
import { ChannelLogo, GroupHeading } from "./parts.tsx";
import { FormSkeleton } from "./SourcesSkeletons.tsx";
import { useRefreshAfterChange } from "./use-sources.ts";

/** A panel row with a title and a switch at the end. */
const SwitchRow = ({
  title,
  value,
  onChange,
}: {
  readonly title: string;
  readonly value: boolean;
  readonly onChange: (value: boolean) => void;
}) => {
  const { colors, em, fonts } = useTheme();
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 0.9 * em,
        paddingHorizontal: em,
        paddingVertical: 0.6 * em,
      }}
    >
      <Text
        style={{ flex: 1, fontFamily: fonts.fUiSemiBold, fontSize: 0.98 * em, color: colors.fg }}
      >
        {title}
      </Text>
      <Switch
        accessibilityLabel={title}
        value={value}
        onValueChange={onChange}
        trackColor={{ true: colors.ok, false: colors.raised }}
        thumbColor={colors.fg}
      />
    </View>
  );
};

/** A section's heading with a quiet note after it ("Streams · Tried in this order"). */
const SectionHeading = ({ text, note }: { readonly text: string; readonly note?: string }) => {
  const { colors, em, fonts } = useTheme();
  return note === undefined ? (
    <GroupHeading text={text} />
  ) : (
    <View
      style={{
        flexDirection: "row",
        alignItems: "baseline",
        gap: 0.6 * em,
        paddingHorizontal: em,
        paddingTop: 1.3 * em,
        paddingBottom: 0.5 * em,
      }}
    >
      <Text style={{ fontFamily: fonts.fUiSemiBold, fontSize: 1.05 * em, color: colors.fg }}>
        {text}
      </Text>
      <Text style={{ fontFamily: fonts.fUi, fontSize: 0.88 * em, color: colors.fg3 }}>{note}</Text>
    </View>
  );
};

/** Which sheet is open over the channel. */
type Open = "number" | "guide" | "remove" | undefined;

/**
 * One channel on a phone (admin), the same sections as the web's detail pane: its logo and
 * name, number, whether it shows and is a favourite, its streams in fallback order, its guide
 * with what is on now and next, its logo address, and Remove (recordings stay).
 */
const ChannelBody = ({
  channel,
  lineup,
}: {
  readonly channel: Channel;
  readonly lineup: readonly Channel[];
}) => {
  const { em } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { runAction } = useSession();
  const toast = useToast();
  const refreshAfter = useRefreshAfterChange();
  const streams = useChannelStreams();
  const [name, setName] = useState(channel.name);
  const [logo, setLogo] = useState(channel.logoUrl ?? "");
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<Open>(undefined);
  // Switches flipped and not yet confirmed by a fresh lineup.
  const [ahead, setAhead] = useState<{ readonly hidden?: boolean; readonly favourite?: boolean }>(
    {},
  );
  const logoValid = logo.trim() === "" || isHttpUrl(logo);
  const nextName = name.trim();
  const nextLogo = logo.trim() === "" ? undefined : logo.trim();
  const change: ChannelChange = {
    ...(nextName === "" || nextName === channel.name ? {} : { name: nextName }),
    ...(nextLogo === channel.logoUrl ? {} : { logoUrl: nextLogo }),
  };
  const changed = Object.keys(change).length > 0;

  const send = (update: ChannelChange, onSaved?: () => void) =>
    runAction(sourceActions.updateChannel(channel.id, channelChangePayload(update)))
      .then(() => refreshAfter("channels"))
      .then(() => onSaved?.())
      .catch(() => toast({ text: m.state_not_saved() }));
  const save = () => {
    if (!logoValid || busy || !changed) return;
    setBusy(true);
    void send(change, () => {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      toast({ text: m.toast_saved_named({ name: change.name ?? channel.name }) });
    }).finally(() => setBusy(false));
  };
  const flip = (key: "hidden" | "favourite", value: boolean) => {
    void Haptics.selectionAsync();
    setAhead((before) => ({ ...before, [key]: value }));
    runAction(
      lineupActions.update(channel.id, key === "hidden" ? { hidden: value } : { favourite: value }),
    )
      .then(() => refreshAfter("channels"))
      .catch(() => toast({ text: m.state_not_saved() }))
      .finally(() =>
        setAhead((before) => {
          const { [key]: _done, ...rest } = before;
          return rest;
        }),
      );
  };
  const hidden = ahead.hidden ?? channel.hidden;
  const favourite = ahead.favourite ?? channel.favourite;

  return (
    <>
      <BackHeader
        title={channel.name}
        action={
          <FocusButton
            label={m.action_save()}
            variant="primary"
            size={0.85}
            disabled={busy || !logoValid || !changed}
            onPress={save}
          />
        }
      />
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingBottom: insets.bottom + 2 * em }}
      >
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: em,
            paddingHorizontal: em,
            paddingTop: 0.6 * em,
          }}
        >
          <ChannelLogo
            name={nextName === "" ? channel.name : nextName}
            logoUrl={logoValid ? nextLogo : undefined}
            size={3 * em}
          />
          <View style={{ flex: 1 }}>
            <FormField
              label={m.field_name()}
              value={name}
              onChangeText={setName}
              returnKeyType="done"
            />
          </View>
        </View>
        <Panel>
          <ActionRow
            icon="tv"
            title={m.lineup_number_field()}
            value={channel.number === undefined ? undefined : String(channel.number)}
            trailing="chevron"
            onPress={() => setOpen("number")}
          />
          <Hairline />
          <SwitchRow
            title={m.lineup_visible_title()}
            value={!hidden}
            onChange={(on) => flip("hidden", !on)}
          />
          <Hairline />
          <SwitchRow
            title={m.lineup_favourite()}
            value={favourite}
            onChange={(on) => flip("favourite", on)}
          />
        </Panel>
        <SectionHeading text={m.lineup_streams()} note={m.lineup_streams_note()} />
        <StreamList channel={channel} known={streams?.get(channel.id)} />
        <SectionHeading text={m.lineup_guide()} />
        <GuideSection channel={channel} onChange={() => setOpen("guide")} />
        <View style={{ paddingHorizontal: em, paddingTop: 1.3 * em }}>
          <FormField
            label={m.channel_logo_url()}
            value={logo}
            onChangeText={setLogo}
            keyboardType="url"
            error={logoValid ? undefined : m.source_url_invalid()}
          />
        </View>
        <Panel>
          {channel.logoUrl === undefined ? null : (
            <>
              <ActionRow
                icon="check"
                title={m.channel_logo_remove()}
                onPress={() => {
                  setLogo("");
                  void send({ logoUrl: undefined });
                }}
              />
              <Hairline />
            </>
          )}
          <ActionRow
            icon="delete"
            tone="danger"
            title={m.lineup_remove()}
            onPress={() => setOpen("remove")}
          />
        </Panel>
      </ScrollView>
      {open === "number" ? (
        <NumberSheet lineup={lineup} ids={[channel.id]} onClose={() => setOpen(undefined)} />
      ) : null}
      {open === "guide" ? (
        <GuideSheet channel={channel} onClose={() => setOpen(undefined)} />
      ) : null}
      {open === "remove" ? (
        <RemoveSheet
          channels={[channel]}
          onDone={() => router.back()}
          onClose={() => setOpen(undefined)}
        />
      ) : null}
    </>
  );
};

/** One channel's page inside the Settings tab (admin). */
const PhoneChannelEditPage = ({ id }: { readonly id: string }) => {
  const { colors } = useTheme();
  const queries = useApiQueries();
  const channels = useQuery(queries.allChannels());
  if (channels.isError) {
    return (
      <PageStatus
        heading={m.channels_heading()}
        title={readProblem(channels.error)}
        onRetry={() => void channels.refetch()}
      />
    );
  }
  if (channels.data === undefined) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg }}>
        <BackHeader title={m.channels_heading()} />
        <FormSkeleton fields={3} />
      </View>
    );
  }
  const channel = channels.data.find((item) => item.id === id);
  if (channel === undefined) {
    return <PageStatus heading={m.channels_heading()} title={m.error_not_found()} />;
  }
  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={{ flex: 1, backgroundColor: colors.bg }}
    >
      <ChannelBody key={channel.id} channel={channel} lineup={channels.data} />
    </KeyboardAvoidingView>
  );
};

/** PhoneChannelEdit behind the admin gate. */
export const PhoneChannelEdit = ({ id }: { readonly id: string }) => (
  <AdminOnly heading={m.channels_heading()}>
    <PhoneChannelEditPage id={id} />
  </AdminOnly>
);
