import { useAvatarTones } from "~/api/hooks.ts";
import type { RecordingEntry } from "@slipstream/api";
import { type Channel, channelMark, epochMs, type Profile } from "@slipstream/domain";
import { type CSSProperties, type KeyboardEvent, useRef } from "react";
import { m } from "@slipstream/i18n";

import { ChannelLogo } from "~/ui/artwork/artwork.tsx";
import { Avatar } from "~/ui/avatar.tsx";
import { Wrap } from "~/ui/page.tsx";
import { Sk } from "~/ui/skeleton.tsx";
import { heroPanelId, itemTitle, ownerName } from "./hero-view.ts";
import { channelOf } from "./present.ts";

/**
 * Parallel recordings with equal standing (SPEC §8.1, HeroSwitcher): "Recording now · 2" and one
 * equal tab per recording with its channel, title, owner, start and live progress. A tablist:
 * ←/→ (and Home/End) move and select, nothing rotates on its own. Under 600 px the label sits
 * above and the tabs share the width; from four tabs the row scrolls.
 */
export function HeroSwitcher({
  items,
  selected,
  onSelect,
  channels,
  profiles,
  now,
}: {
  items: readonly RecordingEntry[];
  selected: number;
  onSelect: (index: number) => void;
  channels: readonly Channel[];
  profiles: readonly Pick<Profile, "id" | "displayName">[];
  now: number;
}) {
  const toneOf = useAvatarTones();
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const move = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const last = items.length - 1;
    const next =
      event.key === "ArrowRight"
        ? index === last
          ? 0
          : index + 1
        : event.key === "ArrowLeft"
          ? index === 0
            ? last
            : index - 1
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? last
              : undefined;
    if (next === undefined) return;
    event.preventDefault();
    onSelect(next);
    tabs.current[next]?.focus();
  };
  return (
    <Wrap>
      <div data-hero-switcher="" data-many={items.length > 3 ? "" : undefined}>
        <span data-hero-switcher-label="" className="sk-hide">
          <span data-hero-live-dot="" aria-hidden="true" />
          {m.home_switcher_label({ count: items.length })}
        </span>
        <div
          role="tablist"
          aria-label={m.recordings_recording_now()}
          data-hero-tabs=""
          style={{ "--tabs": Math.min(items.length, 3) } as CSSProperties}
        >
          {items.map((entry, index) => {
            const channel = channelOf(channels, entry.channelId);
            const owner = ownerName(entry, profiles);
            const title = itemTitle(entry);
            const start = new Date(epochMs(entry.start));
            const span = epochMs(entry.end) - epochMs(entry.start);
            const progress =
              span > 0 ? Math.min(1, Math.max(0, (now - epochMs(entry.start)) / span)) : 0;
            const isSelected = index === selected;
            return (
              <button
                key={entry.id}
                ref={(node) => {
                  tabs.current[index] = node;
                }}
                type="button"
                role="tab"
                id={`home-hero-tab-${entry.id}`}
                aria-selected={isSelected}
                aria-controls={heroPanelId}
                tabIndex={isSelected ? 0 : -1}
                aria-label={m.home_switcher_tab({
                  title,
                  channel: channel?.name ?? "",
                  start,
                  owner,
                })}
                data-hero-tab=""
                data-sk-neutral=""
                onClick={() => onSelect(index)}
                onKeyDown={(event) => move(event, index)}
              >
                <ChannelLogo
                  mark={channelMark(channel?.name ?? entry.title)}
                  size="sm"
                  {...(channel?.logoUrl ? { logoUrl: channel.logoUrl } : {})}
                />
                <b data-hero-tab-title="">
                  <Sk placeholder={title}>{title}</Sk>
                </b>
                <span data-hero-tab-meta="">
                  {owner === "" ? null : (
                    <span data-hero-tab-owner="" className="sk-hide">
                      <Avatar name={owner} tone={toneOf(entry.ownerIds[0])} size={16} />
                      <span data-hero-tab-owner-name="">{owner}</span>
                    </span>
                  )}
                  <Sk>{m.home_switcher_since({ start })}</Sk>
                  <span data-hero-tab-progress="" className="sk-hide" aria-hidden="true">
                    <i style={{ width: `${Math.round(progress * 100)}%` }} />
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </Wrap>
  );
}
