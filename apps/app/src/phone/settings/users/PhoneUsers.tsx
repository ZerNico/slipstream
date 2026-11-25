import {
  accessNames,
  epochMs,
  type GuestInvite,
  inviteDaysLeft,
  isRestricted,
  type Profile,
  summariseAccess,
} from "@slipstream/domain";
import { guestAccessLine, inviteLine, m, profileLine } from "@slipstream/i18n";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { readProblem } from "../../../api/failure.ts";
import { useApiQueries } from "../../../data/hooks.ts";
import { useSession } from "../../../session/session-context.ts";
import { useTheme } from "../../../theme/theme.ts";
import { FocusButton } from "../../../ui/FocusButton.tsx";
import { Icon } from "../../../ui/Icon.tsx";
import { useNow } from "../../../ui/use-now.ts";
import { BackHeader } from "../../BackHeader.tsx";
import { AdminOnly, PageStatus } from "../../ui/PageStatus.tsx";
import { InviteSheet } from "./InviteSheet.tsx";
import { Avatar, PanelHeading, PanelRow, RowGlyph } from "./parts.tsx";
import { Hairline, Panel } from "../../ui/settings.tsx";
import { UsersSkeleton } from "./UsersSkeletons.tsx";
import { guestHref, inviteHref, newProfileHref, profileHref } from "../../../routes.ts";

/** The end of a row that opens a page: the lock when it has a PIN, then the chevron. */
const RowEnd = ({ locked }: { readonly locked: boolean }) => {
  const { colors, em } = useTheme();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 0.4 * em }}>
      {locked ? <Icon name="lock" size={em} color={colors.fg3} /> : null}
      <View style={{ transform: [{ rotate: "180deg" }] }}>
        <Icon name="chevronLeft" size={1.1 * em} color={colors.fg3} />
      </View>
    </View>
  );
};

/**
 * Settings › Users & devices on a phone (SPEC §7.8, §8.7): the household's profiles with their
 * role, what they see and their PIN, Add profile last; then guests and pending invites, with
 * Invite a guest. A profile or guest opens its own page; an invite opens a sheet to share or
 * revoke it.
 */
