/**
 * The M3U + XMLTV source adapter: fetches a playlist and its guide over HTTP with the source's
 * own headers and user agent, timeouts and retries, then parses and cleans them.
 */
import { Context, Data, Duration, Effect, Layer, Schedule, Schema, Stream } from "effect";
import {
  FetchHttpClient,
  HttpClient,
  HttpClientRequest,
  type HttpClientResponse,
} from "effect/http";
import { cleanGuide, compileRewrites, RewriteRule, type CleanupReport } from "./cleanup.ts";
import { mayReceiveHeaders, stripUrl } from "./credentials.ts";
import { parseM3u, type M3uPlaylist } from "./m3u.ts";
import {
  collectXmltv,
  parseXmltvStream,
  type XmltvChannel,
  type XmltvEvent,
  type XmltvIssue,
  type XmltvProgramme,
} from "./xmltv.ts";

const PositiveInt = Schema.Int.pipe(Schema.check(Schema.isGreaterThan(0)));
const NonNegativeInt = Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0)));

/** Settings of one M3U + XMLTV source, as stored with the source. */
export const M3uXmltvConfig = Schema.Struct({
  playlistUrl: Schema.String,
  /** Guide URL; when absent the playlist's `url-tvg` / `x-tvg-url` is used. */
  guideUrl: Schema.optionalKey(Schema.String),
  userAgent: Schema.optionalKey(Schema.String),
  /**
   * Extra request headers, e.g. `Referer` or an auth header. Sent with the playlist, and with
   * the guide only when it is `guideUrl` or on the playlist's origin: a guide URL the playlist
   * names on another host never sees them.
   */
  headers: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
  /** Largest playlist body accepted. Default 50 MB. */
  maxPlaylistBytes: Schema.optionalKey(PositiveInt),
  /** Largest guide accepted, counted after decompression. Default 200 MB. */
  maxGuideBytes: Schema.optionalKey(PositiveInt),
  /** Time allowed for the response to start and between two body chunks. Default 30 s. */
  timeoutMs: Schema.optionalKey(PositiveInt),
  /** Time allowed for a whole guide download. Default 10 min. */
  guideTimeoutMs: Schema.optionalKey(PositiveInt),
  /** Retries after a failed attempt that may succeed later. Default 3. */
  retries: Schema.optionalKey(NonNegativeInt),
  /** First retry delay, doubling (with jitter) after each attempt. Default 1 s. */
  retryBaseDelayMs: Schema.optionalKey(PositiveInt),
  /** Drop duplicate programmes and channels. Default true. */
  removeDuplicates: Schema.optionalKey(Schema.Boolean),
  rewrites: Schema.optionalKey(Schema.Array(RewriteRule)),
  /** Preferred guide languages, e.g. `["de", "en"]`. */
  preferredLanguages: Schema.optionalKey(Schema.Array(Schema.String)),
});

/** A decoded source config. */
export type M3uXmltvConfig = typeof M3uXmltvConfig.Type;

/** Why a source could not be read. */
export type SourceErrorReason =
  | "unreachable"
  | "timeout"
  | "http-status"
  | "invalid-playlist"
  | "invalid-guide"
  | "too-large"
  | "no-guide-url"
  | "invalid-config";

/**
 * A source could not be fetched or parsed. `url` never carries query strings or credentials.
 * A body past its size limit is `too-large`, with `limitBytes` set.
 */
export class SourceError extends Data.TaggedError("SourceError")<{
  readonly reason: SourceErrorReason;
  readonly message: string;
  readonly url?: string | undefined;
  readonly status?: number | undefined;
  /** The size limit the body went past. */
  readonly limitBytes?: number | undefined;
}> {
  /** Whether trying again later may help. */
  get retryable(): boolean {
    return (
      this.reason === "unreachable" ||
      this.reason === "timeout" ||
      (this.reason === "http-status" &&
        this.status !== undefined &&
        (this.status === 408 || this.status === 429 || this.status >= 500))
    );
  }
}

/** A cleaned guide plus what parsing and clean-up reported. */
export interface FetchedGuide {
  readonly url: string;
  readonly channels: ReadonlyArray<XmltvChannel>;
  readonly programmes: ReadonlyArray<XmltvProgramme>;
  readonly issues: ReadonlyArray<XmltvIssue>;
  readonly cleanup: CleanupReport;
}

/** Playlist and guide of one refresh. */
export interface SourceSnapshot {
  readonly playlist: M3uPlaylist;
  readonly guide: FetchedGuide;
}

const DEFAULT_USER_AGENT = "Slipstream/0.0";
const GZIP_MAGIC = [0x1f, 0x8b] as const;

