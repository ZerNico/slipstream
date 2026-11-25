/**
 * Bootstrap configuration from environment variables (PLAN section 8): where data lives, how the
 * server is reached, and which proxies to trust. Everything else is configured in the UI.
 */
import { resolve } from "node:path";
import { siblingFfprobe } from "@slipstream/recorder";
import { Config, Context, Layer, Result, Schema } from "effect";
import { IpNetwork } from "effect/net";

const isTimeZone = (zone: string): boolean => {
  try {
    return new Intl.DateTimeFormat("en", { timeZone: zone }).resolvedOptions().timeZone !== "";
  } catch {
    return false;
  }
};

/** An absolute http(s) origin, optionally with a path prefix, without a trailing slash. */
const PublicUrl = Schema.String.check(
  Schema.isPattern(/^https?:\/\/[^\s/?#]+(?:\/[^\s?#]*[^\s/?#])?$/, {
    title: "http(s) URL without query or trailing slash",
  }),
);

const TimeZone = Schema.String.check(
  Schema.makeFilter((zone: string) => isTimeZone(zone) || "unknown IANA time zone"),
);

/** Comma-separated CIDR ranges or addresses, e.g. `10.0.0.0/8, 172.16.0.0/12, ::1`. */
const ProxyList = Schema.String.check(
  Schema.makeFilter((value: string) =>
    splitList(value).every((entry) => Result.isSuccess(IpNetwork.fromString(withPrefix(entry))))
      ? undefined
      : "expected comma-separated IP addresses or CIDR ranges",
  ),
);

const splitList = (value: string): Array<string> =>
  value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "");

const withPrefix = (entry: string): string =>
  entry.includes("/") ? entry : entry.includes(":") ? `${entry}/128` : `${entry}/32`;

/** The resolved bootstrap settings. Paths are absolute. */
export interface ServerSettings {
  readonly host: string;
  readonly port: number;
  /** SQLite database, its pre-migration backups, and other small state. */
  readonly configDir: string;
  /** The segment store. */
  readonly dataDir: string;
  /** How people reach the server, e.g. `https://tv.example.com`; used for links and cookies. */
  readonly publicUrl: string | undefined;
  /** Proxies whose `X-Forwarded-*` headers are believed. Empty trusts nobody. */
  readonly trustedProxies: ReadonlyArray<IpNetwork.IpNetwork>;
  /** A built web app (`apps/web/dist`) to serve with SPA fallback; absent serves only the API. */
  readonly webDir: string | undefined;
  /** The household time zone: weekdays in rules and dates in group paths are read in it. */
  readonly timeZone: string;
  /** How often the source scheduler looks for sources that are due. */
  readonly sourceCheckIntervalMillis: number;
  /** The ffmpeg binary for captures, hardware detection and the system page. */
  readonly ffmpegPath: string;
  /** The ffprobe binary, for stream information. */
  readonly ffprobePath: string;
  /** Free space the disk guard keeps on the segment store: DVR windows shrink first, then retention. */
  readonly freeSpaceFloorBytes: number;
  /** Announce the server on the local network (mDNS / DNS-SD `_slipstream._tcp`). */
  readonly advertise: boolean;
  /** Run the ffmpeg self-check and hardware encoder detection in the background on startup. */
  readonly startupChecks: boolean;
  /** Capture and scheduling tuning; defaults suit production, tests shorten them. */
  readonly recorder?: RecorderTuning | undefined;
}

/**
 * Where links that leave the server (guest invites, device sign-in) point: the public URL, else
 * localhost on the server's port, which opens only on the server's own machine (startup warns
 * once, `publicUrlWarning`).
 */
export const linkOrigin = (settings: Pick<ServerSettings, "publicUrl" | "port">): string =>
  settings.publicUrl ?? `http://localhost:${settings.port}`;

