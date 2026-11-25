/**
 * Guide clean-up applied per source after parsing: duplicate removal (tvproxy lists every
 * programme of a channel that sits in two groups twice), optional title/sub-title rewrite rules,
 * and stop times for programmes that left them out.
 */
import { Data, Effect, Schema } from "effect";
import type { XmltvChannel, XmltvProgramme } from "./xmltv.ts";

const programmeKey = (programme: XmltvProgramme): string =>
  `${programme.channel}\u0000${programme.start}\u0000${programme.stop ?? ""}\u0000${programme.title}\u0000${programme.subTitle ?? ""}`;

/** Fills fields the kept copy lacks from a duplicate. */
const mergeProgramme = (kept: XmltvProgramme, extra: XmltvProgramme): XmltvProgramme => ({
  ...kept,
  description: kept.description ?? extra.description,
  categories: [...new Set([...kept.categories, ...extra.categories])],
  episode: kept.episode ?? extra.episode,
  icon: kept.icon ?? extra.icon,
  date: kept.date ?? extra.date,
  country: kept.country ?? extra.country,
  language: kept.language ?? extra.language,
  isNew: kept.isNew || extra.isNew,
  premiere: kept.premiere || extra.premiere,
  previouslyShown: kept.previouslyShown || extra.previouslyShown,
  live: kept.live || extra.live,
});

/**
 * Removes programmes that repeat another one on the same channel with the same start, stop,
 * title and sub-title. The first copy is kept, in its original position, and gains any fields
 * only a later copy had. Programmes that merely overlap are left alone.
 */
export const dedupeProgrammes = (
  programmes: ReadonlyArray<XmltvProgramme>,
): { readonly programmes: ReadonlyArray<XmltvProgramme>; readonly removed: number } => {
  const index = new Map<string, number>();
  const kept: XmltvProgramme[] = [];
  for (const programme of programmes) {
    const key = programmeKey(programme);
    const at = index.get(key);
    if (at === undefined) {
      index.set(key, kept.length);
      kept.push(programme);
    } else {
      kept[at] = mergeProgramme(kept[at] as XmltvProgramme, programme);
    }
  }
  return { programmes: kept, removed: programmes.length - kept.length };
};

/**
 * Merges channels that share an id (tvproxy repeats a channel per group), keeping the first
 * position and the union of display names.
 */
export const dedupeChannels = (
  channels: ReadonlyArray<XmltvChannel>,
): ReadonlyArray<XmltvChannel> => {
  const byId = new Map<string, XmltvChannel>();
  for (const channel of channels) {
    const known = byId.get(channel.id);
    byId.set(
      channel.id,
      known === undefined
        ? channel
        : {
            ...known,
            displayNames: [...new Set([...known.displayNames, ...channel.displayNames])],
            icon: known.icon ?? channel.icon,
            url: known.url ?? channel.url,
          },
    );
  }
  return [...byId.values()];
};

/**
 * Sets a missing stop to the next programme's start on the same channel. Programmes that are
 * last on their channel keep no stop. Input order is preserved.
 */
export const fillMissingStops = (
  programmes: ReadonlyArray<XmltvProgramme>,
): ReadonlyArray<XmltvProgramme> => {
  const startsByChannel = new Map<string, number[]>();
  for (const programme of programmes) {
    const starts = startsByChannel.get(programme.channel) ?? [];
    starts.push(programme.start);
    startsByChannel.set(programme.channel, starts);
  }
  for (const starts of startsByChannel.values()) starts.sort((a, b) => a - b);
  return programmes.map((programme) => {
    if (programme.stop !== undefined) return programme;
    const next = firstAfter(startsByChannel.get(programme.channel) ?? [], programme.start);
    return next === undefined ? programme : { ...programme, stop: next };
  });
};

/** Binary search for the smallest value in sorted `values` greater than `target`. */
const firstAfter = (values: ReadonlyArray<number>, target: number): number | undefined => {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if ((values[mid] ?? Number.POSITIVE_INFINITY) <= target) low = mid + 1;
    else high = mid;
  }
  return values[low];
};

/** Builds a rule's RegExp, or says why it cannot. */
const ruleRegex = (pattern: string, flags: string | undefined): RegExp | string => {
  if (/[gy]/.test(flags ?? "")) return "flags g and y are not allowed";
  try {
    return new RegExp(pattern, flags);
  } catch {
    return "not a valid regular expression";
  }
};

/**
 * A title/sub-title rewrite. When `field` matches `pattern`, every field in `set` is replaced by
 * its template, where `$1`, `$<name>` and `$&` refer to the match. A rule only touches channels
 * listed in `channels`, or every channel when that is absent.
 *
 * Example: `{ field: "title", pattern: "^F1: (.+)$", set: { title: "Formel 1", subTitle: "$1" } }`
 */
export const RewriteRule = Schema.Struct({
  field: Schema.Literals(["title", "subTitle"]),
  pattern: Schema.String,
  /** RegExp flags such as `i`; `g` and `y` are not allowed. */
  flags: Schema.optionalKey(Schema.String),
  channels: Schema.optionalKey(Schema.Array(Schema.String)),
  set: Schema.Struct({
    title: Schema.optionalKey(Schema.String),
    subTitle: Schema.optionalKey(Schema.String),
  }),
}).pipe(
  Schema.check(
    Schema.makeFilter((rule) => {
      const regex = ruleRegex(rule.pattern, rule.flags);
      return typeof regex === "string" ? { path: ["pattern"], issue: regex } : undefined;
    }),
  ),
);