/** Node types the gzip transform's writable side as non-shared buffers only; ours never are. */
const gunzipStream = () =>
  new DecompressionStream("gzip") as ReadableWritablePair<Uint8Array, Uint8Array>;

const MB = 1024 * 1024;

const settings = (config: M3uXmltvConfig) => ({
  timeout: Duration.millis(config.timeoutMs ?? 30_000),
  guideTimeout: Duration.millis(config.guideTimeoutMs ?? 600_000),
  maxPlaylistBytes: config.maxPlaylistBytes ?? 50 * MB,
  maxGuideBytes: config.maxGuideBytes ?? 200 * MB,
  retry: {
    times: config.retries ?? 3,
    schedule: Schedule.exponential(Duration.millis(config.retryBaseDelayMs ?? 1000)).pipe(
      Schedule.jittered,
    ),
    while: (error: SourceError) => error.retryable,
  },
});

/** Redirects a fetch follows before it gives up. */
const MAX_REDIRECTS = 5;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/**
 * The URL whose origin may receive the source's own headers (which may carry credentials) while
 * fetching `url`: the guide URL the admin configured is trusted on its own origin, everything
 * else only on the playlist's. A guide URL taken from the playlist's `url-tvg` can point
 * anywhere, so off the playlist's origin it gets the user agent only.
 */
const headerOrigin = (config: M3uXmltvConfig, url: string): string =>
  config.guideUrl !== undefined && url === config.guideUrl ? config.guideUrl : config.playlistUrl;

/** A GET of `url` with the source's headers when `url` is on `origin` (see `headerOrigin`). */
const buildRequest = (config: M3uXmltvConfig, url: string, origin: string) =>
  HttpClientRequest.get(url).pipe(
    HttpClientRequest.setHeaders({
      "user-agent": config.userAgent ?? DEFAULT_USER_AGENT,
      accept: "*/*",
      ...(mayReceiveHeaders(origin, url) ? config.headers : undefined),
    }),
  );

/** The next hop of a redirect response, resolved against the URL that answered it. */
const redirectTarget = (
  response: HttpClientResponse.HttpClientResponse,
  from: string,
): string | undefined => {
  const location = response.headers["location"];
  if (!REDIRECT_STATUSES.has(response.status) || location === undefined) return undefined;
  try {
    return new URL(location, from).href;
  } catch {
    return undefined;
  }
};

const tooLarge = (url: string, what: "playlist" | "guide", limitBytes: number) =>
  new SourceError({
    reason: "too-large",
    message: `${what} from ${stripUrl(url)} is larger than ${Math.round(limitBytes / MB)} MB`,
    url: stripUrl(url),
    limitBytes,
  });

/** Passes `bytes` through, failing once more than `limitBytes` went by. */
const capBytes = <E>(
  bytes: Stream.Stream<Uint8Array, E>,
  limitBytes: number,
  onExceeded: () => SourceError,
): Stream.Stream<Uint8Array, E | SourceError> =>
  Stream.suspend(() => {
    let total = 0;
    return bytes.pipe(
      Stream.mapEffect((chunk) => {
        total += chunk.byteLength;
        return total > limitBytes ? Effect.fail(onExceeded()) : Effect.succeed(chunk);
      }),
    );
  });

/** Fails before reading the body when the server announces one past the limit. */
const checkDeclaredLength = (
  response: HttpClientResponse.HttpClientResponse,
  limitBytes: number,
  onExceeded: () => SourceError,
): Effect.Effect<void, SourceError> => {
  const declared = Number(response.headers["content-length"]);
  return Number.isFinite(declared) && declared > limitBytes
    ? Effect.fail(onExceeded())
    : Effect.void;
};

/** Reads a whole body as UTF-8, at most `limitBytes` of it. */
const readText = <E>(
  bytes: Stream.Stream<Uint8Array, E>,
  limitBytes: number,
  onExceeded: () => SourceError,
): Effect.Effect<string, E | SourceError> =>
  Effect.suspend(() => {
    const decoder = new TextDecoder();
    let text = "";
    return capBytes(bytes, limitBytes, onExceeded).pipe(
      Stream.runForEach((chunk) =>
        Effect.sync(() => {
          text += decoder.decode(chunk, { stream: true });
        }),
      ),
      Effect.map(() => text + decoder.decode()),
    );
  });

const transportError = (url: string) => (error: unknown) =>
  error instanceof SourceError
    ? error
    : new SourceError({
        reason: "unreachable",
        message: `could not reach ${stripUrl(url)}: ${error instanceof Error ? error.message : String(error)}`,
        url: stripUrl(url),
      });

const timeoutError = (url: string, what: string) => () =>
  new SourceError({
    reason: "timeout",
    message: `${what} from ${stripUrl(url)} timed out`,
    url: stripUrl(url),
  });

