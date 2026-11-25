import { m } from "@slipstream/i18n";
import type { Profile } from "@slipstream/domain";
import { skipToken, useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useDerivedValue,
  withTiming,
} from "react-native-reanimated";
import { queryKeys } from "../api/keys.ts";
import { apiQueries } from "../api/queries.ts";
import {
  profileNeedsPin,
  profilesInOrder,
  profilesNotHere,
  type StoredAccount,
} from "../session/accounts.ts";
import { useSession } from "../session/session-context.ts";
import { useTheme } from "../theme/theme.ts";
import { Icon } from "../ui/Icon.tsx";
import { PinEntry } from "./PinEntry.tsx";

/** One picture-like profile item: ring with a gap and a slight lift on focus, no fill. */
const ProfileCard = ({
  label,
  detail,
  initial,
  preferredFocus = false,
  locked = false,
  away = false,
  onPress,
}: {
  readonly label: string;
  readonly detail: string;
  readonly initial: string | undefined;
  readonly preferredFocus?: boolean;
  /** Picking it asks for its PIN first: a small lock beside the name. */
  readonly locked?: boolean;
  /** Not signed in on this device yet: drawn quieter, and choosing it starts a sign-in. */
  readonly away?: boolean;
  readonly onPress: () => void;
}) => {
  const { colors, em, fonts, motion } = useTheme();
  const [focused, setFocused] = useState(false);
  const lift = useDerivedValue(() =>
    withTiming(focused ? 1 : 0, {
      duration: motion.tFocus,
      easing: Easing.bezier(...motion.easing),
    }),
  );
  const scale = motion.cardFocusScale;
  const style = useAnimatedStyle(() => ({ transform: [{ scale: 1 + lift.value * (scale - 1) }] }));
  const avatar = 8 * em;
  return (
    <Pressable
      onPress={onPress}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      hasTVPreferredFocus={preferredFocus}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={{ alignItems: "center", gap: 0.6 * em, width: 10 * em }}
    >
      <Animated.View
        style={[
          {
            padding: 0.25 * em,
            borderRadius: avatar,
            borderWidth: 0.2 * em,
            borderColor: focused ? colors.brand : "transparent",
          },
          style,
        ]}
      >
        <View
          style={{
            width: avatar,
            height: avatar,
            borderRadius: avatar / 2,
            backgroundColor: away ? colors.surface : colors.raised,
            borderWidth: away ? 1 : 0,
            borderColor: colors.line,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {initial === undefined ? (
            <Icon name="plus" size={3 * em} color={colors.fg2} />
          ) : (
            <Text
              style={{
                fontFamily: fonts.fDisplay,
                fontSize: 3.6 * em,
                color: away ? colors.fg3 : colors.fg,
              }}
            >
              {initial}
            </Text>
          )}
        </View>
      </Animated.View>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 0.35 * em }}>
        {locked ? <Icon name="lock" size={em} color={colors.fg3} /> : null}
        <Text
          style={{
            fontFamily: fonts.fUiSemiBold,
            fontSize: 1.2 * em,
            color: focused ? colors.fg : colors.fg2,
          }}
        >
          {label}
        </Text>
      </View>
      <Text style={{ fontFamily: fonts.fUi, fontSize: em, color: colors.fg3 }}>{detail}</Text>
    </Pressable>
  );
};

const detailFor = (profile: { readonly role: Profile["role"] }): string =>
  profile.role === "admin" ? m.profile_admin() : m.account_kind_household();

/**
 * The household from the server, read with the profile used last on this device. Keeps names,
 * roles and deleted accounts of the stored profiles in line with it.
 */
const useHousehold = (): readonly Profile[] => {
  const { householdRuntime, syncHousehold } = useSession();
  const household = useQuery(
    householdRuntime === undefined
      ? { queryKey: queryKeys.profiles, queryFn: skipToken }
      : apiQueries(householdRuntime).profiles(),
  );
  useEffect(() => {
    if (household.data !== undefined) syncHousehold(household.data);
  }, [household.data, syncHousehold]);
  return household.data ?? [];
};

/**
 * "Who's watching?" (design doc "TV · Profile picker"): every profile signed in on this TV,
 * the one used last first and focused. When an admin has signed in here, the rest of the
 * household follows, quieter, and "Add profile" closes the row; both start another device-code
 * sign-in, which the admin's phone approves as the chosen profile. A profile with a PIN asks
 * for it first (PLAN §287), and only a PIN the server accepted switches to it.
 */
export const ProfilePicker = () => {
  const { colors, em, fonts } = useTheme();
  const { stored, pickProfile, addProfile } = useSession();
  const household = useHousehold();
  const [locked, setLocked] = useState<StoredAccount | undefined>(undefined);
  const backToPicker = useCallback(() => setLocked(undefined), []);
  const profiles = profilesInOrder(stored);
  const anyAdmin = profiles.some((account) => account.role === "admin");
  const away = anyAdmin ? profilesNotHere(stored, household) : [];
  // The profile may have left this device (signed out) while its PIN was asked for.
  const asking = profiles.find((account) => account.userId === locked?.userId);
  if (asking !== undefined) {
    return <PinEntry userId={asking.userId} name={asking.displayName} onCancel={backToPicker} />;
  }
  return (
    <View
      style={[
        StyleSheet.absoluteFill,
        { backgroundColor: colors.bg, alignItems: "center", justifyContent: "center", gap: 3 * em },
      ]}
    >
      <Text style={{ fontFamily: fonts.fDisplay, fontSize: 3.6 * em, color: colors.fg }}>
        {m.profiles_title().toUpperCase()}
      </Text>
      <View
        style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: 2 * em }}
      >
        {profiles.map((account, index) => (
          <ProfileCard
            key={account.userId}
            label={account.displayName}
            detail={detailFor(account)}
            initial={account.displayName.charAt(0).toUpperCase()}
            preferredFocus={index === 0}
            locked={profileNeedsPin(account, household)}
            onPress={() => {
              // The fresh household decides: a PIN set since this device last looked still asks.
              if (pickProfile(account.userId, household) === "NeedsPin") setLocked(account);
            }}
          />
        ))}
        {away.map((profile) => (
          <ProfileCard
            key={profile.id}
            label={profile.displayName}
            detail={detailFor(profile)}
            initial={profile.displayName.charAt(0).toUpperCase()}
            away
            onPress={addProfile}
          />
        ))}
        {anyAdmin ? (
          <ProfileCard
            label={m.profiles_add()}
            detail={m.profiles_admins_only()}
            initial={undefined}
            onPress={addProfile}
          />
        ) : null}
      </View>
    </View>
  );
};
