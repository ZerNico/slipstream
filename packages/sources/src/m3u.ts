/**
 * M3U / M3U8 playlist parsing for IPTV sources.
 *
 * Real playlists are messy: BOMs, CRLF, missing `#EXTM3U`, unquoted or single-quoted attribute
 * values, commas inside quoted values, stray quotes inside names, `#EXTGRP` groups and
 * `#EXTVLCOPT` headers. The parser never throws; anything it cannot make sense of becomes an
 * issue on the result and parsing carries on with the next line.
 *
 * Stream URLs end up as ffmpeg inputs, so only http and https ones become entries; `file://`,
 * `udp://`, `rtsp://` and the like are skipped and reported as issues.
 *
 * Catch-up (provider archive) attributes are not read: nothing plays a provider archive yet.
 * They stay in `attributes` for when something does.
 */

/** One stream in a playlist. */
export interface M3uEntry {
  /** Display name: the text after the `#EXTINF` comma, falling back to `tvg-name`, then the URL. */
  readonly name: string;
  readonly url: string;
  /** `#EXTINF` duration in seconds; `-1` for live streams. */
  readonly duration: number;
  readonly tvgId?: string | undefined;
  readonly tvgName?: string | undefined;
  readonly tvgLogo?: string | undefined;
  /** `group-title`, or the last `#EXTGRP` seen before the entry. */
  readonly groupTitle?: string | undefined;
  /** `tvg-chno` or `channel-number`, kept as written. */
  readonly channelNumber?: string | undefined;
  /** From `#EXTVLCOPT:http-user-agent=` or a `user-agent` attribute; captures send it. */
  readonly userAgent?: string | undefined;
  /** From `#EXTVLCOPT:http-referrer=` or a `referrer` attribute; captures send it. */
  readonly referrer?: string | undefined;
  /** Every attribute as written on the `#EXTINF` line, lower-cased keys. */
  readonly attributes: Readonly<Record<string, string>>;
  /** 1-based line number of the URL line, for error messages. */
  readonly line: number;
}

/** Something the parser skipped or had to guess at. */
export interface M3uIssue {
  readonly line: number;
  readonly message: string;
}

/** A parsed playlist. */
export interface M3uPlaylist {
  /** Guide URLs from `url-tvg` / `x-tvg-url` on the header (comma separated values split). */
  readonly guideUrls: ReadonlyArray<string>;
  /** Attributes of the `#EXTM3U` header line. */
  readonly attributes: Readonly<Record<string, string>>;
  readonly entries: ReadonlyArray<M3uEntry>;
  readonly issues: ReadonlyArray<M3uIssue>;
}

const isSpace = (code: number) => code === 32 || code === 9;
const KEY_CHAR = /[\w.:-]/;

/**
 * Reads `key="value"` / `key='value'` / `key=value` pairs. Stops at the first comma outside a
 * value, which separates attributes from the display name. A closing quote only counts when
 * followed by whitespace, a comma or the end, so `tvg-name="Foo "HD""` keeps its inner quotes.
 */
export const parseAttributes = (
  text: string,
): { readonly attributes: Record<string, string>; readonly rest: string | undefined } => {
  const attributes: Record<string, string> = {};
  let index = 0;
  const length = text.length;
  while (index < length) {
    while (index < length && isSpace(text.charCodeAt(index))) index++;
    if (index >= length) break;
    if (text[index] === ",") return { attributes, rest: text.slice(index + 1) };
    const keyStart = index;
    while (index < length && KEY_CHAR.test(text[index] ?? "")) index++;
    const key = text.slice(keyStart, index).toLowerCase();
    if (key === "" || text[index] !== "=") {
      // Not an attribute: either junk before the comma, or a name without a comma at all.
      const comma = text.indexOf(",", keyStart);
      const junkEnd = comma === -1 ? length : comma;
      const junk = text.slice(keyStart, junkEnd);
      if (comma === -1) return { attributes, rest: junk.trim() === "" ? undefined : junk };
      index = comma;
      continue;
    }
    index++;
    const quote = text[index];
    let value: string;
    if (quote === '"' || quote === "'") {
      index++;
      let end = index;
      for (;;) {
        const next = text.indexOf(quote, end);
        if (next === -1) {
          end = length;
          break;
        }
        const after = text[next + 1];
        if (after === undefined || after === "," || isSpace(after.charCodeAt(0))) {
          end = next;
          break;
        }
        end = next + 1;
      }
      value = text.slice(index, end);
      index = Math.min(end + 1, length);
    } else {
      const start = index;
      while (index < length && !isSpace(text.charCodeAt(index)) && text[index] !== ",") index++;
      value = text.slice(start, index);
    }
    attributes[key] = value.trim();
  }
  return { attributes, rest: undefined };
};

const nonEmpty = (value: string | undefined): string | undefined => {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed === "" ? undefined : trimmed;
};