/** Optional capture and scheduling tuning. */
export interface RecorderTuning {
  /** HLS segment length. Default 6 s. */
  readonly segmentSeconds?: number;
  /** How long a recording keeps capturing after its end so the last segment lands. Default 8 s. */
  readonly endGraceMs?: number;
  /** How far back live viewers can rewind. Default 4 hours. */
  readonly dvrWindowMs?: number;
  /**
   * How long a live viewer keeps its capture without fetching a playlist or segment (closed tab,
   * app in the background). Default 60 s.
   */
  readonly liveIdleMs?: number;
  /**
   * How long a channel keeps running after its last live viewer left, in place of the
   * household's Live TV setting (tests). Default: the setting.
   */
  readonly keepRunningMs?: number;
}

/** Default free-space floor: 20 GiB. */
export const DEFAULT_FREE_SPACE_FLOOR_BYTES = 20 * 1024 ** 3;

const optional = <T>(config: Config.Config<T>) =>
  Config.option(config).pipe(
    Config.map((value) => (value._tag === "Some" ? value.value : undefined)),
  );

const fromEnv = () =>
  Config.all({
    host: Config.String("SLIPSTREAM_HOST").pipe(Config.withDefault("0.0.0.0")),
    port: Config.Port("SLIPSTREAM_PORT").pipe(Config.withDefault(8080)),
    configDir: Config.NonEmptyString("SLIPSTREAM_CONFIG_DIR").pipe(
      Config.withDefault(".data/config"),
    ),
    dataDir: Config.NonEmptyString("SLIPSTREAM_DATA_DIR").pipe(Config.withDefault(".data/data")),
    publicUrl: optional(Config.schema(PublicUrl, "SLIPSTREAM_PUBLIC_URL")),
    trustedProxies: Config.schema(ProxyList, "SLIPSTREAM_TRUSTED_PROXIES").pipe(
      Config.withDefault(""),
    ),
    webDir: optional(Config.NonEmptyString("SLIPSTREAM_WEB_DIR")),
    ffmpegPath: Config.NonEmptyString("SLIPSTREAM_FFMPEG").pipe(Config.withDefault("ffmpeg")),
    ffprobePath: optional(Config.NonEmptyString("SLIPSTREAM_FFPROBE")),
    freeSpaceFloorGb: Config.Number("SLIPSTREAM_FREE_SPACE_FLOOR_GB").pipe(
      Config.withDefault(DEFAULT_FREE_SPACE_FLOOR_BYTES / 1024 ** 3),
    ),
    advertise: Config.Boolean("SLIPSTREAM_MDNS").pipe(Config.withDefault(true)),
    startupChecks: Config.Boolean("SLIPSTREAM_STARTUP_CHECKS").pipe(Config.withDefault(true)),
    timeZone: Config.schema(TimeZone, "SLIPSTREAM_TIME_ZONE").pipe(
      Config.withDefault(Intl.DateTimeFormat().resolvedOptions().timeZone),
    ),
  }).pipe(
    Config.map((raw): ServerSettings => ({
      host: raw.host,
      port: raw.port,
      configDir: resolve(raw.configDir),
      dataDir: resolve(raw.dataDir),
      publicUrl: raw.publicUrl,
      trustedProxies: parseProxies(raw.trustedProxies),
      webDir: raw.webDir === undefined ? undefined : resolve(raw.webDir),
      timeZone: raw.timeZone,
      sourceCheckIntervalMillis: 60_000,
      ffmpegPath: raw.ffmpegPath,
      ffprobePath: raw.ffprobePath ?? siblingFfprobe(raw.ffmpegPath),
      freeSpaceFloorBytes: Math.max(0, Math.round(raw.freeSpaceFloorGb * 1024 ** 3)),
      advertise: raw.advertise,
      startupChecks: raw.startupChecks,
    })),
  );

/** The server's bootstrap configuration. */
export class ServerConfig extends Context.Service<ServerConfig, ServerSettings>()(
  "@slipstream/server/ServerConfig",
) {
  /** Reads `SLIPSTREAM_*` variables; see the README for the full list. */
  static readonly layer = Layer.effect(ServerConfig, fromEnv());

  /** Fixed settings, for tests and embedding. */
  static readonly layerWith = (settings: ServerSettings) => Layer.succeed(ServerConfig, settings);
}

/** Parses a validated proxy list into networks. */
export const parseProxies = (value: string): Array<IpNetwork.IpNetwork> =>
  splitList(value).map((entry) => IpNetwork.fromStringUnsafe(withPrefix(entry)));
