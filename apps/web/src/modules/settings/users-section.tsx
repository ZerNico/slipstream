import { Avatar } from "~/ui/avatar.tsx";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import type { Guest } from "@slipstream/api";
import {
  accessNames,
  type Channel,
  type Collection,
  type Device,
  type DeviceId,
  epochMs,
  type GuestInvite,
  inviteDaysLeft,
  isRestricted,
  type Profile,
  summariseAccess,
  type User,
} from "@slipstream/domain";
import { DateTime } from "effect";
import { useRef, useState } from "react";
import { useQueries } from "~/api/hooks.ts";
import { shapes, useKept } from "~/api/shape-cache.ts";
import { useRevokeDevice } from "~/api/mutations.ts";
import { guestAccessLine, inviteLine, m, profileLine } from "@slipstream/i18n";
import { announce } from "~/ui/announce-store.ts";
import { Icon, type IconSvgElement } from "~/ui/icon.tsx";
import {
  AddIcon,
  LaptopIcon,
  LinkIcon,
  LockIcon,
  PhoneIcon,
  TabletIcon,
  TvIcon,
} from "~/ui/icons.ts";
import { useOverlay } from "~/ui/overlay/use-overlay.tsx";
import { Button } from "~/ui/primitives/button.tsx";
import { LoadingScope, Sk } from "~/ui/skeleton.tsx";
import { rememberedCount, rememberedList } from "~/ui/skeleton-state.ts";
import { toast } from "~/ui/toast-manager.ts";
import { cn } from "~/ui/utils.ts";
import { InviteDialog } from "./invite-dialog.tsx";
import { copyText } from "~/ui/clipboard.ts";
import { ListPanel, ListRow, SettingsSection } from "./parts.tsx";
import { ProfileDialog } from "./profile-dialog.tsx";
import { useRevokeInvite } from "./queries.ts";
import { SectionProblem } from "./section-problem.tsx";
import { focusAfterRender } from "~/ui/focus-after-render.ts";

const placeholderProfile = (index: number): Profile => ({
  id: `placeholder-${index}` as Profile["id"],
  displayName: "Profile",
  role: "user",
  kind: "household",
  avatarTone: "amber",
  hasPin: false,
  access: { mayRecord: true },
  createdAt: DateTime.makeUnsafe(0),
});

/** The line under a profile's name: role, what it sees, the PIN. */
const lineOf = (profile: Profile, names: ReturnType<typeof accessNames>): string =>
  profileLine({
    admin: profile.role === "admin",
    restricted: isRestricted(profile.access),
    access: summariseAccess(profile.access, names),
    hasPin: profile.hasPin,
  });

/** One household profile card: avatar, name, what it is, Edit pinned to the bottom. */
function ProfileCard({
  profile,
  me,
  line,
  onEdit,
}: {
  profile: Profile;
  me: User;
  line: string;
  onEdit: () => void;
}) {
  const you = profile.id === me.id;
  return (
    <div className="panel relative grid grid-rows-[auto_auto_minmax(2.7em,1fr)_auto] justify-items-center gap-2 px-3 pt-4.5 pb-3.5 text-center">
      <span
        className={cn("absolute top-2.5 right-2.5 text-fg-3", !profile.hasPin && "invisible")}
        aria-hidden="true"
      >
        <Icon icon={LockIcon} size={16} />
      </span>
      <span className="sk-art rounded-full">
        <Avatar name={profile.displayName} tone={profile.avatarTone} size={64} />
      </span>
      <b className="w-full text-[15px] [overflow-wrap:anywhere]">
        <Sk>{you ? m.profile_you({ name: profile.displayName }) : profile.displayName}</Sk>
      </b>
      <span className="w-full text-[12.5px] text-fg-3">
        <Sk>{line}</Sk>
      </span>
      <Button
        size="sm"
        variant="ghost"
        onClick={onEdit}
        aria-label={m.action_edit_named({ name: profile.displayName })}
      >
        {m.source_edit()}
      </Button>
    </div>
  );
}