const PhoneUsersPage = () => {
  const { colors, em, fonts } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { account, stored } = useSession();
  const now = useNow(60_000);
  const queries = useApiQueries();
  const profiles = useQuery(queries.profiles());
  const guests = useQuery(queries.guests());
  const invites = useQuery(queries.invites());
  const channels = useQuery(queries.channels());
  const collections = useQuery(queries.collections());
  const [open, setOpen] = useState<GuestInvite | undefined>(undefined);
  const names = accessNames(channels.data ?? [], collections.data ?? []);

  if (profiles.isError) {
    return (
      <PageStatus
        heading={m.settings_section_users()}
        title={readProblem(profiles.error)}
        onRetry={() => void profiles.refetch()}
      />
    );
  }
  const header = (
    <BackHeader
      title={m.settings_section_users()}
      action={
        <FocusButton
          label={m.invite_title()}
          icon="plus"
          size={0.85}
          onPress={() => router.push(inviteHref)}
        />
      }
    />
  );
  if (profiles.data === undefined || guests.isPending || invites.isPending) {
    // The profiles signed in on this phone are the best guess of how many rows will come.
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg }}>
        {header}
        <UsersSkeleton profiles={Math.max(1, stored.accounts.length)} />
      </View>
    );
  }

  const lineOf = (profile: Profile) =>
    profileLine({
      admin: profile.role === "admin",
      restricted: isRestricted(profile.access),
      access: summariseAccess(profile.access, names),
      hasPin: profile.hasPin,
    });
  const inviteLineOf = (invite: GuestInvite) =>
    inviteLine({
      daysLeft: inviteDaysLeft(
        invite.expiresAt === undefined ? undefined : epochMs(invite.expiresAt),
        now,
      ),
      access: summariseAccess(invite.access, names),
    });
  const guestList = guests.data ?? [];
  const inviteList = invites.data ?? [];

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      {header}
      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 2 * em }}>
        <PanelHeading title={m.profiles_section_title()} />
        <Panel>
          {profiles.data.map((profile) => (
            <View key={profile.id}>
              <PanelRow
                lead={
                  <Avatar name={profile.displayName} tone={profile.avatarTone} size={2.6 * em} />
                }
                title={
                  profile.id === account?.userId
                    ? m.profile_you({ name: profile.displayName })
                    : profile.displayName
                }
                sub={lineOf(profile)}
                label={m.action_edit_named({ name: profile.displayName })}
                end={<RowEnd locked={profile.hasPin} />}
                onPress={() => router.push(profileHref(profile.id))}
              />
              <Hairline />
            </View>
          ))}
          <PanelRow
            lead={
              <View
                style={{
                  width: 2.6 * em,
                  height: 2.6 * em,
                  borderRadius: 1.3 * em,
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: colors.raised,
                }}
              >
                <RowGlyph name="plus" />
              </View>
            }
            title={m.profiles_add()}
            onPress={() => router.push(newProfileHref)}
          />
        </Panel>
        <PanelHeading title={m.guests_title()} />
        <Panel>
          {guests.isError ? (
            <PanelRow
              title={readProblem(guests.error)}
              sub={m.action_try_again()}
              onPress={() => {
                void guests.refetch();
                void invites.refetch();
              }}
            />
          ) : guestList.length === 0 && inviteList.length === 0 ? (
            <Text
              style={{
                fontFamily: fonts.fUi,
                fontSize: 0.95 * em,
                color: colors.fg2,
                paddingHorizontal: em,
                paddingVertical: 1.05 * em,
              }}
            >
              {m.guests_empty()}
            </Text>
          ) : (
            <>
              {guestList.map((guest, index) => (
                <View key={guest.id}>
                  {index === 0 ? null : <Hairline />}
                  <PanelRow
                    lead={
                      <Avatar name={guest.displayName} tone={guest.avatarTone} size={2.6 * em} />
                    }
                    title={guest.displayName}
                    sub={`${m.account_kind_guest()} · ${
                      guest.lastSeenAt === undefined
                        ? m.guest_never_seen()
                        : m.guest_last_seen({
                            at: new Date(epochMs(guest.lastSeenAt)),
                            away: guest.lastSeenFrom === "away",
                          })
                    }`}
                    extra={guestAccessLine(summariseAccess(guest.access, names))}
                    label={m.guest_access_title({ name: guest.displayName })}
                    end={<RowEnd locked={false} />}
                    onPress={() => router.push(guestHref(guest.id))}
                  />
                </View>
              ))}
              {inviteList.map((invite, index) => (
                <View key={invite.id}>
                  {index === 0 && guestList.length === 0 ? null : <Hairline />}
                  <PanelRow
                    lead={
                      <View
                        style={{
                          width: 2.6 * em,
                          height: 2.6 * em,
                          borderRadius: 1.3 * em,
                          alignItems: "center",
                          justifyContent: "center",
                          borderWidth: 1,
                          borderStyle: "dashed",
                          borderColor: colors.brand,
                        }}
                      >
                        <RowGlyph name="user" />
                      </View>
                    }
                    title={m.invite_for({ name: invite.name })}
                    sub={inviteLineOf(invite)}
                    end={<Icon name="more" size={1.2 * em} color={colors.fg3} />}
                    onPress={() => setOpen(invite)}
                  />
                </View>
              ))}
            </>
          )}
        </Panel>
      </ScrollView>
      {open === undefined ? null : (
        <InviteSheet invite={open} line={inviteLineOf(open)} onClose={() => setOpen(undefined)} />
      )}
    </View>
  );
};

/** PhoneUsers behind the admin gate. */
export const PhoneUsers = () => (
  <AdminOnly heading={m.settings_section_users()}>
    <PhoneUsersPage />
  </AdminOnly>
);
