/**
 * Streaming XMLTV parser. Bytes go in chunk by chunk and channel and programme records come out
 * as soon as their closing tag is seen, so the parser holds only the element it is reading. The
 * adapter still collects every record (clean-up and storage need the whole guide), so a guide
 * costs memory for its records, never for its markup or a second copy of its text.
 *
 * Built on saxes (a strict SAX parser) with a non-throwing error handler: malformed markup, an
 * unknown entity or a programme with an unreadable time becomes an `Issue` event and parsing
 * carries on. Only a document whose root is not `<tv>` (an HTML login page, a JSON error) fails.
 */
import { Data, Effect, Stream } from "effect";
import { SaxesParser, type SaxesTagPlain } from "saxes";
import { mergeEpisodeNum, type EpisodeInfo } from "./episode.ts";
import { parseXmltvTime } from "./xmltv-time.ts";

/** A `<channel>` element. */
export interface XmltvChannel {
  readonly _tag: "Channel";
  readonly id: string;
  /** Every `<display-name>`, in document order. */
  readonly displayNames: ReadonlyArray<string>;
  readonly icon?: string | undefined;
  readonly url?: string | undefined;
}

/** A `<programme>` element with a readable start time. */
export interface XmltvProgramme {
  readonly _tag: "Programme";
  /** The `channel` attribute: an XMLTV channel id, usually an M3U `tvg-id`. */
  readonly channel: string;
  /** Epoch milliseconds. */
  readonly start: number;
  /** Epoch milliseconds; XMLTV allows leaving it out. */
  readonly stop?: number | undefined;
  readonly title: string;
  readonly subTitle?: string | undefined;
  readonly description?: string | undefined;
  readonly categories: ReadonlyArray<string>;
  readonly episode?: EpisodeInfo | undefined;
  readonly icon?: string | undefined;
  /** `<date>` as written (often just a year). */
  readonly date?: string | undefined;
  readonly country?: string | undefined;
  /** Language of the chosen title, from its `lang` attribute. */
  readonly language?: string | undefined;
  readonly isNew: boolean;
  readonly premiere: boolean;
  readonly previouslyShown: boolean;
  /** Non-standard `<live/>` element some grabbers emit. */
  readonly live: boolean;
}

/** Something the parser skipped. `line` is 1-based, when known. */
export interface XmltvIssue {
  readonly _tag: "Issue";
  readonly message: string;
  readonly line?: number | undefined;
}

/** What the streaming parser emits. */
export type XmltvEvent = XmltvChannel | XmltvProgramme | XmltvIssue;

/** The document is not XMLTV at all. */
export class XmltvFormatError extends Data.TaggedError("XmltvFormatError")<{
  readonly message: string;
}> {}

/** Parser settings. */
export interface XmltvParseOptions {
  /**
   * Preferred `lang` values for title, sub-title and description, most preferred first. Without
   * a match the first element in the document wins.
   */
  readonly preferredLanguages?: ReadonlyArray<string> | undefined;
  /** Stop emitting `Issue` events after this many (default 100); a final one says how many. */
  readonly maxIssues?: number | undefined;
}

/** HTML entities that real feeds use without declaring them, as code points. */
const EXTRA_ENTITIES: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries({
    nbsp: 0xa0,
    ndash: 0x2013,
    mdash: 0x2014,
    hellip: 0x2026,
    laquo: 0xab,
    raquo: 0xbb,
    bdquo: 0x201e,
    ldquo: 0x201c,
    rdquo: 0x201d,
    lsquo: 0x2018,
    rsquo: 0x2019,
    copy: 0xa9,
    reg: 0xae,
    euro: 0x20ac,
    auml: 0xe4,
    ouml: 0xf6,
    uuml: 0xfc,
    Auml: 0xc4,
    Ouml: 0xd6,
    Uuml: 0xdc,
    szlig: 0xdf,
    eacute: 0xe9,
  }).map(([name, codePoint]) => [name, String.fromCodePoint(codePoint)]),
);

interface LangText {
  readonly lang: string | undefined;
  readonly text: string;
}