/** The last card of the profile row: add a profile (SPEC §8.7). */
function AddProfileCard({ onAdd }: { onAdd: () => void }) {
  return (
    <button
      type="button"
      onClick={onAdd}
      className="grid content-start justify-items-center gap-2 rounded-lg px-3 pt-4.5 pb-3.5 text-center text-fg-2 fine:hover:bg-hover fine:hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
    >
      <span className="grid size-16 place-items-center rounded-full bg-hover" aria-hidden="true">
        <Icon icon={AddIcon} size={24} />
      </span>
      <b className="text-[15px] text-fg">{m.profiles_add()}</b>
    </button>
  );
}

const deviceIcon = (device: Device): IconSvgElement => {
  switch (device.kind) {
    case "tv":
      return TvIcon;
    case "phone":
      return PhoneIcon;
    case "tablet":
      return TabletIcon;
    case "web":
      return LaptopIcon;
  }
};

/**
 * One signed-in device with Revoke and its inline confirm (SPEC §7.3): Revoke moves focus to the
 * confirming Revoke; confirming leaves the row saying "Signed out" (focus moves there and it is
 * announced); Cancel returns focus to the row's Revoke.
 */
function DeviceRow({
  device,
  owner,
  revoked,
  onRevoked,
}: {
  device: Device;
  owner: string;
  revoked: boolean;
  onRevoked: (device: Device) => void;
}) {
  const revoke = useRevokeDevice();
  const [confirming, setConfirming] = useState(false);
  const revokeRef = useRef<HTMLButtonElement | null>(null);
  const statusRef = useRef<HTMLSpanElement | null>(null);
  const seen =
    device.lastSeenAt === undefined
      ? m.device_never_seen()
      : m.device_last_seen({ at: new Date(epochMs(device.lastSeenAt)) });
  const who = device.household === true ? m.profiles_everyone() : owner;
  return (
    <ListRow
      lead={<Icon icon={deviceIcon(device)} size={20} className="flex-none text-fg-3" />}
      title={<Sk>{device.name}</Sk>}
      sub={<Sk>{`${who} · ${seen}`}</Sk>}
      stackOnPhone={confirming}
      end={
        revoked ? (
          <span ref={statusRef} tabIndex={-1} className="text-meta font-semibold text-fg-3">
            {m.device_signed_out()}
          </span>
        ) : confirming ? (
          <span className="flex items-center gap-2 max-sm:w-full max-sm:justify-end">
            <span className="text-meta text-fg-2 max-sm:mr-auto">{m.device_revoke_question()}</span>
            <Button
              size="sm"
              variant="danger"
              autoFocus
              busy={revoke.isPending}
              onClick={() =>
                revoke.mutate(device.id, {
                  onSuccess: () => {
                    onRevoked(device);
                    announce(m.device_signed_out_named({ name: device.name }));
                    focusAfterRender(statusRef);
                  },
                  onError: () => toast({ title: m.state_not_saved(), type: "error" }),
                })
              }
            >
              {m.action_revoke()}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setConfirming(false);
                focusAfterRender(revokeRef);
              }}
            >
              {m.action_cancel()}
            </Button>
          </span>
        ) : (
          <Button
            ref={revokeRef}
            size="sm"
            variant="ghost"
            aria-label={m.device_revoke_confirm({ name: device.name })}
            onClick={() => setConfirming(true)}
          >
            {m.action_revoke()}
          </Button>
        )
      }
    />
  );
}

