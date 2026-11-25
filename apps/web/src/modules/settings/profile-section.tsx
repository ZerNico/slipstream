import { Avatar } from "~/ui/avatar.tsx";
import { useQuery } from "@tanstack/react-query";
import {
  accessNames,
  type Channel,
  type Collection,
  isRestricted,
  summariseAccess,
  type User,
} from "@slipstream/domain";
import { m, profileLine } from "@slipstream/i18n";
import { useOverlay } from "~/ui/overlay/use-overlay.tsx";
import { Button } from "~/ui/primitives/button.tsx";
import { LoadingScope, Sk } from "~/ui/skeleton.tsx";
import { ListPanel, ListRow, SettingsSection } from "./parts.tsx";
import { ProfileDialog } from "./profile-dialog.tsx";
import { useQueries } from "~/api/hooks.ts";

/**
 * Settings › Your profile (SPEC §7.8, §8.7): the signed-in profile's name, picture and PIN.
 * The theme and the language belong to the device (This device).
 */
export function ProfileSection({
  me,
  channels,
  collections,
}: {
  me: User;
  channels: readonly Channel[];
  collections: readonly Collection[];
}) {
  const queries = useQueries();
  const overlay = useOverlay();
  const mine = useQuery(queries.myProfile());
  const names = accessNames(channels, collections);
  const profile = mine.data;
  // The same line Users & devices writes under this profile; until it loads, the role alone.
  const line =
    profile === undefined
      ? me.role === "admin"
        ? m.profile_admin()
        : m.account_kind_household()
      : profileLine({
          admin: me.role === "admin",
          restricted: isRestricted(profile.access),
          access: summariseAccess(profile.access, names),
          hasPin: profile.hasPin,
        });

  return (
    <LoadingScope loading={mine.isPending && !mine.isError}>
      <SettingsSection title={m.settings_section_profile()}>
        <ListPanel>
          <ListRow
            lead={
              <span className="sk-art rounded-full">
                <Avatar name={me.displayName} tone={profile?.avatarTone ?? "amber"} size={40} />
              </span>
            }
            title={<Sk>{me.displayName}</Sk>}
            sub={<Sk>{line}</Sk>}
            end={
              <Button
                size="sm"
                variant="ghost"
                disabled={profile === undefined}
                onClick={() => overlay.open({ kind: "dlg", name: "profile", arg: me.id })}
              >
                {m.source_edit()}
              </Button>
            }
          />
        </ListPanel>
      </SettingsSection>
      <ProfileDialog
        profiles={profile === undefined ? [] : [profile]}
        me={me}
        channels={channels}
        collections={collections}
      />
    </LoadingScope>
  );
}
