import { Link } from "@tanstack/react-router";
import type { RecordingEntry } from "@slipstream/api";
import { type Channel, epochMs } from "@slipstream/domain";
import type { ReactNode } from "react";
import { m, whenLabel } from "@slipstream/i18n";
import { recordedSpan, resumeMillis } from "~/modules/library/library.ts";
import { Artwork } from "~/ui/artwork/artwork.tsx";
import { Badge } from "~/ui/controls.tsx";
import { MediaCard, MediaRow } from "~/ui/media-row.tsx";
import { useOverlay } from "~/ui/overlay/use-overlay.tsx";
import { Section } from "~/ui/page.tsx";
import type { OnNowItem, ScheduledItem } from "./model.ts";
import { programmeSubject, recordingSubject } from "~/ui/artwork/subjects.ts";
import { channelOf } from "./present.ts";
import type { CardText, RowText } from "./shape.ts";

/**
 * One Home row (SPEC §8.1): the shared section head (title and "more" link) over a MediaRow.
 * Every row on Home is this one pattern.
 */
export function HomeRow({ row, children }: { row: RowText; children: ReactNode }) {
  return (
    <Section
      aria-label={row.title}
      title={row.title}
      {...(row.more === undefined ? {} : { more: row.more })}
      data-home-row={row.key}
    >
      <MediaRow label={row.title}>{children}</MediaRow>
    </Section>
  );
}

/**
 * A row's place while Home loads: the head and the cards it had last time, as transparent
 * bars of the same text, so the loaded row lands in the same boxes (SPEC §6.2).
 */
export function PlaceholderRow({ row }: { row: RowText }) {
  return (
    <HomeRow row={row}>
      {row.cards.map((card, index) => (
        <MediaCard
          // oxlint-disable-next-line react/no-array-index-key -- placeholders have no identity
          key={index}
          art={<Artwork subject={{ title: "" }} noTitle noMark />}
          title={card.title}
          subtitle={card.subtitle}
          isNew={card.isNew}
          badges={card.badges ? <span /> : undefined}
          when={card.when ? <span /> : undefined}
          progress={card.progress ? 0 : undefined}
          render={({ className, children }) => <span className={className}>{children}</span>}
        />
      ))}
    </HomeRow>
  );
}

/** A Continue watching card: amber progress, minutes left; opens the watch choice. */
export function ContinueCard({
  entry,
  text,
  channels,
}: {
  entry: RecordingEntry;
  text: CardText;
  channels: readonly Channel[];
}) {
  const overlay = useOverlay();
  const span = recordedSpan(entry);
  const length = span.end - span.start;
  const position = resumeMillis(entry) ?? 0;
  return (
    <MediaCard
      art={<Artwork subject={recordingSubject(entry, channelOf(channels, entry.channelId))} />}
      title={text.title}
      subtitle={text.subtitle}
      progress={length > 0 ? position / length : 0}
      badges={
        entry.state === "incomplete" ? (
          <Badge tone="warn">{m.player_badge_incomplete()}</Badge>
        ) : undefined
      }
      render={({ className, children }) => (
        <button
          type="button"
          className={className}
          onClick={() => overlay.open({ kind: "choice", name: entry.id })}
        >
          {children}
        </button>
      )}
    />
  );
}

/** An On now card: Rec when it records, light progress through what airs. */
export function OnNowCard({ item, text, now }: { item: OnNowItem; text: CardText; now: number }) {
  const overlay = useOverlay();
  const { channel, programme, recording } = item;
  const start = epochMs(programme.start);
  const end = epochMs(programme.end);
  const label = recording
    ? m.home_card_recording_label({ channel: channel.name, title: programme.title })
    : m.home_card_live_label({ channel: channel.name, title: programme.title });
  return (
    <MediaCard
      art={<Artwork subject={programmeSubject(programme, channel, recording)} />}
      title={text.title}
      subtitle={text.subtitle}
      badges={recording ? <Badge tone="live">{m.status_rec()}</Badge> : undefined}
      progress={end > start ? (now - start) / (end - start) : 0}
      live
      render={({ className, children }) =>
        recording ? (
          <button
            type="button"
            className={className}
            aria-label={label}
            onClick={() => overlay.open({ kind: "choice", name: recording.id })}
          >
            {children}
          </button>
        ) : (
          <Link
            to="/watch/live/$channel"
            params={{ channel: channel.id }}
            className={className}
            aria-label={label}
          >
            {children}
          </Link>
        )
      }
    />
  );
}

/**
 * A Scheduled recordings card: the time pill, Conflict on every item of an overlap; it opens
 * the programme sheet.
 */
export function ScheduledCard({
  item,
  text,
  channels,
  now,
  timeZone,
}: {
  item: ScheduledItem;
  text: CardText;
  channels: readonly Channel[];
  now: number;
  /** The household's zone, which decides "Today" and "Tomorrow". */
  timeZone: string;
}) {
  const overlay = useOverlay();
  const { entry, conflict } = item;
  const when = whenLabel(epochMs(entry.start), now, timeZone);
  const label = m.home_card_scheduled_label({ title: entry.title, when });
  const programmeId = entry.programmeId;
  return (
    <MediaCard
      art={<Artwork subject={recordingSubject(entry, channelOf(channels, entry.channelId))} />}
      title={text.title}
      subtitle={text.subtitle}
      when={
        <>
          <span className="block size-1.5 rounded-full bg-brand" aria-hidden="true" />
          {when}
        </>
      }
      badges={conflict ? <Badge tone="warn">{m.status_conflict()}</Badge> : undefined}
      render={({ className, children }) =>
        programmeId === undefined ? (
          <Link to="/recordings/scheduled" className={className} aria-label={label}>
            {children}
          </Link>
        ) : (
          <button
            type="button"
            className={className}
            aria-label={label}
            onClick={() => overlay.open({ kind: "sheet", name: "prog", arg: programmeId })}
          >
            {children}
          </button>
        )
      }
    />
  );
}

/** A New in your library card: the new dot; nothing to resume, so it plays directly. */
export function NewCard({
  entry,
  text,
  channels,
}: {
  entry: RecordingEntry;
  text: CardText;
  channels: readonly Channel[];
}) {
  return (
    <MediaCard
      art={<Artwork subject={recordingSubject(entry, channelOf(channels, entry.channelId))} />}
      title={text.title}
      subtitle={text.subtitle}
      isNew={text.isNew}
      badges={
        entry.state === "incomplete" ? (
          <Badge tone="warn">{m.player_badge_incomplete()}</Badge>
        ) : undefined
      }
      render={({ className, children }) => (
        <Link
          to="/watch/rec/$id"
          params={{ id: entry.id }}
          search={{ at: "start" }}
          className={className}
        >
          {children}
        </Link>
      )}
    />
  );
}