/** A decoded rewrite rule. */
export type RewriteRule = typeof RewriteRule.Type;

/** A rewrite rule did not compile. */
export class InvalidRewriteRule extends Data.TaggedError("InvalidRewriteRule")<{
  readonly index: number;
  readonly message: string;
}> {}

interface CompiledRule {
  readonly field: "title" | "subTitle";
  readonly regex: RegExp;
  readonly channels: ReadonlySet<string> | undefined;
  readonly set: RewriteRule["set"];
}

/** Rules ready to apply to many programmes. */
export interface CompiledRewrites {
  readonly rules: ReadonlyArray<CompiledRule>;
}

/**
 * Compiles rules once, failing with the index of the first rule whose pattern does not compile.
 */
export const compileRewrites = (
  rules: ReadonlyArray<RewriteRule>,
): Effect.Effect<CompiledRewrites, InvalidRewriteRule> =>
  Effect.forEach(rules, (rule, index) => {
    const regex = ruleRegex(rule.pattern, rule.flags);
    return typeof regex === "string"
      ? Effect.fail(new InvalidRewriteRule({ index, message: regex }))
      : Effect.succeed<CompiledRule>({
          field: rule.field,
          regex,
          channels: rule.channels ? new Set(rule.channels) : undefined,
          set: rule.set,
        });
  }).pipe(Effect.map((compiled) => ({ rules: compiled })));

/** Expands `$1`, `$<name>`, `$&` and `$$` in a template from a match. */
const expand = (template: string, match: RegExpExecArray): string =>
  template.replace(/\$(\$|&|\d{1,2}|<([^>]+)>)/g, (whole, token: string, name?: string) => {
    if (token === "$") return "$";
    if (token === "&") return match[0];
    if (name !== undefined) return match.groups?.[name] ?? "";
    const group = Number(token);
    return group < match.length ? (match[group] ?? "") : whole;
  });

/**
 * Applies compiled rules in order; each rule sees the result of the previous one. A rewrite that
 * would leave the title empty is ignored; an empty sub-title removes it.
 */
export const applyRewrites = (
  rewrites: CompiledRewrites,
  programme: XmltvProgramme,
): XmltvProgramme => {
  let current = programme;
  for (const rule of rewrites.rules) {
    if (rule.channels && !rule.channels.has(current.channel)) continue;
    const value = current[rule.field];
    if (value === undefined) continue;
    const match = rule.regex.exec(value);
    if (!match) continue;
    let next = current;
    if (rule.set.title !== undefined) {
      const title = expand(rule.set.title, match).trim();
      if (title !== "") next = { ...next, title };
    }
    if (rule.set.subTitle !== undefined) {
      const subTitle = expand(rule.set.subTitle, match).trim();
      next = { ...next, subTitle: subTitle === "" ? undefined : subTitle };
    }
    current = next;
  }
  return current;
};

/** Per-source clean-up settings. */
export interface GuideCleanup {
  /** Default true. */
  readonly removeDuplicates?: boolean | undefined;
  /** Default true. */
  readonly fillMissingStops?: boolean | undefined;
  readonly rewrites?: CompiledRewrites | undefined;
}

/** What clean-up changed, for the source status page. */
export interface CleanupReport {
  readonly duplicatesRemoved: number;
  readonly duplicateChannelsMerged: number;
  readonly rewritten: number;
}

/**
 * Runs the whole clean-up on a collected guide: rewrites first (so duplicates that only differ
 * in a rewritten detail collapse), then duplicate removal, then missing stops.
 */
export const cleanGuide = (
  guide: {
    readonly channels: ReadonlyArray<XmltvChannel>;
    readonly programmes: ReadonlyArray<XmltvProgramme>;
  },
  cleanup: GuideCleanup = {},
): {
  readonly channels: ReadonlyArray<XmltvChannel>;
  readonly programmes: ReadonlyArray<XmltvProgramme>;
  readonly report: CleanupReport;
} => {
  let rewritten = 0;
  let programmes = guide.programmes;
  const rewrites = cleanup.rewrites;
  if (rewrites && rewrites.rules.length > 0) {
    programmes = programmes.map((programme) => {
      const next = applyRewrites(rewrites, programme);
      if (next !== programme) rewritten++;
      return next;
    });
  }
  let duplicatesRemoved = 0;
  let channels = guide.channels;
  if (cleanup.removeDuplicates ?? true) {
    const deduped = dedupeProgrammes(programmes);
    programmes = deduped.programmes;
    duplicatesRemoved = deduped.removed;
    channels = dedupeChannels(channels);
  }
  if (cleanup.fillMissingStops ?? true) programmes = fillMissingStops(programmes);
  return {
    channels,
    programmes,
    report: {
      duplicatesRemoved,
      duplicateChannelsMerged: guide.channels.length - channels.length,
      rewritten,
    },
  };
};
