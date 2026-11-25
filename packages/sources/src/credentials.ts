/**
 * Where a source's credentials may go and where they must never show. IPTV URLs routinely carry
 * logins and tokens (user info, query values, Xtream-style path segments), and sources may have
 * secret request headers. These rules decide which requests get those headers (only the source's
 * own origin) and what a log line or a stored id must have masked or stripped.
 */
import { redactedMark, type SourceConfig } from "@slipstream/domain";

const decoded = (segment: string) => {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
};

/**
 * Strips credentials, query and fragment from a URL so it can appear in logs and the UI
 * (IPTV URLs routinely carry tokens). Path segments equal to one of `secrets` (Xtream-style
 * `/live/<user>/<password>/1.ts`) are masked too. Unlike the domain's `redactUrl`, which keeps
 * a URL's shape for an admin to recognise, this drops everything that may change or hide a
 * credential, so the result is also stable enough to hash into an id.
 */
export const stripUrl = (url: string, secrets: ReadonlyArray<string> = []): string => {
  try {
    const parsed = new URL(url);
    const hidden = new Set(secrets.filter((secret) => secret !== ""));
    const path = parsed.pathname
      .split("/")
      .map((segment) =>
        segment !== "" && (hidden.has(segment) || hidden.has(decoded(segment)))
          ? redactedMark
          : segment,
      )
      .join("/");
    return `${parsed.protocol}//${parsed.host}${path}`;
  } catch {
    return "(invalid URL)";
  }
};

const URL_IN_TEXT = /[a-z][a-z0-9+.-]*:\/\/[^\s'"<>]+/gi;

/** Secrets shorter than this are masked only inside URLs, where they are whole segments. */
const MIN_BARE_SECRET = 4;

/**
 * Text that mentions URLs (an ffmpeg log line, an error) with every URL redacted by
 * {@link stripUrl} and every other occurrence of a secret masked.
 */
export const redactSecrets = (text: string, secrets: ReadonlyArray<string>): string => {
  const urls = text.replaceAll(URL_IN_TEXT, (url) => stripUrl(url, secrets));
  return secrets
    .filter((secret) => secret.length >= MIN_BARE_SECRET)
    .toSorted((a, b) => b.length - a.length)
    .reduce((redacted, secret) => redacted.replaceAll(secret, redactedMark), urls);
};

/**
 * Whether a source's secret headers may go to `url`: it shares scheme, host and port with
 * `originUrl`, the URL the source is configured with (or a URL the admin configured on its own,
 * like a guide URL). Anything else (a CDN, a host the playlist names) gets the plain headers only.
 */
export const mayReceiveHeaders = (originUrl: string, url: string): boolean => {
  try {
    return new URL(url).origin === new URL(originUrl).origin;
  } catch {
    return false;
  }
};

/** The URL a source is configured with: where its playlist (or device, or server) lives. */
export const homeUrl = (config: SourceConfig): string => {
  switch (config._tag) {
    case "M3u":
      return config.playlistUrl;
    case "Xtream":
      return config.serverUrl;
    case "HdHomeRun":
      return config.deviceUrl;
    case "Url":
      return config.streamUrl;
  }
};

/** What of a source decides a stream request's headers and what its log lines must hide. */
export interface StreamCredentials {
  readonly config: SourceConfig;
  readonly headers?: Readonly<Record<string, string>> | undefined;
  readonly secretHeaders?: Readonly<Record<string, string>> | undefined;
}

/**
 * The request headers ffmpeg sends for one of a source's streams. The secret headers (which may
 * carry credentials) go only to a stream on the source's own origin, like the playlist fetch's; a
 * stream on another host (a CDN, a provider the playlist links to) gets the plain headers only.
 *
 * ffmpeg follows HTTP redirects itself and sends the same headers to every hop, so a same-origin
 * stream that redirects elsewhere still takes them along: the check covers the URL ffmpeg is
 * given, which is the one the source's playlist named.
 */
export const streamRequestHeaders = (
  source: StreamCredentials,
  streamUrl: string,
): Record<string, string> =>
  mayReceiveHeaders(homeUrl(source.config), streamUrl)
    ? { ...source.headers, ...source.secretHeaders }
    : { ...source.headers };

/** User name, password and query values of a URL, decoded. */
const urlSecrets = (url: string): Array<string> => {
  try {
    const parsed = new URL(url);
    return [decoded(parsed.username), decoded(parsed.password), ...parsed.searchParams.values()];
  } catch {
    return [];
  }
};

/**
 * Everything that must never show in a log line about one of a source's streams: credentials in
 * the stream's and the source's URLs (user info, query values), the Xtream login and the secret
 * header values.
 */
export const streamSecrets = (
  source: Pick<StreamCredentials, "config" | "secretHeaders">,
  streamUrl: string,
): Array<string> => {
  const { config } = source;
  return [
    ...new Set([
      ...urlSecrets(streamUrl),
      ...urlSecrets(homeUrl(config)),
      ...(config._tag === "Xtream" ? [config.username, config.password] : []),
      ...Object.values(source.secretHeaders ?? {}),
    ]),
  ].filter((secret) => secret !== "");
};
