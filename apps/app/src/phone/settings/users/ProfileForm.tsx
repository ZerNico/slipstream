import {
  accessFromTokens,
  type AccessToken,
  accessTokens,
  AvatarTone,
  type Channel,
  type Collection,
  fullAccess,
  isPin,
  maxStreamsLimit,
  pinChange,
  pinInput,
  type PinMode,
  type Profile,
  type Role,
} from "@slipstream/domain";
import { m, toneLabel } from "@slipstream/i18n";
import * as Haptics from "expo-haptics";
import { type ReactNode, useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useSession } from "../../../session/session-context.ts";
import { useTheme } from "../../../theme/theme.ts";
import { FocusButton } from "../../../ui/FocusButton.tsx";
import { TextField } from "../../../ui/TextField.tsx";
import { useToast } from "../../../ui/toast.ts";
import { BackHeader } from "../../BackHeader.tsx";
import { AccessField } from "./AccessField.tsx";
import { usersActions, useRefreshHousehold } from "./api.ts";
import { Avatar, PanelHeading, PanelRow, RowGlyph, SwitchRow } from "./parts.tsx";
import { Field, Hairline, Panel, StepperRow } from "../../ui/settings.tsx";
import { profileProblem } from "./problems.ts";

/** The picture: the avatar as it will look, then one round swatch per tone. */
const TonePicker = ({
  name,
  value,
  onChange,
}: {
  readonly name: string;
  readonly value: AvatarTone;
  readonly onChange: (tone: AvatarTone) => void;
}) => {
  const { colors, em } = useTheme();
  const swatch = 2.3 * em;
  return (
    <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 0.5 * em }}>
      <Avatar name={name.trim() === "" ? "?" : name} tone={value} size={3.2 * em} />
      <View
        style={{
          width: 1,
          height: 2 * em,
          marginHorizontal: 0.2 * em,
          backgroundColor: colors.line,
        }}
      />
      {AvatarTone.literals.map((tone) => (
        <Pressable
          key={tone}
          accessibilityRole="radio"
          accessibilityState={{ checked: tone === value }}
          accessibilityLabel={m.profile_tone({ tone: toneLabel(tone) })}
          onPress={() => {
            void Haptics.selectionAsync();
            onChange(tone);
          }}
          style={{
            width: swatch + 0.5 * em,
            height: swatch + 0.5 * em,
            borderRadius: swatch,
            borderWidth: 2,
            borderColor: tone === value ? colors.fg : "transparent",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Avatar name="" tone={tone} size={swatch} />
        </Pressable>
      ))}
    </View>
  );
};

/** The problems the form shows, each in the line its field keeps. */
interface Problems {
  readonly name?: string | undefined;
  readonly pin?: string | undefined;
  readonly currentPin?: string | undefined;
  readonly form?: string | undefined;
}

/**
 * Adding or editing a household profile on a phone, as the web's profile dialog: name, picture
 * and PIN for everyone; for an admin editing someone else also the role and what the profile
 * may see and do, and Delete with a native confirm. Save sits in the header; `intro` is shown
 * above the form (Your profile's card).
 */
