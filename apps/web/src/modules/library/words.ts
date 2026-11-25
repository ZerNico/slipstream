import {
  type ChannelId,
  type Matcher,
  type Retention,
  type TitleCondition,
} from "@slipstream/domain";
import { m } from "@slipstream/i18n";
import type { LayoutPart } from "./editor.ts";

/*
 * Sentences the Recordings screens build from data, in one place so the library, the group page
 * and the detail say the same thing the same way.
 */

/** One title condition of a linked collection's conditions, as a phrase. */
const titlePhrase = (condition: TitleCondition): string => {
  switch (condition._tag) {
    case "StartsWith":
      return m.library_follows_starts({ values: condition.values });
    case "Contains":
      return m.library_follows_contains({ values: condition.values });
    case "IsExactly":
      return m.library_follows_exactly({ values: condition.values });
    case "Regex":
      return m.library_follows_regex();
  }
};

/**
 * What a linked collection's conditions are, in words (SPEC §8.5): "Sky Sport F1, titles
 * starting with “Live F1:”". Channels first, then titles, then categories.
 */
export const followsSummary = (
  matcher: Pick<Matcher, "channels" | "title" | "categories">,
  channelName: (id: ChannelId) => string,
): string =>
  [
    matcher.channels.length === 0
      ? m.library_follows_any_channel()
      : matcher.channels.map(channelName).join(", "),
    ...matcher.title.map(titlePhrase),
    ...(matcher.categories.length === 0
      ? []
      : [m.library_follows_category({ values: matcher.categories })]),
  ].join(", ");

/** A retention policy as a phrase, "Keeps the newest 3 events". */
export const keepWords = (retention: Retention | undefined): string => {
  if (retention === undefined) return m.library_keep_until_deleted();
  switch (retention._tag) {
    case "KeepAll":
      return m.library_keep_everything();
    case "KeepNewest":
      return m.library_keep_newest({ count: retention.count });
    case "KeepNewestEvents":
      return m.library_keep_newest_events({ count: retention.count });
    case "KeepDays":
      return m.library_keep_days({ days: retention.days });
  }
};

/** A layout level as a word, never a template brace (SPEC §8.5). */
export const partWords = (part: LayoutPart): string => {
  switch (part) {
    case "year":
      return m.library_part_year();
    case "season":
      return m.library_season_label();
    case "event":
      return m.library_part_event();
    case "programme":
      return m.library_part_programme();
    case "subtitle":
      return m.library_part_subtitle();
    case "show":
      return m.library_part_show();
    case "episode":
      return m.library_part_episode();
    case "date":
      return m.library_part_date();
    case "title":
      return m.library_part_title();
  }
};
