import type { Weekday } from "../messages/weekday.ts";
import { formatters, m } from "./runtime.ts";

/**
 * A series recording's card line, for every client: its channels joined with "or" (or "Any
 * channel") and, when it has some, its days.
 */
export const seriesCardLine = (
  channelNames: readonly string[],
  weekdays: readonly Weekday[],
): string =>
  [
    channelNames.length === 0
      ? m.series_any_channel()
      : m.series_channel_list({ names: channelNames }),
    ...(weekdays.length === 0 ? [] : [m.series_day_list({ days: weekdays })]),
  ].join(" · ");

/** The templates a new series recording starts from (the domain's `seriesTemplateIds`). */
type TemplateId = "series" | "news" | "sport" | "films";

/** What a series recording template is called, and what it says under its name. */
export const seriesTemplateText = (
  id: TemplateId,
): { readonly title: string; readonly text: string } => {
  switch (id) {
    case "series":
      return { title: m.series_template_series(), text: m.series_template_series_text() };
    case "news":
      return { title: m.series_template_news(), text: m.series_template_news_text() };
    case "sport":
      return { title: m.series_template_sport(), text: m.series_template_sport_text() };
    case "films":
      return { title: m.series_template_films(), text: m.series_template_films_text() };
  }
};

/** A condition kind of the series editor (the domain's `ConditionKind`). */
type ConditionKind = "StartsWith" | "Contains" | "IsExactly" | "Regex" | "Category";

/** What a condition kind is called in the editor: "Starts with", "Category is". */
export const seriesConditionKindLabel = (kind: ConditionKind): string => {
  switch (kind) {
    case "StartsWith":
      return m.series_kind_starts();
    case "Contains":
      return m.series_kind_contains();
    case "IsExactly":
      return m.series_kind_exactly();
    case "Regex":
      return m.series_kind_regex();
    case "Category":
      return m.series_kind_category();
  }
};

/** A way of keeping recordings (the domain's `KeepKind`). */
type KeepKind = "KeepAll" | "KeepNewest" | "KeepNewestEvents" | "KeepDays";

/** What a way of keeping recordings is called in the editor: "Everything", "Newest events". */
export const seriesKeepKindLabel = (kind: KeepKind): string => {
  switch (kind) {
    case "KeepAll":
      return m.series_keep_kind_all();
    case "KeepNewest":
      return m.series_keep_kind_newest();
    case "KeepNewestEvents":
      return m.series_keep_kind_events();
    case "KeepDays":
      return m.series_keep_kind_days();
  }
};

/** A preview row's skip mark as the domain works it out (`skipMarkParts`). */
type SkipParts =
  | { readonly kind: "same" }
  | { readonly kind: "duplicate" }
  | {
      readonly kind: "repeat";
      readonly state: "scheduled" | "deleted" | "recorded";
      readonly day: Weekday;
      readonly date: number;
      readonly epochMs: number;
    };

/** How a preview row is marked when the series recording would not record it itself. */
export type SeriesSkipMark =
  /** A note after the time: the same airing is scheduled already, or listed twice. */
  | { readonly kind: "note"; readonly text: string }
  /** Left out, with its result: "Already recorded · Sun 22, 15:00". */
  | { readonly kind: "left-out"; readonly text: string };

/**
 * The words of a preview row's skip mark (recording model §3.2), for every client; the time is
 * written in the zone set with `setTimeZone`.
 */
export const seriesSkipMark = (parts: SkipParts): SeriesSkipMark => {
  switch (parts.kind) {
    case "same":
      return { kind: "note", text: m.series_skip_same() };
    case "duplicate":
      return { kind: "note", text: m.series_skip_duplicate() };
    case "repeat": {
      const when = {
        day: parts.day,
        date: parts.date,
        time: formatters().time(new Date(parts.epochMs)),
      };
      const text =
        parts.state === "scheduled"
          ? m.series_skip_scheduled(when)
          : parts.state === "deleted"
            ? m.series_skip_deleted(when)
            : m.series_skip_recorded(when);
      return { kind: "left-out", text };
    }
  }
};
