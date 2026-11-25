import { Link } from "@tanstack/react-router";
import type { MouseEvent, ReactNode } from "react";
import { isNew, isRecorded, MINUTE, recordingGapSummary } from "@slipstream/domain";
import { formatClock } from "~/i18n/formats.ts";
import { dayPill, m } from "@slipstream/i18n";
import { Artwork } from "~/ui/artwork/artwork.tsx";
import { Badge } from "~/ui/controls.tsx";
import { MediaCard } from "~/ui/media-row.tsx";
import { useOverlay } from "~/ui/overlay/use-overlay.tsx";
import { channelLabel, entrySubject } from "./art.ts";
import { recordedSpan, resumeMillis, type Entry } from "./library.ts";
import type { LibraryData } from "./queries.ts";

/** Less missing than this stays off the card: "0 min missing" would only alarm. */
const cardMissingFromMs = MINUTE;

/**
 * The badge on a card's art: Rec while it records, Failed. An incomplete recording says what is
 * missing under its title instead ("44 min missing"), quietly.
 */
function StateBadge({ entry }: { entry: Entry }) {
  switch (entry.state) {
    case "recording":
      return <Badge tone="live">{m.status_rec()}</Badge>;
    case "failed":
      return <Badge tone="live">{m.library_badge_failed()}</Badge>;
    case "incomplete":
    case "scheduled":
    case "completed":
    case "cancelled":
      return null;
  }
}

/**
 * A recording as a card (SPEC §4 MediaCard, §7.6): anything that already started (running, or
 * started by this profile) opens the watch choice instead of guessing; a failed recording opens
 * its detail; everything else plays from the start. Progress: red live share while recording,
 * amber watched share once started.
 */
export function RecordingCard({
  entry,
  data,
  now,
  title,
  sub,
  className,
}: {
  entry: Entry;
  data: LibraryData;
  now: number;
  /** The card title; the recording's title by default (the item name inside a group). */
  title?: string;
  /** The line under the title; channel and day by default. */
  sub?: string;
  className?: string;
}) {
  const overlay = useOverlay();
  const channel = data.channel(entry.channelId);
  const span = recordedSpan(entry);
  const length = span.end - span.start;
  const position = resumeMillis(entry);
  const live = entry.state === "recording";
  const choice = live || position !== undefined;
  const progress = live
    ? (now - span.start) / length
    : position === undefined
      ? undefined
      : position / length;
  const by =
    entry.ruleId === undefined
      ? (data.person(entry.ownerIds[0]) ?? m.recordings_by_hand())
      : m.library_by_series();
  const subtitle =
    sub ??
    (live
      ? m.library_card_since({
          channel: channelLabel(channel),
          clock: formatClock(span.start),
          by,
        })
      : m.library_card_day({
          channel: channelLabel(channel),
          day: dayPill(span.start, now, data.timeZone),
        }));
  const missing = entry.state === "incomplete" ? recordingGapSummary(entry).missingMs : undefined;
  const line =
    missing === undefined || missing < cardMissingFromMs
      ? subtitle
      : `${subtitle} · ${m.library_card_missing({ seconds: Math.round(missing / 1000) })}`;
  const label = live ? m.library_card_recording({ title: entry.title }) : entry.title;
  const onChoice = (event: MouseEvent) => {
    if (!choice) return;
    event.preventDefault();
    overlay.open({ kind: "choice", name: entry.id });
  };
  const badge = <StateBadge entry={entry} />;
  return (
    <MediaCard
      {...(className === undefined ? {} : { className })}
      art={<Artwork subject={entrySubject(entry, channel)} />}
      title={title ?? entry.title}
      subtitle={line}
      badges={isRecorded(entry) ? undefined : badge}
      progress={progress}
      live={live}
      isNew={isNew(entry)}
      render={({ className: cardClass, children }: { className: string; children: ReactNode }) =>
        entry.state === "failed" ? (
          <Link
            to="/recordings/r/$id"
            params={{ id: entry.id }}
            className={cardClass}
            aria-label={label}
          >
            {children}
          </Link>
        ) : (
          <Link
            to="/watch/rec/$id"
            params={{ id: entry.id }}
            search={{ at: "start" }}
            className={cardClass}
            aria-label={label}
            onClick={onChoice}
          >
            {children}
          </Link>
        )
      }
    />
  );
}