/** A guest row: who, last seen and from where, what they may see and do, Edit. */
function GuestRow({
  guest,
  names,
  onEdit,
}: {
  guest: Guest;
  names: ReturnType<typeof accessNames>;
  onEdit: () => void;
}) {
  const summary = summariseAccess(guest.access, names);
  const seen =
    guest.lastSeenAt === undefined
      ? m.guest_never_seen()
      : m.guest_last_seen({
          at: new Date(epochMs(guest.lastSeenAt)),
          away: guest.lastSeenFrom === "away",
        });
  return (
    <ListRow
      lead={<Avatar name={guest.displayName} tone={guest.avatarTone} size={40} />}
      title={<Sk>{guest.displayName}</Sk>}
      sub={<Sk>{`${m.account_kind_guest()} · ${seen}`}</Sk>}
      extra={<div className="text-meta text-fg-3">{guestAccessLine(summary)}</div>}
      end={
        <Button
          size="sm"
          variant="ghost"
          onClick={onEdit}
          aria-label={m.guest_access_title({ name: guest.displayName })}
        >
          {m.source_edit()}
        </Button>
      }
    />
  );
}

/** A pending invite: for whom, how long it is valid, what it grants; Copy link and Revoke. */
function InviteRow({
  invite,
  names,
  now,
}: {
  invite: GuestInvite;
  names: ReturnType<typeof accessNames>;
  now: number;
}) {
  const revoke = useRevokeInvite();
  const summary = summariseAccess(invite.access, names);
  const line = inviteLine({
    daysLeft: inviteDaysLeft(
      invite.expiresAt === undefined ? undefined : epochMs(invite.expiresAt),
      now,
    ),
    access: summary,
  });
  return (
    <ListRow
      pending
      stackOnPhone
      title={m.invite_for({ name: invite.name })}
      sub={line}
      end={
        <span className="flex gap-1">
          <Button
            size="sm"
            variant="ghost"
            onClick={() =>
              void copyText(invite.url).then((copied) =>
                toast({ title: copied ? m.invite_copied() : m.invite_copy_failed() }),
              )
            }
          >
            {m.invite_copy()}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            busy={revoke.isPending}
            aria-label={m.invite_revoke_named({ name: invite.name })}
            onClick={() =>
              revoke.mutate(invite.id, {
                onSuccess: () => {
                  toast({ title: m.invite_revoked(), alreadyAnnounced: true });
                  announce(m.invite_revoked());
                },
                onError: () => toast({ title: m.state_not_saved(), type: "error" }),
              })
            }
          >
            {m.action_revoke()}
          </Button>
        </span>
      }
    />
  );
}

/**
 * Settings › Users & devices (SPEC §7.8, §8.7): household profiles (Add profile is the last
 * card), guests and pending invites, signed-in devices with revoke, sign-in methods.
 */
