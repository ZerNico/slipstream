import { Schema } from "effect";
import { normaliseText, type TitleHit } from "./title.ts";

/** Separators the editor offers when someone marks a part in an example title. */
export const defaultSeparators: ReadonlyArray<string> = [" - ", " – ", ": ", ", "];

/** Names reserved for built-in template variables; named parts cannot use them. */
export const builtInVariables = [
  "collection",
  "title",
  "show",
  "season",
  "episode",
  "subtitle",
  "year",
  "month",
  "date",
  "channel",
] as const;

/** A template variable name: a letter, then letters and digits. */
export const PartName = Schema.String.check(
  Schema.isPattern(/^[A-Za-z][A-Za-z0-9]*$/u, { title: "part name" }),
);

/** One occurrence of a separator in a title. */
export const Anchor = Schema.Struct({
  separator: Schema.NonEmptyString,
  occurrence: Schema.Literals(["first", "last"]),
}).annotate({ identifier: "Anchor" });
export type Anchor = typeof Anchor.Type;

/**
 * A named piece of a title. `Split` takes the text after the `after` anchor (counted in the whole
 * title; without it, right after the matched prefix) up to the `before` anchor (counted in the
 * text that follows). `Matched` is the word a "contains one of" condition found.
 */
export const TitlePart = Schema.TaggedUnion({
  Split: { name: PartName, after: Schema.optionalKey(Anchor), before: Schema.optionalKey(Anchor) },
  Matched: { name: PartName },
}).annotate({ identifier: "TitlePart" });
export type TitlePart = typeof TitlePart.Type;

/** A title prepared for part extraction. */
export interface PreparedTitle {
  /** The normalised full title. */
  readonly title: string;
  /** Where the text after a matched "starts with" prefix begins. 0 without a prefix. */
  readonly contentStart: number;
  readonly hits: ReadonlyArray<TitleHit>;
}

// Built from a string so the formatter keeps the dash characters escaped.
const leadingPunctuation = new RegExp("^[\\s:,;|\\u00b7\\u2013\\u2014-]+", "u");

/**
 * Prepares a title for extraction. The longest "starts with" hit on the title becomes the prefix
 * (e.g. "Live F1:"), and punctuation right after it is skipped.
 */
export const prepareTitle = (title: string, hits: ReadonlyArray<TitleHit>): PreparedTitle => {
  const normalised = normaliseText(title);
  const prefix = hits
    .filter((hit) => hit.condition === "StartsWith" && hit.field === "title" && hit.index === 0)
    .reduce((longest, hit) => Math.max(longest, hit.text.length), 0);
  const skipped = leadingPunctuation.exec(normalised.slice(prefix))?.[0].length ?? 0;
  return { title: normalised, contentStart: prefix + skipped, hits };
};

/** The title without its matched prefix: "Live F1: Saisonrückblick 2026" gives "Saisonrückblick 2026". */
export const titleContent = (prepared: PreparedTitle): string =>
  prepared.title.slice(prepared.contentStart).trim();

const findAnchor = (text: string, anchor: Anchor): number =>
  anchor.occurrence === "first"
    ? text.indexOf(anchor.separator)
    : text.lastIndexOf(anchor.separator);

/** Extracts one part, or `undefined` when the title has no such part (a missing separator). */
export const extractPart = (part: TitlePart, prepared: PreparedTitle): string | undefined => {
  if (part._tag === "Matched") {
    const hit = prepared.hits.find(
      (candidate) => candidate.condition === "Contains" || candidate.condition === "IsExactly",
    );
    return hit?.text;
  }
  let start = prepared.contentStart;
  if (part.after !== undefined) {
    const index = findAnchor(prepared.title, part.after);
    if (index < 0) return undefined;
    start = index + part.after.separator.length;
  }
  let text = prepared.title.slice(start);
  if (part.before !== undefined) {
    const index = findAnchor(text, part.before);
    if (index < 0) return undefined;
    text = text.slice(0, index);
  }
  const value = text.replace(leadingPunctuation, "").trim();
  return value === "" ? undefined : value;
};

/**
 * Extracts every part plus the named groups of regex conditions. A part that cannot be extracted
 * is absent from the result.
 */
export const extractParts = (
  parts: ReadonlyArray<TitlePart>,
  prepared: PreparedTitle,
): Record<string, string> => {
  const values: Record<string, string> = {};
  for (const hit of prepared.hits) {
    for (const [name, value] of Object.entries(hit.groups)) {
      const trimmed = value.trim();
      if (trimmed !== "") values[name] = trimmed;
    }
  }
  for (const part of parts) {
    const value = extractPart(part, prepared);
    if (value !== undefined) values[part.name] = value;
  }
  return values;
};

const occurrenceOf = (text: string, separator: string, index: number): Anchor | undefined => {
  if (text.indexOf(separator) === index) return { separator, occurrence: "first" };
  if (text.lastIndexOf(separator) === index) return { separator, occurrence: "last" };
  return undefined;
};

/**
 * Turns text someone selected in an example title into a `Split` part, by finding the separators
 * that border the selection. Returns `undefined` when the selection is not bordered by a
 * separator or the separator is neither the first nor the last of its kind; the editor then
 * offers the regex option instead. The result always reproduces the selection on the example.
 */
export const partFromSelection = (
  name: string,
  prepared: PreparedTitle,
  selection: { readonly start: number; readonly end: number },
  separators: ReadonlyArray<string> = defaultSeparators,
): TitlePart | undefined => {
  const { title } = prepared;
  const selected = title.slice(selection.start, selection.end).trim();
  if (selected === "") return undefined;

  const candidatesAfter: Array<Anchor | undefined> =
    title.slice(prepared.contentStart, selection.start).trim() === "" ? [undefined] : [];
  for (const separator of separators) {
    const index = selection.start - separator.length;
    if (index >= 0 && title.startsWith(separator, index)) {
      const anchor = occurrenceOf(title, separator, index);
      if (anchor !== undefined) candidatesAfter.push(anchor);
    }
  }

  for (const after of candidatesAfter) {
    const start = after === undefined ? prepared.contentStart : selection.start;
    const rest = title.slice(start);
    const candidatesBefore: Array<Anchor | undefined> =
      title.slice(selection.end).trim() === "" ? [undefined] : [];
    for (const separator of separators) {
      const index = selection.end - start;
      if (rest.startsWith(separator, index)) {
        const anchor = occurrenceOf(rest, separator, index);
        if (anchor !== undefined) candidatesBefore.push(anchor);
      }
    }
    for (const before of candidatesBefore) {
      const part: TitlePart = {
        _tag: "Split",
        name,
        ...(after === undefined ? {} : { after }),
        ...(before === undefined ? {} : { before }),
      };
      if (extractPart(part, prepared) === selected) return part;
    }
  }
  return undefined;
};
