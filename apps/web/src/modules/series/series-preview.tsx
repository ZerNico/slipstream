import { DateTime } from "effect";
import { useEffect, useRef, useState } from "react";
import type { RulePreview as Preview } from "@slipstream/api";
import {
  type ChannelId,
  localParts,
  markTitle,
  type Programme,
  recordedCount,
  skipMarkParts,
  type TitleCondition,
} from "@slipstream/domain";
import { m, type SeriesSkipMark, seriesSkipMark } from "@slipstream/i18n";
import { formatTimeRange } from "~/i18n/formats.ts";
import { cn } from "~/ui/utils.ts";

/** What the preview panel shows: guide matches, a reason it can't, or that it is working. */
export type PreviewState =
  /** Ready once the server answered and the household's zone (the days rows name) is known. */
  | { readonly kind: "ready"; readonly preview: Preview; readonly timeZone: string }
  | { readonly kind: "loading" }
  | { readonly kind: "waiting" }
  | { readonly kind: "failed" };

/** Rows whose "will record" state just changed flash once, so a keystroke's effect is seen. */
function useFlash(ids: readonly string[]): ReadonlySet<string> {
  const previous = useRef<ReadonlySet<string> | undefined>(undefined);
  const [flash, setFlash] = useState<ReadonlySet<string>>(new Set());
  const key = ids.join("|");
  useEffect(() => {
    const now = new Set(key === "" ? [] : key.split("|"));
    const before = previous.current;
    previous.current = now;
    if (before === undefined) return;
    const changed = [...now].filter((id) => !before.has(id));
    if (changed.length === 0) return;
    setFlash(new Set(changed));
    const timer = window.setTimeout(() => setFlash(new Set()), 900);
    return () => window.clearTimeout(timer);
  }, [key]);
  return flash;
}

function Row({
  programme,
  conditions,
  channelName,
  timeZone,
  now,
  note,
  reason,
  flash,
}: {
  programme: Programme;
  conditions: readonly TitleCondition[];
  channelName: (id: ChannelId) => string | undefined;
  timeZone: string;
  now: number;
  note?: string;
  reason?: string;
  flash: boolean;
}) {
  const start = DateTime.toEpochMillis(programme.start);
  const end = DateTime.toEpochMillis(programme.end);
  const day = localParts(programme.start, timeZone);
  const live = reason === undefined && start <= now && now < end;
  return (
    <li
      className={cn(
        "grid grid-cols-[44px_minmax(0,1fr)] items-start gap-3 px-4.5 py-2 transition-colors duration-(--t-slow)",
        flash && "bg-ok-soft",
      )}
    >
      <div className="pt-0.5 text-center text-[11px] leading-[1.15] font-[650] text-fg-3">
        {m.series_weekday_abbr({ day: day.weekday })}
        <b className="block font-display text-[16px] text-fg">{day.day}</b>
      </div>
      <div className="min-w-0">
        <div
          className={cn(
            "text-[14px] leading-[1.35] font-[550] break-words",
            reason !== undefined && "text-fg-2",
          )}
        >
          {markTitle(programme.title, conditions).map((run, index) =>
            run.marked ? (
              // oxlint-disable-next-line react/no-array-index-key -- runs are positional
              <mark key={index} className="rounded-[4px] bg-ok-soft px-0.5 text-ok-fg">
                {run.text}
              </mark>
            ) : (
              // oxlint-disable-next-line react/no-array-index-key -- runs are positional
              <span key={index}>{run.text}</span>
            ),
          )}
        </div>
        <div className="text-[12.5px] text-fg-3 tabular-nums">
          {formatTimeRange(start, end)} · {channelName(programme.channelId) ?? programme.channelId}
          {live ? (
            <>
              {" · "}
              <span className="font-[650] text-live-fg">{m.series_preview_now()}</span>
            </>
          ) : null}
          {note === undefined ? null : ` · ${note}`}
        </div>
        {reason === undefined ? null : <div className="text-[12.5px] text-fg-3">{reason}</div>}
      </div>
    </li>
  );
}

/**
 * A row's mark as its props: a note after the time, or the grey result box of an airing left
 * out ("Already recorded · Sun 22, 15:00").
 */
const markProps = (mark: SeriesSkipMark | undefined): { note?: string; reason?: string } =>
  mark === undefined ? {} : mark.kind === "note" ? { note: mark.text } : { reason: mark.text };

/** A preview row's mark in words, when it has one. */
const skipMarkOf = (
  skip: Preview["matches"][number]["skip"],
  isNew: boolean,
  timeZone: string,
): SeriesSkipMark | undefined => {
  const parts = skip === undefined ? undefined : skipMarkParts(skip, { isNew, timeZone });
  return parts === undefined ? undefined : seriesSkipMark(parts);
};

/** A quiet line in place of rows: nothing matches yet, or why the preview can't run. */
function Hint({ text }: { text: string }) {
  return <p className="px-4.5 pt-1.5 pb-3 text-[12.5px] text-fg-3">{text}</p>;
}

/**
 * The editor's live preview (SPEC §8.6): what the draft will record over the next 14 days, then
 * "Similar, won't record" with the reason. Rows that start matching flash once.
 */
export function SeriesPreview({
  state,
  conditions,
  channelName,
  now,
  isNew,
}: {
  state: PreviewState;
  /** A draft not saved yet: it says which matches are the same airing as a scheduled recording. */
  isNew: boolean;
  conditions: readonly TitleCondition[];
  channelName: (id: ChannelId) => string | undefined;
  now: number;
}) {
  const ready = state.kind === "ready" ? state : undefined;
  const preview = ready?.preview;
  const matches = preview?.matches ?? [];
  const willRecord = recordedCount(matches);
  const flash = useFlash(matches.map((match) => match.programme.id));
  return (
    <>
      <div className="sticky top-0 z-2 flex items-baseline gap-2.5 border-b border-line bg-surface px-4.5 py-4">
        <h2 className="type-h3">{m.series_preview()}</h2>
        <span className="ml-auto text-[13px] text-fg-3 tabular-nums">
          {ready === undefined ? null : m.series_preview_count({ count: willRecord })}
        </span>
      </div>
      {state.kind === "failed" ? (
        <Hint text={m.series_preview_failed()} />
      ) : state.kind === "ready" && matches.length === 0 ? (
        <Hint text={m.series_preview_empty()} />
      ) : null}
      {ready !== undefined && matches.length > 0 ? (
        <ul>
          {matches.map((match) => (
            <Row
              key={match.programme.id}
              programme={match.programme}
              conditions={conditions}
              channelName={channelName}
              timeZone={ready.timeZone}
              now={now}
              flash={flash.has(match.programme.id)}
              {...markProps(skipMarkOf(match.skip, isNew, ready.timeZone))}
            />
          ))}
        </ul>
      ) : null}
      <div className="h-3" />
    </>
  );
}
