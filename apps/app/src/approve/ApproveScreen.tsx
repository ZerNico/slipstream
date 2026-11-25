import { type DeviceCodeApproval, formatUserCode, normaliseUserCode } from "@slipstream/api";
import { defaultProfile, type Profile, type UserId } from "@slipstream/domain";
import { m } from "@slipstream/i18n";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useState, type ReactNode } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { apiActions } from "../api/queries.ts";
import { useApiQueries } from "../data/hooks.ts";
import { useSession } from "../session/session-context.ts";
import { useTheme } from "../theme/theme.ts";
import { FocusButton } from "../ui/FocusButton.tsx";
import { Icon } from "../ui/Icon.tsx";
import { StatusScreen } from "../ui/StatusScreen.tsx";
import { TextField } from "../ui/TextField.tsx";
import {
  approveAs,
  approveProblem,
  blockSignIn,
  profileChoices,
  type Approver,
  type ApproveProblem,
} from "./device-link.ts";

const problemText = (problem: ApproveProblem): string =>
  problem === "invalidCode"
    ? m.approve_code_invalid()
    : problem === "forbidden"
      ? m.state_forbidden()
      : m.error_unexpected();

/** Page frame shared by every step: safe-area padding and a narrow column. */
const Frame = ({ children }: { readonly children: ReactNode }) => {
  const { colors, em, isTV } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bg }}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{
        paddingTop: insets.top + 2 * em,
        paddingBottom: insets.bottom + 2 * em,
        paddingHorizontal: (isTV ? 8 : 1.25) * em,
        gap: 1.25 * em,
        maxWidth: isTV ? 50 * em : undefined,
      }}
    >
      {children}
    </ScrollView>
  );
};

/** "Sign in a TV": typing the code by hand when there was nothing to scan. */
const EnterCode = ({ onCode }: { readonly onCode: (code: string) => void }) => {
  const { colors, em, fonts } = useTheme();
  const [typed, setTyped] = useState("");
  const code = normaliseUserCode(typed);
  const submit = () => {
    if (code !== "") onCode(code);
  };
  return (
    <Frame>
      <Text style={{ fontFamily: fonts.fUiSemiBold, fontSize: 1.5 * em, color: colors.fg }}>
        {m.device_link_tv()}
      </Text>
      <Text style={{ fontFamily: fonts.fUi, fontSize: em, color: colors.fg2 }}>
        {m.approve_enter_hint()}
      </Text>
      <TextField
        label={m.approve_code()}
        value={typed}
        onChangeText={setTyped}
        onSubmitEditing={submit}
        autoComplete="one-time-code"
        returnKeyType="go"
        autoFocus
      />
      <FocusButton
        label={m.action_continue()}
        variant="primary"
        disabled={code === ""}
        onPress={submit}
      />
    </Frame>
  );
};

