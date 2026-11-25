import type { Guest } from "@slipstream/api";
import {
  accessFromTokens,
  type AccessToken,
  accessTokens,
  type Channel,
  type Collection,
  InviteExpiry,
  maxStreamsLimit,
} from "@slipstream/domain";
import { inviteExpiryLabel, m } from "@slipstream/i18n";
import * as Haptics from "expo-haptics";
import { useState } from "react";
import { Alert, KeyboardAvoidingView, Platform, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useSession } from "../../../session/session-context.ts";
import { useTheme } from "../../../theme/theme.ts";
import { FocusButton } from "../../../ui/FocusButton.tsx";
import { TextField } from "../../../ui/TextField.tsx";
import { useToast } from "../../../ui/toast.ts";
import { BackHeader } from "../../BackHeader.tsx";
import { AccessField } from "./AccessField.tsx";
import { shareLink, usersActions, useRefreshHousehold } from "./api.ts";
import { PanelHeading, PanelRow, RowGlyph, SwitchRow } from "./parts.tsx";
import { Field, Hairline, Panel, StepperRow } from "../../ui/settings.tsx";
import { profileProblem } from "./problems.ts";

/**
 * Inviting a guest on a phone, as the web's invite dialog: who it is for, what they may see and
 * do, how long the link works. Share invite link creates it and opens the system share sheet
 * with the link (Messages, mail, Copy). With a `guest`, the same form changes that guest's access
 * and offers Remove guest with a native confirm.
 */
export const InviteForm = ({
  guest,
  channels,
  collections,
  onDone,
}: {
  readonly guest: Guest | undefined;
  readonly channels: readonly Channel[];
  readonly collections: readonly Collection[];
  readonly onDone: () => void;
}) => {
  const { colors, em, fonts } = useTheme();
  const insets = useSafeAreaInsets();
  const { runAction } = useSession();
  const toast = useToast();
  const refresh = useRefreshHousehold();
  const [name, setName] = useState("");
  const [tokens, setTokens] = useState<AccessToken[]>(
    guest === undefined ? [] : accessTokens(guest.access),
  );
  const [mayRecord, setMayRecord] = useState(guest?.access.mayRecord ?? false);
  const [streams, setStreams] = useState(guest?.access.maxStreams ?? 1);
  const [expiry, setExpiry] = useState<InviteExpiry>("sevenDays");
  const [nameProblem, setNameProblem] = useState<string | undefined>(undefined);
  const [problem, setProblem] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  const failed = (error: unknown) => {
    setBusy(false);
    setProblem(profileProblem(error).text);
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
  };

  const submit = async () => {
    if (busy) return;
    const access = accessFromTokens(tokens, {
      mayRecord,
      maxStreams: streams === 0 ? undefined : streams,
    });
    setProblem(undefined);
    if (guest === undefined && name.trim() === "") {
      setNameProblem(m.invite_name_missing());
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      return;
    }
    setBusy(true);
    try {
      if (guest === undefined) {
        const created = await runAction(
          usersActions.inviteGuest({ name: name.trim(), access, expiry }),
        );
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        await refresh();
        // The invite exists now; sharing is only the way to send it, so a closed share sheet
        // still leaves it in the list to share again.
        await shareLink(created.url);
        toast({ text: m.invite_send_hint({ expiry: inviteExpiryLabel(expiry) }) });
      } else {
        await runAction(usersActions.updateGuest(guest.id, { access }));
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        toast({ text: m.guest_saved({ name: guest.displayName }) });
        await refresh();
      }
      setBusy(false);
      onDone();
    } catch (error) {
      failed(error);
    }
  };

  const askRemove = (target: Guest) =>
    Alert.alert(m.users_remove_confirm({ name: target.displayName }), undefined, [
      { text: m.action_cancel(), style: "cancel" },
      {
        text: m.guest_remove(),
        style: "destructive",
        onPress: () => {
          setBusy(true);
          runAction(usersActions.removeProfile(target.id))
            .then(async () => {
              toast({ text: m.toast_deleted_named({ name: target.displayName }) });
              await refresh();
              setBusy(false);
              onDone();
            })
            .catch(failed);
        },
      },
    ]);

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.bg }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <BackHeader
        title={
          guest === undefined ? m.invite_title() : m.guest_access_title({ name: guest.displayName })
        }
        action={
          guest === undefined ? null : (
            <FocusButton
              label={m.action_save()}
              variant="primary"
              size={0.85}
              disabled={busy}
              onPress={() => void submit()}
            />
          )
        }
      />
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingBottom: insets.bottom + 2 * em }}
      >
        {guest === undefined ? (
          <View style={{ paddingHorizontal: em, paddingTop: 0.6 * em }}>
            <Field label={m.field_name()} problem={nameProblem}>
              <TextField
                label={m.field_name()}
                value={name}
                autoComplete="off"
                returnKeyType="done"
                onChangeText={(next) => {
                  setName(next);
                  setNameProblem(undefined);
                }}
              />
            </Field>
          </View>
        ) : null}
        <PanelHeading title={m.access_label()} />
        <Panel>
          <AccessField
            tokens={tokens}
            onChange={setTokens}
            channels={channels}
            collections={collections}
          />
          <Hairline />
          <SwitchRow title={m.access_may_record()} value={mayRecord} onChange={setMayRecord} />
          <Hairline />
          <StepperRow
            title={m.access_streams()}

            value={streams === 0 ? m.access_streams_unlimited() : String(streams)}

            canLess={streams > 0}

            canMore={streams < maxStreamsLimit}

            onStep={(direction) => setStreams(streams + direction)}
          />
        </Panel>
        {guest === undefined ? (
          <>
            <PanelHeading title={m.invite_expires()} />
            <Panel>
              {InviteExpiry.literals.map((value, index) => (
                <View key={value}>
                  {index === 0 ? null : <Hairline />}
                  <PanelRow
                    title={inviteExpiryLabel(value)}
                    selected={value === expiry}
                    onPress={() => setExpiry(value)}
                  />
                </View>
              ))}
            </Panel>
          </>
        ) : null}
        {/* One line kept for what went wrong, so nothing below moves when it says so. */}
        <Text
          accessibilityLiveRegion={problem === undefined ? "none" : "polite"}
          style={{
            minHeight: 1.4 * em,
            marginTop: 0.8 * em,
            paddingHorizontal: em,
            fontFamily: fonts.fUi,
            fontSize: 0.9 * em,
            color: colors.warnText,
          }}
        >
          {problem ?? ""}
        </Text>
        {guest === undefined ? (
          <View style={{ paddingHorizontal: em, paddingTop: 0.4 * em }}>
            <FocusButton
              label={m.invite_share_link()}
              variant="primary"
              disabled={busy}
              onPress={() => void submit()}
            />
          </View>
        ) : (
          <View style={{ marginTop: 0.6 * em }}>
            <Panel>
              <PanelRow
                lead={<RowGlyph name="delete" tone="danger" />}
                title={m.guest_remove()}
                tone="danger"
                onPress={busy ? undefined : () => askRemove(guest)}
              />
            </Panel>
          </View>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
};