/**
 * Turns a byte stream into a decompressed one when it starts with the gzip magic bytes, so
 * `guide.xml.gz` works whatever the server says about content types.
 */
export const gunzipIfCompressed = <E>(
  bytes: Stream.Stream<Uint8Array, E>,
  onError: (error: unknown) => E,
): Stream.Stream<Uint8Array, E> =>
  Stream.fromReadableStream({
    evaluate: () => {
      const reader = Stream.toReadableStream(bytes).getReader();
      let output: ReadableStreamDefaultReader<Uint8Array> | undefined;
      const open = async (): Promise<ReadableStreamDefaultReader<Uint8Array>> => {
        const head = await reader.read();
        let pending = head.done ? undefined : head.value;
        const source = new ReadableStream<Uint8Array>({
          pull: async (controller) => {
            if (pending !== undefined) {
              controller.enqueue(pending);
              pending = undefined;
              return;
            }
            const next = await reader.read();
            if (next.done) controller.close();
            else controller.enqueue(next.value);
          },
          cancel: (reason) => reader.cancel(reason),
        });
        const isGzip = pending?.[0] === GZIP_MAGIC[0] && pending[1] === GZIP_MAGIC[1];
        return (isGzip ? source.pipeThrough(gunzipStream()) : source).getReader();
      };
      return new ReadableStream<Uint8Array>({
        pull: async (controller) => {
          output ??= await open();
          const next = await output.read();
          if (next.done) controller.close();
          else controller.enqueue(next.value);
        },
        cancel: (reason) => (output ?? reader).cancel(reason),
      });
    },
    onError,
  });

/** The configured guide URL, else the first one the playlist names. */
const resolveGuideUrl = (
  config: M3uXmltvConfig,
  playlist: M3uPlaylist | undefined,
): Effect.Effect<string, SourceError> => {
  const url = config.guideUrl ?? playlist?.guideUrls[0];
  return url === undefined
    ? Effect.fail(
        new SourceError({
          reason: "no-guide-url",
          message: "no guide URL is set and the playlist does not name one",
        }),
      )
    : Effect.succeed(url);
};