interface ProgrammeDraft {
  readonly channel: string | undefined;
  readonly startRaw: string | undefined;
  readonly stopRaw: string | undefined;
  readonly line: number;
  titles: LangText[];
  subTitles: LangText[];
  descriptions: LangText[];
  categories: string[];
  episode: EpisodeInfo | undefined;
  icon: string | undefined;
  date: string | undefined;
  country: string | undefined;
  isNew: boolean;
  premiere: boolean;
  previouslyShown: boolean;
  live: boolean;
}

interface ChannelDraft {
  readonly id: string | undefined;
  readonly line: number;
  displayNames: string[];
  icon: string | undefined;
  url: string | undefined;
}

/** Elements whose text we read; everything else inside a programme is skipped. */
const TEXT_ELEMENTS = new Set([
  "title",
  "sub-title",
  "desc",
  "category",
  "episode-num",
  "date",
  "country",
  "display-name",
  "url",
  "premiere",
]);

const attribute = (tag: SaxesTagPlain, name: string): string | undefined => {
  const value = tag.attributes[name];
  return typeof value === "string" ? value : undefined;
};

const collapse = (text: string) => text.replace(/\s+/g, " ").trim();

/** Reads `encoding="..."` from an XML declaration at the start of the first chunk. */
const declaredEncoding = (head: Uint8Array): string => {
  const prefix = new TextDecoder("latin1").decode(head.subarray(0, 200));
  const match = /^\s*<\?xml[^>]*\bencoding\s*=\s*["']([\w.:-]+)["']/i.exec(prefix);
  return match?.[1] ?? "utf-8";
};

const makeDecoder = (label: string): TextDecoder => {
  try {
    return new TextDecoder(label);
  } catch {
    return new TextDecoder("utf-8");
  }
};

/** A push parser: feed it chunks, collect the events each chunk completed. */
export interface XmltvPushParser {
  /** Feeds bytes or already decoded text; returns the events completed by this chunk. */
  readonly write: (chunk: Uint8Array | string) => ReadonlyArray<XmltvEvent>;
  /** Signals end of input; returns the remaining events. */
  readonly end: () => ReadonlyArray<XmltvEvent>;
}

/**
 * Creates a push parser. Throws `XmltvFormatError` from `write`/`end` when the root element is
 * not `<tv>` or the input ends before any element; wrap it with {@link parseXmltvStream} to get
 * that as a typed failure instead.
 */
export const makeXmltvParser = (options: XmltvParseOptions = {}): XmltvPushParser => {
  const preferred = (options.preferredLanguages ?? []).map((lang) => lang.toLowerCase());
  const maxIssues = options.maxIssues ?? 100;
  const sax = new SaxesParser<{ xmlns: false; position: true }>({ xmlns: false, position: true });
  sax.ENTITIES = Object.assign(
    Object.create(sax.ENTITIES) as Record<string, string>,
    EXTRA_ENTITIES,
  );

  let out: XmltvEvent[] = [];
  let issueCount = 0;
  let depth = 0;
  let sawRoot = false;
  let fatal: XmltvFormatError | undefined;
  let channel: ChannelDraft | undefined;
  let programme: ProgrammeDraft | undefined;
  /** Name, attributes and text of the direct child of a channel/programme being read. */
  let field: { name: string; tag: SaxesTagPlain; text: string } | undefined;
  let decoder: TextDecoder | undefined;

  const issue = (message: string, line?: number) => {
    issueCount++;
    if (issueCount <= maxIssues) out.push({ _tag: "Issue", message, line });
  };

  const pick = (candidates: ReadonlyArray<LangText>): LangText | undefined => {
    for (const lang of preferred) {
      const found = candidates.find((candidate) => candidate.lang?.toLowerCase() === lang);
      if (found) return found;
    }
    return candidates[0];
  };

  const finishProgramme = (draft: ProgrammeDraft) => {
    const start = parseXmltvTime(draft.startRaw);
    const stop = parseXmltvTime(draft.stopRaw);
    const title = pick(draft.titles);
    if (draft.channel === undefined || draft.channel === "") {
      return issue("programme without a channel skipped", draft.line);
    }
    if (start === undefined) {
      return issue(
        `programme on ${draft.channel} skipped: unreadable start "${draft.startRaw ?? ""}"`,
        draft.line,
      );
    }
    if (draft.stopRaw !== undefined && stop === undefined) {
      issue(
        `programme on ${draft.channel}: unreadable stop "${draft.stopRaw}" ignored`,
        draft.line,
      );
    }
    if (stop !== undefined && stop <= start) {
      return issue(`programme on ${draft.channel} skipped: stop is not after start`, draft.line);
    }
    out.push({
      _tag: "Programme",
      channel: draft.channel,
      start,
      stop,
      title: title?.text ?? "",
      subTitle: pick(draft.subTitles)?.text,
      description: pick(draft.descriptions)?.text,
      categories: draft.categories,
      episode: draft.episode,
      icon: draft.icon,
      date: draft.date,
      country: draft.country,
      language: title?.lang,
      isNew: draft.isNew,
      premiere: draft.premiere,
      previouslyShown: draft.previouslyShown,
      live: draft.live,
    });
  };

  const finishChannel = (draft: ChannelDraft) => {
    if (draft.id === undefined || draft.id === "") {
      return issue("channel without an id skipped", draft.line);
    }
    out.push({
      _tag: "Channel",
      id: draft.id,
      displayNames: draft.displayNames,
      icon: draft.icon,
      url: draft.url,
    });
  };

  const finishField = (name: string, tag: SaxesTagPlain, rawText: string) => {
    const text = collapse(rawText);
    const lang = attribute(tag, "lang");
    if (programme) {
      switch (name) {
        case "title":
          if (text !== "") programme.titles.push({ lang, text });
          return;
        case "sub-title":
          if (text !== "") programme.subTitles.push({ lang, text });
          return;
        case "desc":
          if (text !== "") programme.descriptions.push({ lang, text });
          return;
        case "category":
          if (text !== "" && !programme.categories.includes(text)) programme.categories.push(text);
          return;
        case "episode-num":
          programme.episode = mergeEpisodeNum(programme.episode, attribute(tag, "system"), text);
          return;
        case "icon":
          programme.icon ??= attribute(tag, "src");
          return;
        case "date":
          if (text !== "") programme.date ??= text;
          return;
        case "country":
          if (text !== "") programme.country ??= text;
          return;
        case "new":
          programme.isNew = true;
          return;
        case "premiere":
          programme.premiere = true;
          return;
        case "previously-shown":
          programme.previouslyShown = true;
          return;
        case "live":
          programme.live = true;
          return;
        default:
          return;
      }
    }
    if (channel) {
      switch (name) {
        case "display-name":
          if (text !== "") channel.displayNames.push(text);
          return;
        case "icon":
          channel.icon ??= attribute(tag, "src");
          return;
        case "url":
          if (text !== "") channel.url ??= text;
          return;
        default:
          return;
      }
    }
  };

  sax.on("error", (error) => {
    issue(`malformed XML: ${error.message.replace(/^\d+:\d+: /, "")}`, sax.line);
  });

  sax.on("opentag", (tag) => {
    depth++;
    if (!sawRoot) {
      sawRoot = true;
      if (tag.name !== "tv") {
        fatal = new XmltvFormatError({
          message: `not an XMLTV document: root element is <${tag.name}>, expected <tv>`,
        });
      }
      return;
    }
    if (depth === 2) {
      if (tag.name === "programme") {
        programme = {
          channel: attribute(tag, "channel")?.trim(),
          startRaw: attribute(tag, "start"),
          stopRaw: attribute(tag, "stop"),
          line: sax.line,
          titles: [],
          subTitles: [],
          descriptions: [],
          categories: [],
          episode: undefined,
          icon: undefined,
          date: undefined,
          country: undefined,
          isNew: false,
          premiere: false,
          previouslyShown: false,
          live: false,
        };
      } else if (tag.name === "channel") {
        channel = {
          id: attribute(tag, "id")?.trim(),
          line: sax.line,
          displayNames: [],
          icon: undefined,
          url: undefined,
        };
      }
      return;
    }
    if (depth === 3 && (programme || channel)) {
      field = { name: tag.name, tag, text: "" };
    }
  });

  const onText = (text: string) => {
    if (field && depth === 3 && TEXT_ELEMENTS.has(field.name)) field.text += text;
  };
  sax.on("text", onText);
  sax.on("cdata", onText);

  sax.on("closetag", (tag) => {
    if (depth === 3 && field && field.name === tag.name) {
      finishField(field.name, field.tag, field.text);
      field = undefined;
    } else if (depth === 2) {
      if (programme && tag.name === "programme") finishProgramme(programme);
      else if (channel && tag.name === "channel") finishChannel(channel);
      programme = undefined;
      channel = undefined;
    }
    depth--;
  });

  const drain = (): ReadonlyArray<XmltvEvent> => {
    if (fatal) throw fatal;
    const events = out;
    out = [];
    return events;
  };

  /** Text seen before the first element, to recognise web pages and JSON early. */
  let head: string | undefined = "";
  const feed = (text: string, final: boolean) => {
    if (head !== undefined) {
      head += text;
      // `\s` also matches a byte order mark.
      const start = head.replace(/^\s+/, "");
      if (start.length < 15 && !final) return;
      head = undefined;
      if (/^<(?:!doctype\s+html|html[\s>])/i.test(start)) {
        fatal = new XmltvFormatError({ message: "not an XMLTV document: got a web page" });
        return;
      }
      if (start !== "" && !start.startsWith("<")) {
        fatal = new XmltvFormatError({
          message: `not an XMLTV document: starts with "${start.slice(0, 15)}"`,
        });
        return;
      }
      if (start !== "") sax.write(start);
      return;
    }
    if (text !== "") sax.write(text);
  };

  return {
    write: (chunk) => {
      if (fatal) throw fatal;
      let text: string;
      if (typeof chunk === "string") {
        text = chunk;
      } else {
        decoder ??= makeDecoder(declaredEncoding(chunk));
        text = decoder.decode(chunk, { stream: true });
      }
      feed(text, false);
      return drain();
    },
    end: () => {
      if (fatal) throw fatal;
      feed(decoder?.decode() ?? "", true);
      if (fatal) throw fatal;
      sax.close();
      if (!sawRoot) {
        fatal = new XmltvFormatError({ message: "not an XMLTV document: no root element" });
      }
      if (issueCount > maxIssues) {
        out.push({
          _tag: "Issue",
          message: `${issueCount - maxIssues} more issues not shown`,
          line: undefined,
        });
      }
      return drain();
    },
  };
};

const guard = (run: () => ReadonlyArray<XmltvEvent>) =>
  Effect.try({
    try: run,
    catch: (error) =>
      error instanceof XmltvFormatError
        ? error
        : new XmltvFormatError({ message: `XMLTV parser failed: ${String(error)}` }),
  });

/**
 * Parses a byte (or text) stream of XMLTV into events, holding only the element being read.
 */
export const parseXmltvStream = <E, R>(
  input: Stream.Stream<Uint8Array | string, E, R>,
  options?: XmltvParseOptions,
): Stream.Stream<XmltvEvent, E | XmltvFormatError, R> =>
  Stream.suspend(() => {
    const parser = makeXmltvParser(options);
    return input.pipe(
      Stream.mapEffect((chunk) => guard(() => parser.write(chunk))),
      Stream.concat(Stream.fromEffect(guard(() => parser.end()))),
      Stream.flattenIterable,
    );
  });

/** A whole guide in memory. Use {@link parseXmltvStream} for feeds you only fold over. */
export interface XmltvGuide {
  readonly channels: ReadonlyArray<XmltvChannel>;
  readonly programmes: ReadonlyArray<XmltvProgramme>;
  readonly issues: ReadonlyArray<XmltvIssue>;
}

/**
 * Collects a parsed XMLTV stream into channels, programmes and issues.
 */
export const collectXmltv = <E, R>(
  events: Stream.Stream<XmltvEvent, E, R>,
): Effect.Effect<XmltvGuide, E, R> =>
  Stream.runFold(
    events,
    (): { channels: XmltvChannel[]; programmes: XmltvProgramme[]; issues: XmltvIssue[] } => ({
      channels: [],
      programmes: [],
      issues: [],
    }),
    (guide, event) => {
      switch (event._tag) {
        case "Channel":
          guide.channels.push(event);
          break;
        case "Programme":
          guide.programmes.push(event);
          break;
        case "Issue":
          guide.issues.push(event);
          break;
      }
      return guide;
    },
  );

/**
 * Parses a complete XMLTV document held in memory (fixtures, small feeds).
 */
export const parseXmltv = (
  xml: string,
  options?: XmltvParseOptions,
): Effect.Effect<XmltvGuide, XmltvFormatError> =>
  collectXmltv(parseXmltvStream(Stream.make(xml), options));
