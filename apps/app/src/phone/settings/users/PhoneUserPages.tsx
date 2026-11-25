import { accessNames, isRestricted, summariseAccess } from "@slipstream/domain";
import { m, profileLine } from "@slipstream/i18n";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { Text, View } from "react-native";
import { readProblem } from "../../../api/failure.ts";
import { useApiQueries } from "../../../data/hooks.ts";
import { useTheme } from "../../../theme/theme.ts";
import { BackHeader } from "../../BackHeader.tsx";
import { AdminOnly, PageStatus } from "../../ui/PageStatus.tsx";
import { InviteForm } from "./InviteForm.tsx";
import { Avatar } from "./parts.tsx";
import { ProfileForm } from "./ProfileForm.tsx";
import { FormSkeleton } from "./UsersSkeletons.tsx";

/** A form page while it loads: Back and the form's shapes. */
const PageLoading = ({ title }: { readonly title?: string | undefined }) => {
  const { colors } = useTheme();
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      {title === undefined ? <BackHeader /> : <BackHeader title={title} />}
      <FormSkeleton />
    </View>
  );
};

/** The channels and collections the access field names and offers. */
const useAccessLists = () => {
  const queries = useApiQueries();
  const channels = useQuery(queries.channels());
  const collections = useQuery(queries.collections());
  return {
    channels: channels.data ?? [],
    collections: collections.data ?? [],
    loading: channels.isPending || collections.isPending,
  };
};

/** `/settings/users/[id]`: edit a household profile, or add one (`new`). */
const PhoneProfilePageBody = ({ id }: { readonly id: string }) => {
  const router = useRouter();
  const queries = useApiQueries();
  const profiles = useQuery(queries.profiles());
  const lists = useAccessLists();
  const adding = id === "new";
  if (profiles.isError) {
    return (
      <PageStatus title={readProblem(profiles.error)} onRetry={() => void profiles.refetch()} />
    );
  }
  if (profiles.data === undefined || lists.loading) {
    return <PageLoading title={adding ? m.profiles_add() : undefined} />;
  }
  const profile = profiles.data.find((candidate) => candidate.id === id);
  if (!adding && profile === undefined) return <PageStatus title={m.error_not_found()} />;
  return (
    <ProfileForm
      profile={profile}
      channels={lists.channels}
      collections={lists.collections}
      onDone={() => router.back()}
    />
  );
};

/** `/settings/users/invite`: invite a guest by link. */
const PhoneInvitePageBody = () => {
  const router = useRouter();
  const lists = useAccessLists();
  if (lists.loading) return <PageLoading title={m.invite_title()} />;
  return (
    <InviteForm
      guest={undefined}
      channels={lists.channels}
      collections={lists.collections}
      onDone={() => router.back()}
    />
  );
};

/** `/settings/users/guest/[id]`: what a guest may see and do. */
const PhoneGuestPageBody = ({ id }: { readonly id: string }) => {
  const router = useRouter();
  const queries = useApiQueries();
  const guests = useQuery(queries.guests());
  const lists = useAccessLists();
  if (guests.isError) {
    return <PageStatus title={readProblem(guests.error)} onRetry={() => void guests.refetch()} />;
  }
  if (guests.data === undefined || lists.loading) return <PageLoading />;
  const guest = guests.data.find((candidate) => candidate.id === id);
  if (guest === undefined) return <PageStatus title={m.error_not_found()} />;
  return (
    <InviteForm
      guest={guest}
      channels={lists.channels}
      collections={lists.collections}
      onDone={() => router.back()}
    />
  );
};

/**
 * `/settings/profile`, Settings › Your profile for everyone who isn't an admin (SPEC §7.8,
 * §8.7): who they are and what they may see at the top, then their own name, picture and PIN.
 */
export const PhoneYourProfile = () => {
  const { colors, em, fonts } = useTheme();
  const router = useRouter();
  const queries = useApiQueries();
  const mine = useQuery(queries.myProfile());
  const lists = useAccessLists();
  if (mine.isError) {
    return <PageStatus title={readProblem(mine.error)} onRetry={() => void mine.refetch()} />;
  }
  if (mine.data === undefined || lists.loading) {
    return <PageLoading title={m.settings_section_profile()} />;
  }
  const profile = mine.data;
  const line = profileLine({
    admin: profile.role === "admin",
    restricted: isRestricted(profile.access),
    access: summariseAccess(profile.access, accessNames(lists.channels, lists.collections)),
    hasPin: profile.hasPin,
  });
  return (
    <ProfileForm
      profile={profile}
      title={m.settings_section_profile()}
      channels={lists.channels}
      collections={lists.collections}
      onDone={() => router.back()}
      intro={
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: em,
            paddingHorizontal: em,
            paddingTop: 0.4 * em,
            paddingBottom: 0.6 * em,
          }}
        >
          <Avatar name={profile.displayName} tone={profile.avatarTone} size={3.4 * em} />
          <View style={{ flex: 1, gap: 0.15 * em }}>
            <Text style={{ fontFamily: fonts.fUiSemiBold, fontSize: 1.25 * em, color: colors.fg }}>
              {profile.displayName}
            </Text>
            <Text style={{ fontFamily: fonts.fUi, fontSize: 0.9 * em, color: colors.fg2 }}>
              {line}
            </Text>
          </View>
        </View>
      }
    />
  );
};

/** PhoneProfilePage behind the admin gate. */
export const PhoneProfilePage = ({ id }: { readonly id: string }) => (
  <AdminOnly heading={m.settings_section_users()}>
    <PhoneProfilePageBody id={id} />
  </AdminOnly>
);

/** PhoneInvitePage behind the admin gate. */
export const PhoneInvitePage = () => (
  <AdminOnly heading={m.invite_title()}>
    <PhoneInvitePageBody />
  </AdminOnly>
);

/** PhoneGuestPage behind the admin gate. */
export const PhoneGuestPage = ({ id }: { readonly id: string }) => (
  <AdminOnly heading={m.settings_section_users()}>
    <PhoneGuestPageBody id={id} />
  </AdminOnly>
);