const makeAdapter = Effect.gen(function* () {
  const client = yield* HttpClient.HttpClient;

  /** One GET, redirects not followed: `open` decides on every hop itself. */
  const send = (config: M3uXmltvConfig, url: string, origin: string) =>
    Effect.gen(function* () {
      if (!/^https?:\/\//i.test(url)) {
        return yield* new SourceError({
          reason: "invalid-config",
          message: `only http and https URLs are supported, got ${stripUrl(url)}`,
          url: stripUrl(url),
        });
      }
      return yield* client.execute(buildRequest(config, url, origin)).pipe(
        // `fetch` would follow redirects itself, taking every header along to any host.
        Effect.provideService(FetchHttpClient.RequestInit, { redirect: "manual" }),
        Effect.mapError(transportError(url)),
      );
    });

  /**
   * Sends a GET and fails with a typed error unless the response is 2xx. Redirects are followed
   * here, at most {@link MAX_REDIRECTS} of them, and every hop is checked on its own: the
   * source's headers go only to hops on the origin they belong to, so a redirect to another
   * host never carries them along.
   */
  const open = (
    config: M3uXmltvConfig,
    url: string,
  ): Effect.Effect<HttpClientResponse.HttpClientResponse, SourceError> =>
    Effect.gen(function* () {
      const origin = headerOrigin(config, url);
      let current = url;
      let response = yield* send(config, current, origin);
      for (let hops = 0; ; hops++) {
        const next = redirectTarget(response, current);
        if (next === undefined) break;
        if (hops >= MAX_REDIRECTS) {
          return yield* new SourceError({
            reason: "http-status",
            message: `${stripUrl(url)} redirected more than ${MAX_REDIRECTS} times`,
            url: stripUrl(url),
            status: response.status,
          });
        }
        // The redirect's own body is not needed; reading it frees the connection.
        yield* Effect.ignore(response.text);
        current = next;
        response = yield* send(config, current, origin);
      }
      if (response.status < 200 || response.status >= 300) {
        return yield* new SourceError({
          reason: "http-status",
          message: `${stripUrl(current)} answered HTTP ${response.status}`,
          url: stripUrl(current),
          status: response.status,
        });
      }
      return response;
    }).pipe(
      Effect.timeoutOrElse({
        duration: settings(config).timeout,
        orElse: () => Effect.fail(timeoutError(url, "response")()),
      }),
    );

  const fetchPlaylist = (config: M3uXmltvConfig): Effect.Effect<M3uPlaylist, SourceError> => {
    const { timeout, retry, maxPlaylistBytes } = settings(config);
    const url = config.playlistUrl;
    const exceeded = () => tooLarge(url, "playlist", maxPlaylistBytes);
    return Effect.gen(function* () {
      const response = yield* open(config, url);
      yield* checkDeclaredLength(response, maxPlaylistBytes, exceeded);
      const text = yield* readText(
        response.stream.pipe(Stream.mapError(transportError(url))),
        maxPlaylistBytes,
        exceeded,
      ).pipe(
        Effect.timeoutOrElse({
          duration: timeout,
          orElse: () => Effect.fail(timeoutError(url, "playlist")()),
        }),
      );
      const playlist = parseM3u(text);
      if (playlist.entries.length === 0) {
        const looksLikeHtml = /^\s*<(?:!doctype|html)/i.test(text);
        return yield* new SourceError({
          reason: "invalid-playlist",
          message: looksLikeHtml
            ? `${stripUrl(url)} returned a web page, not a playlist`
            : `${stripUrl(url)} contains no streams`,
          url: stripUrl(url),
        });
      }
      return playlist;
    }).pipe(Effect.retry(retry));
  };

  /**
   * The guide's events as its body arrives. Not retried here: the caller retries the whole
   * download, since a body that fails halfway has already emitted events.
   */
  const streamGuideFrom = (
    config: M3uXmltvConfig,
    url: string,
  ): Stream.Stream<XmltvEvent, SourceError> => {
    const { timeout, maxGuideBytes } = settings(config);
    const exceeded = () => tooLarge(url, "guide", maxGuideBytes);
    const bytes = Stream.unwrap(
      open(config, url).pipe(
        Effect.tap((response) => checkDeclaredLength(response, maxGuideBytes, exceeded)),
        Effect.map((response) =>
          response.stream.pipe(
            Stream.mapError(transportError(url)),
            Stream.timeoutOrElse({
              duration: timeout,
              orElse: () => Stream.fail(timeoutError(url, "guide data")()),
            }),
          ),
        ),
      ),
    );
    // Counted after decompression, so a small gzip that inflates without end is cut off too.
    const xml = capBytes(gunzipIfCompressed(bytes, transportError(url)), maxGuideBytes, exceeded);
    return parseXmltvStream(xml, {
      preferredLanguages: config.preferredLanguages,
    }).pipe(
      Stream.mapError((error) =>
        error instanceof SourceError
          ? error
          : new SourceError({
              reason: "invalid-guide",
              message: `${stripUrl(url)}: ${error.message}`,
              url: stripUrl(url),
            }),
      ),
    );
  };

  const fetchGuideFrom = (
    config: M3uXmltvConfig,
    url: string,
  ): Effect.Effect<FetchedGuide, SourceError> => {
    const { guideTimeout, retry } = settings(config);
    return Effect.gen(function* () {
      const rewrites = yield* compileRewrites(config.rewrites ?? []).pipe(
        Effect.mapError(
          (error) =>
            new SourceError({
              reason: "invalid-config",
              message: `rewrite rule ${error.index + 1}: ${error.message}`,
            }),
        ),
      );
      const parsed = yield* collectXmltv(streamGuideFrom(config, url)).pipe(
        Effect.timeoutOrElse({
          duration: guideTimeout,
          orElse: () => Effect.fail(timeoutError(url, "guide download")()),
        }),
        // A failed connect, or a body that fails halfway, is fetched again from the start.
        Effect.retry(retry),
      );
      const cleaned = cleanGuide(parsed, {
        removeDuplicates: config.removeDuplicates,
        rewrites,
      });
      return {
        url: stripUrl(url),
        channels: cleaned.channels,
        programmes: cleaned.programmes,
        issues: parsed.issues,
        cleanup: cleaned.report,
      };
    });
  };

  return {
    fetchPlaylist,
    /** Downloads, parses and cleans the guide, retrying the whole download on failure. */
    fetchGuide: (config: M3uXmltvConfig, playlist?: M3uPlaylist) =>
      resolveGuideUrl(config, playlist).pipe(Effect.flatMap((url) => fetchGuideFrom(config, url))),
    /** Playlist first (it may name the guide URL), then the guide. */
    refresh: (config: M3uXmltvConfig): Effect.Effect<SourceSnapshot, SourceError> =>
      Effect.gen(function* () {
        const playlist = yield* fetchPlaylist(config);
        const url = yield* resolveGuideUrl(config, playlist);
        const guide = yield* fetchGuideFrom(config, url);
        return { playlist, guide };
      }),
  };
});

/** Fetches and parses M3U + XMLTV sources. Needs an `HttpClient`. */
export class M3uXmltvSource extends Context.Service<
  M3uXmltvSource,
  Effect.Success<typeof makeAdapter>
>()("@slipstream/sources/M3uXmltvSource") {
  static readonly layer = Layer.effect(M3uXmltvSource, makeAdapter);
}
