import { Schema } from "effect";

/** Which guide text a condition looks at. */
export const TitleField = Schema.Literals(["title", "subtitle"]);
export type TitleField = typeof TitleField.Type;

/** The longest value a "starts with", "contains" or "is exactly" condition takes. */
export const titleValueMaxLength = 200;
/** The most values one condition lists. */
export const titleValuesMax = 50;
/** The longest regex a title condition takes. */
export const titlePatternMaxLength = 200;
/**
 * The most guide text a regex ever sees: titles and sub-titles are cut here first, so even a
 * pattern that backtracks a lot stays bounded.
 */
export const regexSubjectMaxLength = 300;

const listCondition = {
  values: Schema.NonEmptyArray(
    Schema.NonEmptyString.check(Schema.isMaxLength(titleValueMaxLength)),
  ).check(Schema.isMaxLength(titleValuesMax)),
  field: Schema.optionalKey(TitleField),
  caseSensitive: Schema.optionalKey(Schema.Boolean),
};

/**
 * One condition on a title or sub-title. `StartsWith`, `Contains` and `IsExactly` hold when any
 * of their values does ("contains one of"). `Regex` is the advanced option; its named groups
 * become title parts in collection layouts.
 */
export const TitleCondition = Schema.TaggedUnion({
  StartsWith: listCondition,
  Contains: listCondition,
  IsExactly: listCondition,
  Regex: {
    pattern: Schema.NonEmptyString.check(Schema.isMaxLength(titlePatternMaxLength)),
    field: Schema.optionalKey(TitleField),
    caseSensitive: Schema.optionalKey(Schema.Boolean),
  },
}).annotate({ identifier: "TitleCondition" });
export type TitleCondition = typeof TitleCondition.Type;

/** Where and how a condition matched, for title parts and for the "why" explanation. */
export interface TitleHit {
  readonly condition: TitleCondition["_tag"];
  readonly field: TitleField;
  /** The condition value that matched (e.g. "Live F1:"), or the regex source. */
  readonly value: string;
  /** The matched text as it appears in the normalised title. */
  readonly text: string;
  readonly index: number;
  /** Named regex groups, empty for the other conditions. */
  readonly groups: Readonly<Record<string, string>>;
}

/** Collapses runs of whitespace and trims, so double spaces in guide data never break a match. */
export const normaliseText = (text: string): string => text.replace(/\s+/gu, " ").trim();

/*
 * Broadcast noise in guide titles, read the same everywhere: repeat markers ("(Wh.)", "(Wdh.)",
 * "Wiederholung") and a leading "Live". Markers match in any case; "Live" only as guides write it
 * (Live, LIVE, live), followed by a separator or a capitalised word, so "Live and Let Die" keeps
 * its first word.
 */

/** A bracketed repeat marker: "(Wh.)", "(Wdh)", "(Whg.)", "(Wiederholung)", "(Repeat)", "(R)". */
const bracketedRepeat = String.raw`\((?:Wh|Wdh|Whg)\.?\)|\((?:Wiederholung|Repeat|R)\)`;

/** Any repeat marker, bracketed or bare ("Wiederholung", "Wdh.", "Wh."). */
const repeatMarker = String.raw`${bracketedRepeat}|\bWiederholung\b|\bWdh\.|\bWh\.`;

/** Whether a title or sub-title says it is a repeat ("(Wh.)", "(Wdh.)", "Wiederholung"). */
export const hasRepeatMarker = (text: string): boolean => new RegExp(repeatMarker, "iu").test(text);

/** A text with its repeat markers taken out: "Tatort (Wh.)" is "Tatort". */
export const withoutRepeatMarkers = (text: string): string =>
  normaliseText(text.replace(new RegExp(String.raw`\s*(?:${repeatMarker})`, "giu"), ""));

const onlyRepeatMarker = /^\(?(?:wh|wdh|whg|wiederholung|repeat)\.?\)?$/iu;

/** Whether a sub-title says nothing but "repeat" ("Wdh.", "(Wiederholung)"). */
export const isOnlyRepeatMarker = (text: string): boolean => onlyRepeatMarker.test(text.trim());

/** A leading "Live" with its separator: "Live: ", "LIVE - ", "Live " before "F1". */
export const leadingLive = /^(?:Live|LIVE|live)(?:\s*[:–-]\s*|\s+(?=[\p{Lu}\d]))/u;

/** A trailing marker of a repeat or a live airing: "(Wh.)", "(Live)", "- Live". */
const trailingMarker = new RegExp(
  String.raw`\s*(?:${bracketedRepeat}|\(live\)|[–-]\s*live)\s*$`,
  "iu",
);

/**
 * Strips broadcast noise from a title so repeats and live airings group together: a leading
 * "Live" / "Live:" and trailing markers such as "(Wh.)", "(Wdh.)", "(Live)" or "- Live".
 */