export const ProfileForm = ({
  profile,
  title,
  channels,
  collections,
  intro,
  onDone,
}: {
  /** The profile to edit; none adds one. */
  readonly profile: Profile | undefined;
  /** The page's title, when not "Add profile" or "Edit Mara". */
  readonly title?: string;
  readonly channels: readonly Channel[];
  readonly collections: readonly Collection[];
  readonly intro?: ReactNode;
  readonly onDone: () => void;
}) => {
  const { colors, em, fonts } = useTheme();
  const insets = useSafeAreaInsets();
  const { account, runAction } = useSession();
  const toast = useToast();
  const refresh = useRefreshHousehold();
  const admin = account?.role === "admin";
  const self = profile !== undefined && profile.id === account?.userId;
  const [name, setName] = useState(profile?.displayName ?? "");
  const [tone, setTone] = useState<AvatarTone>(profile?.avatarTone ?? "teal");
  const [role, setRole] = useState<Role>(profile?.role ?? "user");
  const [tokens, setTokens] = useState<AccessToken[]>(accessTokens(profile?.access ?? fullAccess));
  const [mayRecord, setMayRecord] = useState(profile?.access.mayRecord ?? true);
  const [streams, setStreams] = useState(profile?.access.maxStreams ?? 0);
  const hadPin = profile?.hasPin ?? false;
  const [pinMode, setPinMode] = useState<PinMode>("keep");
  const [pin, setPin] = useState("");
  const [currentPin, setCurrentPin] = useState("");
  const [problems, setProblems] = useState<Problems>({});
  const [busy, setBusy] = useState(false);
  const pinOn = pinMode === "set" || (hadPin && pinMode === "keep");
  const editsRole = admin && !self && profile?.kind !== "guest";
  const editsAccess = admin && role !== "admin" && !self;

  const failed = (error: unknown) => {
    const problem = profileProblem(error);
    setProblems(
      problem.field === "currentPin" ? { currentPin: problem.text } : { form: problem.text },
    );
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
  };

  const save = async () => {
    if (busy) return;
    const trimmed = name.trim();
    const next: Problems = {
      ...(trimmed === "" ? { name: m.profile_name_missing() } : {}),
      ...(pinMode === "set" && !isPin(pin) ? { pin: m.profile_pin_invalid() } : {}),
    };
    setProblems(next);
    if (next.name !== undefined || next.pin !== undefined) {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      return;
    }
    const access = editsAccess
      ? accessFromTokens(tokens, { mayRecord, maxStreams: streams === 0 ? undefined : streams })
      : undefined;
    setBusy(true);
    try {
      if (profile === undefined) {
        await runAction(
          usersActions.createProfile({
            displayName: trimmed,
            avatarTone: tone,
            role,
            ...(pinMode === "set" && isPin(pin) ? { pin } : {}),
            ...(access === undefined ? {} : { access }),
          }),
        );
      } else {
        await runAction(
          usersActions.updateProfile(profile.id, {
            displayName: trimmed,
            avatarTone: tone,
            ...(admin && !self && profile.kind === "household" ? { role } : {}),
            ...(access === undefined ? {} : { access }),
          }),
        );
        const change = pinChange({ mode: pinMode, pin, currentPin, needsCurrent: self && hadPin });
        if (change !== undefined) await runAction(usersActions.setPin(profile.id, change));
      }
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      toast({ text: m.toast_saved_named({ name: trimmed }) });
      await refresh();
      setBusy(false);
      onDone();
    } catch (error) {
      setBusy(false);
      failed(error);
    }
  };

  const remove = (target: Profile) => {
    setBusy(true);
    runAction(usersActions.removeProfile(target.id))
      .then(async () => {
        toast({ text: m.toast_deleted_named({ name: target.displayName }) });
        await refresh();
        setBusy(false);
        onDone();
      })
      .catch((error: unknown) => {
        setBusy(false);
        failed(error);
      });
  };

  const askRemove = (target: Profile) =>
    // Deleting signs out the profile's devices and can't be undone: a native confirm first.
    Alert.alert(m.users_remove_confirm({ name: target.displayName }), undefined, [
      { text: m.action_cancel(), style: "cancel" },
      { text: m.action_delete(), style: "destructive", onPress: () => remove(target) },
    ]);

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.bg }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <BackHeader
        title={
          title ??
          (profile === undefined
            ? m.profiles_add()
            : m.action_edit_named({ name: profile.displayName }))
        }
        action={
          <FocusButton
            label={profile === undefined ? m.profiles_add() : m.action_save()}
            variant="primary"
            size={0.85}
            disabled={busy}
            onPress={() => void save()}
          />
        }
      />
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingBottom: insets.bottom + 2 * em }}
      >
        {intro}
        <View style={{ paddingHorizontal: em, paddingTop: 0.6 * em, gap: 0.4 * em }}>
          <Field label={m.field_name()} problem={problems.name}>
            <TextField
              label={m.field_name()}
              value={name}
              autoComplete="off"
              returnKeyType="done"
              onChangeText={(next) => {
                setName(next);
                if (problems.name !== undefined) setProblems({ ...problems, name: undefined });
              }}
              onSubmitEditing={() => void save()}
            />
          </Field>
          <Text style={{ fontFamily: fonts.fUiSemiBold, fontSize: 0.9 * em, color: colors.fg2 }}>
            {m.profile_picture()}
          </Text>
          <TonePicker name={name} value={tone} onChange={setTone} />
        </View>
        {editsRole ? (
          <>
            <PanelHeading title={m.users_role()} />
            <Panel>
              <PanelRow
                title={m.users_role_user()}
                selected={role === "user"}
                onPress={() => setRole("user")}
              />
              <Hairline />
              <PanelRow
                title={m.profile_admin()}
                selected={role === "admin"}
                onPress={() => setRole("admin")}
              />
            </Panel>
          </>
        ) : null}
        <PanelHeading title={m.profiles_pin()} />
        <Panel>
          <SwitchRow
            title={m.profile_pin_switch()}
            value={pinOn}
            onChange={(checked) => {
              void Haptics.selectionAsync();
              setPinMode(checked ? (hadPin ? "keep" : "set") : hadPin ? "remove" : "keep");
              setPin("");
              setCurrentPin("");
              setProblems({});
            }}
          />
          {hadPin && pinMode === "keep" ? (
            <>
              <Hairline />
              <PanelRow
                lead={<RowGlyph name="lock" />}
                title={m.profile_pin_change()}
                onPress={() => setPinMode("set")}
              />
            </>
          ) : null}
          {self && hadPin && pinMode !== "keep" ? (
            <View style={{ paddingHorizontal: em, paddingTop: 0.6 * em }}>
              <Field label={m.profile_pin_current()} problem={problems.currentPin}>
                <TextField
                  label={m.profile_pin_current()}
                  value={currentPin}
                  keyboardType="number-pad"
                  autoComplete="off"
                  secureTextEntry
                  onChangeText={(next) => {
                    setCurrentPin(pinInput(next));
                    if (problems.currentPin !== undefined) {
                      setProblems({ ...problems, currentPin: undefined });
                    }
                  }}
                />
              </Field>
            </View>
          ) : null}
          {pinMode === "set" ? (
            <View style={{ paddingHorizontal: em, paddingTop: 0.6 * em }}>
              <Field
                label={m.profile_pin_new()}
                hint={m.profile_pin_format()}
                problem={problems.pin}
              >
                <TextField
                  label={m.profile_pin_new()}
                  value={pin}
                  keyboardType="number-pad"
                  autoComplete="off"
                  onChangeText={(next) => {
                    setPin(pinInput(next));
                    if (problems.pin !== undefined) setProblems({ ...problems, pin: undefined });
                  }}
                />
              </Field>
            </View>
          ) : null}
        </Panel>
        {editsAccess ? (
          <>
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
          </>
        ) : null}
        {/* One line kept for what went wrong, so nothing below moves when it says so. */}
        <Text
          accessibilityLiveRegion={problems.form === undefined ? "none" : "polite"}
          style={{
            minHeight: 1.4 * em,
            marginTop: 0.8 * em,
            paddingHorizontal: em,
            fontFamily: fonts.fUi,
            fontSize: 0.9 * em,
            color: colors.warnText,
          }}
        >
          {problems.form ?? ""}
        </Text>
        {admin && profile !== undefined && !self ? (
          <View style={{ marginTop: 0.6 * em }}>
            <Panel>
              <PanelRow
                lead={<RowGlyph name="delete" tone="danger" />}
                title={profile.kind === "guest" ? m.guest_remove() : m.users_remove()}
                tone="danger"
                onPress={busy ? undefined : () => askRemove(profile)}
              />
            </Panel>
          </View>
        ) : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
};
