import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import type { User } from "@slipstream/domain";
import { useQueries } from "~/api/hooks.ts";
import { m } from "@slipstream/i18n";
import { Icon, type IconSvgElement } from "~/ui/icon.tsx";
import {
  ClockIcon,
  LaptopIcon,
  QualityIcon,
  ServerIcon,
  StorageIcon,
  UserIcon,
  UsersIcon,
} from "~/ui/icons.ts";
import { PageHeader, Wrap } from "~/ui/page.tsx";
import { cn } from "~/ui/utils.ts";
import { useLineupProblems } from "~/shell/use-shell-data.ts";
import { LoadingScope, Sk } from "~/ui/skeleton.tsx";
import { DeviceSection } from "./device-section.tsx";
import { PlaybackSection } from "./playback-section.tsx";
import { ProfileSection } from "./profile-section.tsx";
import { RecordingSection } from "./recording-section.tsx";
import {
  isHouseholdSection,
  type SettingsGroup,
  type SettingsSection,
  settingsGroups,
  settingsTitle,
} from "./sections.ts";
import { SourcesAndChannels } from "./lineup/sources-and-channels.tsx";
import { StorageSection } from "./storage-section.tsx";
import { UsersSection } from "./users-section.tsx";

const sectionIcon: Record<SettingsSection, IconSvgElement> = {
  device: LaptopIcon,
  sources: ServerIcon,
  recording: ClockIcon,
  users: UsersIcon,
  playback: QualityIcon,
  storage: StorageIcon,
  profile: UserIcon,
};

/** Every section link: a pill in the row, a full-width row of the list from 1100 px. */
const linkBase =
  "flex h-9 flex-none items-center gap-3 rounded-full px-3 text-[14px] font-semibold whitespace-nowrap coarse:h-tap lg:h-auto lg:min-h-10 lg:min-w-0 lg:rounded-[10px] lg:py-2 lg:leading-5 lg:whitespace-normal";

/** The household group's heading and its line: in the list from 1100 px, a label in the row below. */
function HouseholdHeading() {
  return (
    <div className="flex flex-none items-center pl-1.5 lg:mt-4 lg:block lg:px-3 lg:pb-1">
      <div className="text-caption font-semibold whitespace-nowrap text-fg-3 lg:text-meta lg:text-fg-2">
        {m.settings_group_server()}
      </div>
      <div className="hidden text-caption text-fg-3 lg:block">{m.settings_group_server_note()}</div>
    </div>
  );
}

/**
 * The section nav (SPEC §8.7): a 220 px list beside the content from 1100 px, a row of pills
 * that scrolls sideways below it. This device and Your profile first, then the household's
 * sections under their heading. One link per section; the current one is marked. In the list
 * a long name wraps inside the column instead of being cut off.
 */
function SectionNav({
  groups,
  current,
}: {
  groups: readonly SettingsGroup[];
  current: SettingsSection;
}) {
  const lineupProblems = useLineupProblems();
  return (
    <nav
      aria-label={m.settings_nav_label()}
      className="scroller -mx-(--gutter) gap-1.5 px-(--gutter) lg:sticky lg:top-[calc(var(--nav-h)+24px)] lg:mx-0 lg:grid lg:min-w-0 lg:gap-0.5 lg:overflow-visible lg:px-0"
    >
      {groups.flatMap((group) => [
        group.kind === "household" ? <HouseholdHeading key="household" /> : null,
        ...group.sections.map((section) => {
          const active = section === current;
          return (
            <Link
              key={section}
              to="/settings/$section"
              params={{ section }}
              aria-current={active ? "page" : undefined}
              className={cn(
                linkBase,
                active
                  ? "bg-fg text-bg lg:bg-hover lg:text-fg lg:shadow-[inset_0_0_0_1px_var(--line-2)]"
                  : "text-fg-2 shadow-[inset_0_0_0_1px_var(--line-2)] fine:hover:bg-hover fine:hover:text-fg lg:shadow-none",
              )}
            >
              <Icon
                icon={sectionIcon[section]}
                className={cn("flex-none", active ? "text-bg lg:text-brand-fg" : undefined)}
              />
              <span className="min-w-0">{settingsTitle(section)}</span>
              {section === "sources" ? (
                // Channels left without a stream; the room is kept, so a count never moves a link.
                <span
                  className="shell-count ml-auto"
                  {...(lineupProblems === 0
                    ? { "aria-hidden": true }
                    : { "aria-label": m.nav_issues({ count: lineupProblems }) })}
                >
                  {lineupProblems === 0 ? "" : lineupProblems}
                </span>
              ) : null}
            </Link>
          );
        }),
      ])}
    </nav>
  );
}

/** "Slipstream 0.1.0 · server on tvbox.local", quiet, at the end of every settings page. */
function ServerLine() {
  const queries = useQueries();
  const system = useQuery(queries.system());
  return (
    <LoadingScope
      as="span"
      loading={system.isPending}
      className="mt-2 block min-w-0 text-caption font-normal text-fg-3"
    >
      <Sk chars={34} className="block truncate">
        {system.data === undefined
          ? ""
          : m.settings_server_line({ version: system.data.version, host: window.location.host })}
      </Sk>
    </LoadingScope>
  );
}

/**
 * Settings (SPEC §8.7): the page title, the section nav and the open section. Everyone sees
 * This device and Your profile; the admin also the household's Sources & channels, Recording,
 * Users & devices, Default quality and Storage, which apply to everyone. Below 1100 px, where
 * the nav is a row of pills, a household section says so above itself.
 */
export function SettingsPage({ section, me }: { section: SettingsSection; me: User }) {
  const queries = useQueries();
  const channels = useQuery(queries.channels());
  const collections = useQuery(queries.collections());
  const groups = settingsGroups(me.role);
  const channelList = channels.data ?? [];
  const collectionList = collections.data ?? [];
  return (
    <Wrap>
      <PageHeader title={m.nav_settings()} />
      <div className="grid gap-6 pb-6 lg:grid-cols-[220px_minmax(0,1fr)] lg:items-start lg:gap-10">
        <SectionNav groups={groups} current={section} />
        <div className="min-w-0">
          {isHouseholdSection(section) ? (
            <p className="mb-4 text-meta text-fg-2 lg:hidden">{m.settings_group_server_note()}</p>
          ) : null}
          {section === "device" ? <DeviceSection /> : null}
          {section === "sources" ? <SourcesAndChannels /> : null}
          {section === "recording" ? <RecordingSection /> : null}
          {section === "users" ? (
            <UsersSection me={me} channels={channelList} collections={collectionList} />
          ) : null}
          {section === "playback" ? <PlaybackSection /> : null}
          {section === "storage" ? <StorageSection /> : null}
          {section === "profile" ? (
            <ProfileSection me={me} channels={channelList} collections={collectionList} />
          ) : null}
          <ServerLine />
        </div>
      </div>
    </Wrap>
  );
}