/** One "Sign this TV in as" option: avatar, name, what the profile may do, a radio mark. */
const ProfileOption = ({
  profile,
  me,
  selected,
  onSelect,
}: {
  readonly profile: Pick<Profile, "id" | "displayName" | "role">;
  readonly me: Approver;
  readonly selected: boolean;
  readonly onSelect: () => void;
}) => {
  const { colors, em, fonts, radii } = useTheme();
  const [focused, setFocused] = useState(false);
  const name =
    profile.id === me.id
      ? m.approve_profile_you({ name: profile.displayName })
      : profile.displayName;
  return (
    <Pressable
      onPress={onSelect}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={name}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 0.75 * em,
        minHeight: 3 * em,
        paddingHorizontal: 0.75 * em,
        paddingVertical: 0.6 * em,
        borderRadius: radii.rM,
        borderWidth: focused ? 2 : 1,
        borderColor: focused ? colors.focusRing : selected ? colors.fg : colors.line,
        backgroundColor: selected ? colors.raised : "transparent",
      }}
    >
      <View
        style={{
          width: 2.25 * em,
          height: 2.25 * em,
          borderRadius: 1.125 * em,
          backgroundColor: colors.raised,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Text style={{ fontFamily: fonts.fUiSemiBold, fontSize: em, color: colors.fg }}>
          {profile.displayName.charAt(0).toUpperCase()}
        </Text>
      </View>
      <View style={{ flex: 1, gap: 0.15 * em }}>
        <Text style={{ fontFamily: fonts.fUiSemiBold, fontSize: em, color: colors.fg }}>
          {name}
        </Text>
        <Text style={{ fontFamily: fonts.fUi, fontSize: 0.8 * em, color: colors.fg2 }}>
          {profile.role === "admin" ? m.approve_admin_hint() : m.approve_household_hint()}
        </Text>
      </View>
      <View
        style={{
          width: 1.25 * em,
          height: 1.25 * em,
          borderRadius: 0.625 * em,
          borderWidth: 2,
          borderColor: selected ? colors.fg : colors.borderStrong,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {selected ? (
          <View
            style={{
              width: 0.6 * em,
              height: 0.6 * em,
              borderRadius: 0.3 * em,
              backgroundColor: colors.fg,
            }}
          />
        ) : null}
      </View>
    </Pressable>
  );
};

/** A label over a value in the facts box. */
const Fact = ({ label, children }: { readonly label: string; readonly children: ReactNode }) => {
  const { colors, em, fonts } = useTheme();
  return (
    <View style={{ gap: 0.25 * em }}>
      <Text style={{ fontFamily: fonts.fUiSemiBold, fontSize: 0.75 * em, color: colors.fg3 }}>
        {label}
      </Text>
      {children}
    </View>
  );
};

/**
 * "Sign in on Living Room Shield?" for one code: the code first, to compare with the TV, then
 * the device and the profile it gets, then the answer.
 */
const Approve = ({
  code,
  me,
  onDone,
  onOtherCode,
}: {
  readonly code: string;
  readonly me: Approver;
  readonly onDone: () => void;
  readonly onOtherCode: () => void;
}) => {
  const { colors, em, fonts, radii } = useTheme();
  const { runAction } = useSession();
  const queries = useApiQueries();
  const pending = useQuery({ ...queries.pendingSignIn(code), retry: false });
  const profiles = useQuery({ ...queries.profiles(), enabled: me.role === "admin" });
  const answer = useMutation({
    mutationFn: (approval: DeviceCodeApproval) => runAction(apiActions.answerDeviceCode(approval)),
  });
  const [chosen, setChosen] = useState<UserId | undefined>(undefined);

  if (pending.isPending || (me.role === "admin" && profiles.isPending)) {
    return <StatusScreen title={m.loading()} busy />;
  }
  const lookupProblem = pending.isError ? approveProblem(pending.error) : undefined;
  if (lookupProblem === "invalidCode") {
    return (
      <StatusScreen
        title={m.approve_code_invalid()}
        actions={<FocusButton label={m.action_continue()} preferredFocus onPress={onOtherCode} />}
      />
    );
  }
  // Without the lookup the code can still be approved; it just cannot name the device first.
  const device = pending.data?.device.name ?? m.approve_this_tv();

  if (answer.isSuccess) {
    const approved = answer.variables.approve;
    return (
      <StatusScreen
        title={approved ? m.approve_done_title({ device }) : m.approve_rejected_title()}
        body={approved ? m.approve_done_body() : m.approve_rejected_body()}
        actions={<FocusButton label={m.action_close()} preferredFocus onPress={onDone} />}
      />
    );
  }

  const choices = profileChoices(me, profiles.data);
  const profile = chosen ?? defaultProfile(choices, me);
  const answerProblem = answer.isError ? approveProblem(answer.error) : undefined;
  const busy = answer.isPending;

  return (
    <Frame>
      <View
        style={{
          alignSelf: "flex-start",
          padding: 0.6 * em,
          borderRadius: radii.rM,
          backgroundColor: colors.raised,
        }}
      >
        <Icon name="live" size={1.6 * em} color={colors.fg} />
      </View>
      <Text style={{ fontFamily: fonts.fUiSemiBold, fontSize: 1.4 * em, color: colors.fg }}>
        {m.approve_title({ device })}
      </Text>
      <Text style={{ fontFamily: fonts.fUi, fontSize: em, color: colors.fg2 }}>
        {m.approve_warning()}
      </Text>
      <View
        style={{
          gap: 0.9 * em,
          padding: em,
          borderRadius: radii.rM,
          backgroundColor: colors.surface,
          borderWidth: 1,
          borderColor: colors.line,
        }}
      >
        <Fact label={m.approve_code()}>
          <Text
            accessibilityLabel={code.split("").join(" ")}
            style={{
              fontFamily: fonts.fMonoSemiBold,
              fontSize: 2 * em,
              letterSpacing: 0.1 * em,
              color: colors.fg,
            }}
          >
            {formatUserCode(code)}
          </Text>
        </Fact>
        {pending.data === undefined ? null : (
          <Fact label={m.approve_device()}>
            <Text style={{ fontFamily: fonts.fUiSemiBold, fontSize: em, color: colors.fg }}>
              {pending.data.device.name}
            </Text>
          </Fact>
        )}
      </View>
      {lookupProblem === undefined ? null : (
        <Text style={{ fontFamily: fonts.fUiSemiBold, fontSize: em, color: colors.warnText }}>
          {problemText(lookupProblem)}
        </Text>
      )}
      <View accessibilityRole="radiogroup" style={{ gap: 0.5 * em }}>
        <Text style={{ fontFamily: fonts.fUiSemiBold, fontSize: 0.9 * em, color: colors.fg2 }}>
          {m.approve_as()}
        </Text>
        {choices.map((choice) => (
          <ProfileOption
            key={choice.id}
            profile={choice}
            me={me}
            selected={choice.id === profile}
            onSelect={() => setChosen(choice.id)}
          />
        ))}
      </View>
      {answerProblem === undefined ? null : (
        <Text style={{ fontFamily: fonts.fUiSemiBold, fontSize: em, color: colors.warnText }}>
          {problemText(answerProblem)}
        </Text>
      )}
      <View style={{ gap: 0.6 * em }}>
        <FocusButton
          label={m.approve_confirm()}
          variant="primary"
          preferredFocus
          disabled={busy}
          onPress={() => answer.mutate(approveAs(code, profile, me))}
        />
        <FocusButton
          label={m.approve_reject()}
          variant="ghost"
          disabled={busy}
          onPress={() => answer.mutate(blockSignIn(code))}
        />
      </View>
    </Frame>
  );
};

/**
 * Phone "Approve TV sign-in" (design doc "Phone · Approve TV sign-in"), at `/link?code=QK74RM`.
 * Scanning the TV's QR code opens it through the app scheme or an App Link; "Sign in a TV" in
 * Settings opens it without a code to type one. Shared TVs default to the household profile;
 * only admins can choose another profile than their own.
 */
export const ApproveScreen = () => {
  const router = useRouter();
  const params = useLocalSearchParams<{ code?: string }>();
  const code = normaliseUserCode(typeof params.code === "string" ? params.code : "");
  const queries = useApiQueries();
  const me = useQuery(queries.me());
  const close = () => (router.canGoBack() ? router.back() : router.replace("/"));

  if (code === "") return <EnterCode onCode={(typed) => router.setParams({ code: typed })} />;
  if (me.isPending) return <StatusScreen title={m.loading()} busy />;
  if (me.isError) {
    return (
      <StatusScreen
        title={m.error_unexpected()}
        actions={
          <FocusButton
            label={m.action_try_again()}
            preferredFocus
            onPress={() => void me.refetch()}
          />
        }
      />
    );
  }
  return (
    <Approve
      key={code}
      code={code}
      me={me.data}
      onDone={close}
      onOtherCode={() => router.setParams({ code: "" })}
    />
  );
};