export const cleanTitle = (title: string): string => {
  let current = normaliseText(title);
  for (;;) {
    const next = current.replace(leadingLive, "").replace(trailingMarker, "").trim();
    if (next === current || next === "") return current;
    current = next;
  }
};

/** Separators and spaces a title prefix may end with ("Live F1:", "Tatort -"). */
const trailingSeparators = /[\s:;,|·\-\u2013\u2014/]+$/u;

/**
 * The name a series or a run of broadcasts goes by, from its title prefix: trailing separators
 * and whitespace trimmed ("Live F1:" is "Live F1"). Closing brackets, "?" and "!" stay, as they
 * belong to the name. Falls back to the trimmed title when nothing else is left.
 */
export const seriesDisplayName = (title: string): string =>
  normaliseText(title).replace(trailingSeparators, "") || normaliseText(title);

/** Why a pattern is refused before it ever runs: it could backtrack for a very long time. */
export type RegexHazard =
  | "tooLong"
  | "backreference"
  | "nestedQuantifier"
  | "overlappingAlternation"
  | "tooManyQuantifiers";

/** At most this many unbounded quantifiers (`*`, `+`, `{n,}`) in one pattern. */
const MAX_UNBOUNDED_QUANTIFIERS = 3;

/** What the safety check knows about one group (or the whole pattern) while reading it. */
interface GroupFrame {
  /** Something inside repeats (a quantifier allowing more than one), at any depth. */
  repeats: boolean;
  /** The group has `|` at its own level. */
  alternation: boolean;
  /** Everything at its own level is plain text: no classes, groups, wildcards or quantifiers. */
  literal: boolean;
  /** The plain-text branches read so far (lower-cased), for a literal group. */
  readonly branches: Array<string>;
  /** The branch being read. */
  branch: string;
}

const newFrame = (): GroupFrame => ({
  repeats: false,
  alternation: false,
  literal: true,
  branches: [],
  branch: "",
});

/**
 * Whether one branch is a start of another ("a|ab", or twice the same word): repeating such
 * an alternation can split the same text in exponentially many ways.
 */
const branchesOverlap = (branches: ReadonlyArray<string>): boolean =>
  branches.some((a, i) => branches.some((b, j) => i !== j && b.startsWith(a)));