export function UsersSection({
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
  const profiles = useQuery(queries.profiles());
  const guests = useQuery(queries.guests());
  const invites = useQuery(queries.invites());
  const devices = useQuery(queries.devices());
  const [revoked, setRevoked] = useState<ReadonlyMap<DeviceId, Device>>(new Map());
  const [now] = useState(() => Date.now());
  const names = accessNames(channels, collections);
  const keptProfiles = useKept(shapes.profiles);

  if (profiles.isError) {
    return <SectionProblem error={profiles.error} />;
  }
  // While loading: the profiles this browser saw last (the account menu keeps them); before
  // any load, a new household's shape: one profile, no guests, no linked devices.
  const profileList = rememberedList(
    "settings.profiles",
    profiles.data ?? keptProfiles,
    1,
    placeholderProfile,
  );
  const guestList = guests.data ?? [];
  const inviteList = invites.data ?? [];
  // How many guest rows (guests and invites) this browser saw last: none means the empty line.
  const guestRows = rememberedCount(
    "settings.guests",
    guests.data === undefined || invites.data === undefined
      ? undefined
      : guestList.length + inviteList.length,
    0,
  );
  const ownerName = (id: Device["userId"]) =>
    [...(profiles.data ?? []), ...guestList].find((profile) => profile.id === id)?.displayName ??
    (id === me.id ? me.displayName : m.device_unknown_owner());
  const deviceList = [
    ...(devices.data ?? []),
    ...[...revoked.values()].filter(
      (device) => !(devices.data ?? []).some((item) => item.id === device.id),
    ),
  ].toSorted((a, b) => epochMs(b.createdAt) - epochMs(a.createdAt));

  return (
    <>
      <LoadingScope loading={profiles.isPending}>
        <SettingsSection title={m.profiles_section_title()}>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3 lg:grid-cols-4">
            {profileList.map((profile) => (
              <ProfileCard
                key={profile.id}
                profile={profile}
                me={me}
                line={lineOf(profile, names)}
                onEdit={() => overlay.open({ kind: "dlg", name: "profile", arg: profile.id })}
              />
            ))}
            <AddProfileCard
              onAdd={() => overlay.open({ kind: "dlg", name: "profile", arg: "new" })}
            />
          </div>
        </SettingsSection>
      </LoadingScope>
      <LoadingScope loading={guests.isPending || invites.isPending}>
        <SettingsSection
          title={m.guests_title()}
          action={
            <Button
              size="sm"
              variant="ghost"
              icon={<Icon icon={LinkIcon} />}
              onClick={() => overlay.open({ kind: "dlg", name: "invite" })}
            >
              {m.invite_title()}
            </Button>
          }
        >
          {guests.isError ? (
            <SectionProblem error={guests.error} />
          ) : guestList.length === 0 &&
            inviteList.length === 0 &&
            (!guests.isPending || guestRows === 0) ? (
            <p className="panel px-4.5 py-4 text-[14px] text-fg-2">
              <Sk>{m.guests_empty()}</Sk>
            </p>
          ) : (
            <ListPanel>
              {guests.isPending ? (
                <>
                  <ListRow
                    lead={<span className="sk-art size-10 rounded-full" />}
                    title={<Sk chars={8} />}
                    sub={<Sk chars={40} />}
                    extra={
                      <div className="mt-1 flex h-5.5 items-center">
                        <Sk chars={36} />
                      </div>
                    }
                  />
                  <ListRow
                    lead={<span className="sk-art size-10 rounded-md" />}
                    title={<Sk chars={14} />}
                    sub={<Sk chars={56} />}
                  />
                </>
              ) : null}
              {guestList.map((guest) => (
                <GuestRow
                  key={guest.id}
                  guest={guest}
                  names={names}
                  onEdit={() => overlay.open({ kind: "dlg", name: "invite", arg: guest.id })}
                />
              ))}
              {inviteList.map((invite) => (
                <InviteRow key={invite.id} invite={invite} names={names} now={now} />
              ))}
            </ListPanel>
          )}
        </SettingsSection>
      </LoadingScope>
      <LoadingScope loading={devices.isPending}>
        <SettingsSection
          title={m.devices_heading()}
          action={
            <Button
              size="sm"
              variant="ghost"
              icon={<Icon icon={TvIcon} />}
              nativeButton={false}
              render={<Link to="/link" />}
            >
              {m.device_link_tv()}
            </Button>
          }
        >
          {devices.isError ? (
            <SectionProblem error={devices.error} />
          ) : deviceList.length === 0 &&
            (!devices.isPending || rememberedCount("settings.devices", undefined, 0) === 0) ? (
            <p className="panel px-4.5 py-4 text-[14px] text-fg-2">
              <Sk>{m.devices_empty()}</Sk>
            </p>
          ) : (
            <ListPanel>
              {rememberedList(
                "settings.devices",
                devices.isPending ? undefined : deviceList,
                0,
                (index): Device => ({
                  id: `placeholder-${index}` as DeviceId,
                  userId: me.id,
                  name: "Device name",
                  kind: "web",
                  createdAt: DateTime.makeUnsafe(0),
                }),
              ).map((device) => (
                <DeviceRow
                  key={device.id}
                  device={device}
                  owner={ownerName(device.userId)}
                  revoked={revoked.has(device.id)}
                  onRevoked={(gone) => setRevoked((before) => new Map(before).set(gone.id, gone))}
                />
              ))}
            </ListPanel>
          )}
        </SettingsSection>
      </LoadingScope>
      <ProfileDialog
        profiles={profiles.data ?? []}
        me={me}
        channels={channels}
        collections={collections}
      />
      <InviteDialog guests={guestList} channels={channels} collections={collections} />
    </>
  );
}
