import type { ReactNode } from "react";
import {
  type Channel,
  channelMark,
  type Programme,
  type RecordSheetState,
} from "@slipstream/domain";
import { m } from "@slipstream/i18n";
import { ChannelLogo } from "~/ui/artwork/artwork.tsx";
import { Badge } from "~/ui/controls.tsx";

/**
 * The one badge a sheet shows, the state that matters most: Recording, Conflict, Live now,
 * Scheduled. What the viewer already has is said in the status box below, not as a badge.
 */
const badgesFor = (state: RecordSheetState, live: boolean): ReactNode[] => {
  if (state.kind === "recording") {
    return [
      <Badge key="rec" tone="rec">
        {m.status_recording()}
      </Badge>,
    ];
  }
  if (state.kind === "scheduled" && state.conflict) {
    return [
      <Badge key="conf" tone="warn">
        {m.status_conflict()}
      </Badge>,
    ];
  }
  if (live) {
    return [
      <Badge key="live" tone="live">
        {m.guide_badge_live_now()}
      </Badge>,
    ];
  }
  if (state.kind === "scheduled") {
    return [
      <Badge key="sched" tone="sched">
        {m.status_scheduled()}
      </Badge>,
    ];
  }
  return [];
};

/**
 * The top of the sheet's body: the badge row, the title and sub-title, and the facts line with
 * the channel's logo. The badge row is always laid out, empty or not, so Record finishing (a
 * Scheduled badge arriving) never makes the sheet grow (SPEC §6: no layout shifts).
 */
export function SheetHeader({
  programme,
  channel,
  state,
  live,
  facts,
}: {
  programme: Programme;
  channel: Channel | undefined;
  /** Undefined while loading: no badges yet, the row still holds its place. */
  state: RecordSheetState | undefined;
  live: boolean;
  facts: string;
}) {
  const badges = state === undefined ? [] : badgesFor(state, live);
  return (
    <>
      <div className="flex min-h-[22px] flex-wrap gap-1.5" data-sheet-badges="">
        {badges}
      </div>
      <div>
        <h2 className="line-clamp-2 type-h2 text-[24px] tracking-[-0.03em] wrap-break-word short:text-[20px]">
          {programme.title}
        </h2>
        {programme.subtitle ? (
          <div className="mt-1 text-fg-2 wrap-break-word">{programme.subtitle}</div>
        ) : null}
      </div>
      <p
        className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-x-2.5 text-[13.5px] leading-6 text-fg-2"
        data-half=""
        data-sheet-facts=""
      >
        <ChannelLogo
          mark={channelMark(channel?.name ?? "")}
          size="sm"
          {...(channel?.logoUrl ? { logoUrl: channel.logoUrl } : {})}
        />
        <span className="wrap-break-word">{facts}</span>
      </p>
    </>
  );
}