const quantifierPattern = /^(?:[*+?]|\{(\d+)(,(\d*))?\})/u;
const groupOpenPattern = /^\((?:\?(?::|=|!|<=|<!|<[A-Za-z_$][\w$]*>))?/u;
/** Escapes that stand for one literal character (`\.`, `\(`), as opposed to classes (`\d`). */
const literalEscape = /^[\\/.^$|?*+()[\]{}-]$/u;

/**
 * Checks a regex for catastrophic backtracking before it runs on guide data: no backreferences,
 * no repeated group that itself repeats (`(a+)+`, star height above one), no repeated
 * alternation whose branches are more than plain words (`(a|.a)*`), and at most a few unbounded
 * quantifiers. Deliberately strict; the patterns rules use ("^(?<series>.+?): (?<episode>.+)$",
 * "(Qualifying|Rennen)+") pass. Syntax errors are left to the `RegExp` constructor. Returns
 * `undefined` for a safe pattern.
 */
export const regexHazard = (pattern: string): RegexHazard | undefined => {
  if (pattern.length > titlePatternMaxLength) return "tooLong";
  const stack: Array<GroupFrame> = [newFrame()];
  const top = (): GroupFrame => stack.at(-1) ?? newFrame();
  let unbounded = 0;
  /** The atom a quantifier would repeat: a closed group, any other atom, or nothing. */
  let last: GroupFrame | "atom" | undefined;
  let index = 0;
  while (index < pattern.length) {
    const rest = pattern.slice(index);
    const quantifier = last === undefined ? null : quantifierPattern.exec(rest);
    if (quantifier !== null && last !== undefined) {
      const [text, min, comma, max] = quantifier;
      const isUnbounded = text === "*" || text === "+" || (comma !== undefined && max === "");
      const repeats =
        isUnbounded || (text !== "?" && Number((comma === undefined ? min : max) ?? 0) > 1);
      if (isUnbounded) unbounded += 1;
      if (unbounded > MAX_UNBOUNDED_QUANTIFIERS) return "tooManyQuantifiers";
      if (repeats && last !== "atom") {
        if (last.repeats) return "nestedQuantifier";
        if (last.alternation && (!last.literal || branchesOverlap(last.branches))) {
          return "overlappingAlternation";
        }
      }
      const frame = top();
      if (repeats) frame.repeats = true;
      frame.literal = false;
      index += text.length;
      if (pattern[index] === "?") index += 1; // lazy
      last = undefined;
      continue;
    }
    const char = pattern[index];
    if (char === "\\") {
      const next = pattern[index + 1] ?? "";
      if (/^[1-9k]$/u.test(next)) return "backreference";
      if (literalEscape.test(next)) top().branch += next.toLowerCase();
      else top().literal = false;
      index += 2;
      last = "atom";
    } else if (char === "[") {
      // A character class is one atom; skip to its closing bracket.
      index += 1;
      if (pattern[index] === "^") index += 1;
      if (pattern[index] === "]") index += 1;
      while (index < pattern.length && pattern[index] !== "]") {
        index += pattern[index] === "\\" ? 2 : 1;
      }
      index += 1;
      top().literal = false;
      last = "atom";
    } else if (char === "(") {
      stack.push(newFrame());
      index += groupOpenPattern.exec(rest)?.[0].length ?? 1;
      last = undefined;
    } else if (char === ")") {
      const closed = stack.length > 1 ? stack.pop() : undefined;
      if (closed !== undefined) {
        closed.branches.push(closed.branch);
        const parent = top();
        parent.repeats ||= closed.repeats;
        parent.literal = false;
      }
      index += 1;
      last = closed;
    } else if (char === "|") {
      const frame = top();
      frame.alternation = true;
      frame.branches.push(frame.branch);
      frame.branch = "";
      index += 1;
      last = undefined;
    } else if (char === "^" || char === "$") {
      index += 1;
      last = undefined;
    } else {
      if (char === ".") top().literal = false;
      else top().branch += (char ?? "").toLowerCase();
      index += 1;
      last = "atom";
    }
  }
  return undefined;
};

/** Compiled patterns (`null`: invalid or unsafe), keyed by flags and source. */
const compiled = new Map<string, RegExp | null>();
const COMPILED_MAX = 500;

/**
 * Compiles a condition's regex, or `undefined` when the pattern is invalid or unsafe (see
 * {@link regexHazard}). Compiled patterns are kept, so a rule's regex compiles once however
 * many programmes it is matched against.
 */
export const compileRegex = (pattern: string, caseSensitive: boolean): RegExp | undefined => {
  const key = `${caseSensitive ? "s" : "i"}:${pattern}`;
  const cached = compiled.get(key);
  if (cached !== undefined) return cached ?? undefined;
  let regex: RegExp | null = null;
  if (regexHazard(pattern) === undefined) {
    try {
      regex = new RegExp(pattern, caseSensitive ? "u" : "iu");
    } catch {
      regex = null;
    }
  }
  // The household's rules and collections hold a handful of patterns; drafts typed in an
  // editor would otherwise pile up.
  if (compiled.size >= COMPILED_MAX) compiled.clear();
  compiled.set(key, regex);
  return regex ?? undefined;
};

/** The guide text a condition reads from. */
export interface TitleSubject {
  readonly title: string;
  readonly subtitle?: string | undefined;
}

/**
 * Evaluates one condition. Among several values the longest match wins, so "Sprint Qualifying"
 * is reported instead of "Sprint" and "Live F1:" instead of "F1:"; ties go to the earliest match.
 */
export const matchTitleCondition = (
  condition: TitleCondition,
  subject: TitleSubject,
): TitleHit | undefined => {
  const field = condition.field ?? "title";
  const raw = field === "title" ? subject.title : subject.subtitle;
  if (raw === undefined) return undefined;
  const text = normaliseText(raw);
  const caseSensitive = condition.caseSensitive ?? false;

  if (condition._tag === "Regex") {
    const match = compileRegex(condition.pattern, caseSensitive)?.exec(
      text.slice(0, regexSubjectMaxLength),
    );
    if (!match) return undefined;
    const groups: Record<string, string> = {};
    for (const [name, value] of Object.entries(match.groups ?? {})) {
      if (value !== undefined) groups[name] = value;
    }
    return {
      condition: "Regex",
      field,
      value: condition.pattern,
      text: match[0],
      index: match.index,
      groups,
    };
  }

  const fold = (value: string) => (caseSensitive ? value : value.toLowerCase());
  const haystack = fold(text);
  let best: TitleHit | undefined;
  for (const rawValue of condition.values) {
    const value = normaliseText(rawValue);
    const needle = fold(value);
    const index =
      condition._tag === "StartsWith"
        ? haystack.startsWith(needle)
          ? 0
          : -1
        : condition._tag === "IsExactly"
          ? haystack === needle
            ? 0
            : -1
          : haystack.indexOf(needle);
    if (index < 0) continue;
    const better =
      best === undefined ||
      value.length > best.text.length ||
      (value.length === best.text.length && index < best.index);
    if (better) {
      best = {
        condition: condition._tag,
        field,
        value,
        text: text.slice(index, index + value.length),
        index,
        groups: {},
      };
    }
  }
  return best;
};