const splitUrls = (value: string | undefined): string[] =>
  value === undefined
    ? []
    : value
        .split(",")
        .map((url) => url.trim())
        .filter((url) => url !== "");

interface PendingInfo {
  readonly duration: number;
  readonly name: string | undefined;
  readonly attributes: Record<string, string>;
  readonly line: number;
}

/**
 * Parses an M3U playlist. Never throws: unparseable lines are reported in `issues`.
 */
export const parseM3u = (input: string): M3uPlaylist => {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const lines = text.split(/\r\n|\r|\n/);
  const entries: M3uEntry[] = [];
  const issues: M3uIssue[] = [];
  let header: Record<string, string> = {};
  let sawHeader = false;
  let pending: PendingInfo | undefined;
  let group: string | undefined;
  let userAgent: string | undefined;
  let referrer: string | undefined;

  for (const [index, raw] of lines.entries()) {
    const lineNumber = index + 1;
    const line = raw.trim();
    if (line === "") continue;

    if (line.startsWith("#")) {
      const upper = line.slice(0, 12).toUpperCase();
      if (upper.startsWith("#EXTM3U")) {
        if (sawHeader || entries.length > 0 || pending !== undefined) {
          issues.push({ line: lineNumber, message: "repeated #EXTM3U header ignored" });
          continue;
        }
        sawHeader = true;
        header = parseAttributes(line.slice(7)).attributes;
        continue;
      }
      if (upper.startsWith("#EXTINF:")) {
        if (pending !== undefined) {
          issues.push({ line: pending.line, message: "#EXTINF without a stream URL skipped" });
        }
        const body = line.slice(8);
        const durationMatch = /^\s*(-?\d+(?:\.\d+)?)/.exec(body);
        const duration = durationMatch ? Number(durationMatch[1]) : -1;
        const afterDuration = durationMatch ? body.slice(durationMatch[0].length) : body;
        const { attributes, rest } = parseAttributes(afterDuration);
        pending = { duration, name: nonEmpty(rest), attributes, line: lineNumber };
        continue;
      }
      if (upper.startsWith("#EXTGRP:")) {
        group = nonEmpty(line.slice(8));
        continue;
      }
      if (upper.startsWith("#EXTVLCOPT:")) {
        const option = line.slice(11);
        const separator = option.indexOf("=");
        if (separator === -1) continue;
        const key = option.slice(0, separator).trim().toLowerCase();
        const value = nonEmpty(option.slice(separator + 1));
        if (key === "http-user-agent") userAgent = value;
        else if (key === "http-referrer" || key === "http-referer") referrer = value;
        continue;
      }
      // #EXT-X-*, #KODIPROP, #PLAYLIST and plain comments carry nothing we use.
      continue;
    }

    const url = line;
    if (!/^[a-z][a-z0-9+.-]*:\/\/\S+$/i.test(url)) {
      // Keep any pending #EXTINF: the real URL may still follow on the next line.
      issues.push({ line: lineNumber, message: `not a stream URL: ${url.slice(0, 80)}` });
      continue;
    }
    if (!/^https?:\/\//i.test(url)) {
      // `file://`, `udp://`, `rtsp://` and the like: ffmpeg must never be pointed at them from a
      // provider's playlist. The entry is dropped together with its #EXTINF.
      const scheme = url.slice(0, url.indexOf(":")).toLowerCase();
      issues.push({
        line: lineNumber,
        message: `stream URL skipped: only http and https are supported, got ${scheme}:`,
      });
      pending = undefined;
      group = undefined;
      userAgent = undefined;
      referrer = undefined;
      continue;
    }
    const info = pending;
    const attributes = info?.attributes ?? {};
    const tvgName = nonEmpty(attributes["tvg-name"]);
    entries.push({
      name: info?.name ?? tvgName ?? url,
      url,
      duration: info?.duration ?? -1,
      tvgId: nonEmpty(attributes["tvg-id"]),
      tvgName,
      tvgLogo: nonEmpty(attributes["tvg-logo"] ?? attributes["logo"]),
      groupTitle: nonEmpty(attributes["group-title"]) ?? group,
      channelNumber: nonEmpty(attributes["tvg-chno"] ?? attributes["channel-number"]),
      userAgent: userAgent ?? nonEmpty(attributes["user-agent"] ?? attributes["http-user-agent"]),
      referrer: referrer ?? nonEmpty(attributes["referrer"] ?? attributes["http-referrer"]),
      attributes,
      line: lineNumber,
    });
    pending = undefined;
    group = undefined;
    userAgent = undefined;
    referrer = undefined;
  }

  if (pending !== undefined) {
    issues.push({ line: pending.line, message: "#EXTINF without a stream URL skipped" });
  }
  if (!sawHeader && entries.length > 0) {
    issues.unshift({ line: 1, message: "missing #EXTM3U header" });
  }

  return {
    guideUrls: [...new Set([...splitUrls(header["url-tvg"]), ...splitUrls(header["x-tvg-url"])])],
    attributes: header,
    entries,
    issues,
  };
};
