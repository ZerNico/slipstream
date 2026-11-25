/**
 * Wires the server together: services over the database, the recorder (captures, scheduling,
 * retention, disk guard), source refresh, the HTTP API, HLS routes and the web app, served by
 * Node's HTTP server and announced on the local network.
 */
import { createServer } from "node:http";
import { NodeHttpServer } from "@effect/platform-node";
import { Cause, Clock, Effect, Layer, Option } from "effect";
import {
  FetchHttpClient,
  HttpEffect,
  HttpMiddleware,
  HttpRouter,
  HttpServerError,
  HttpServerRequest,
  HttpServerResponse,
  HttpStaticServer,
} from "effect/http";
import { HttpApiBuilder } from "effect/http-api";
import { SlipstreamApi } from "@slipstream/api";
import { M3uXmltvSource } from "@slipstream/sources";
import { FrameGrabber } from "./artwork/frames.ts";
import { OnlineArtwork, OnlineArtworkWorker } from "./artwork/online-artwork.ts";
import { Artwork } from "./artwork/service.ts";
import { RateLimiter } from "./auth/rate-limit.ts";
import { SecretKey } from "./auth/secret-key.ts";
import { Auth } from "./auth/service.ts";
import { Signing } from "./auth/signing.ts";
import { Captures } from "./captures/service.ts";
import { Channels } from "./channels/service.ts";
import { Collections } from "./collections/service.ts";
import { ServerConfig } from "./config.ts";
import { Db } from "./db/client.ts";
import { EventBus } from "./events.ts";
import { Guests } from "./guests/service.ts";
import { Guide } from "./guide/service.ts";
import { Hls } from "./hls/service.ts";
import { AuthenticationLive } from "./http/authentication.ts";
import { ApiHandlers } from "./http/handlers.ts";
import { HlsRoutes } from "./http/hls.ts";
import { Planning } from "./planning/service.ts";
import { Playback } from "./playback/service.ts";
import { Profiles } from "./profiles/service.ts";
import { Programmes } from "./programmes/service.ts";
import { FfmpegLive, FfmpegRunnerLive, Recorder } from "./recorder/engine.ts";
import { Recordings } from "./recordings/service.ts";
import { Rules } from "./rules/service.ts";
import { Settings } from "./settings/service.ts";
import { SecretBox } from "./sources/secret-box.ts";
import { SourceScheduler, Sources } from "./sources/service.ts";
import { Streams } from "./streams/service.ts";
import { AdvertiseLive } from "./system/advertise.ts";
import { Hardware } from "./system/hardware.ts";
import { SystemInfoService } from "./system/service.ts";
import { Transcoder } from "./transcode/service.ts";

/** Every service, the recorder included, given a `ServerConfig`. */
export const ServicesLive = Layer.mergeAll(Streams.layer, Programmes.layer, Recordings.layer).pipe(
  Layer.provideMerge(
    Layer.mergeAll(
      Channels.layer,
      Rules.layer,
      Collections.layer,
      Playback.layer,
      Captures.layer,
      Hls.layer,
      SystemInfoService.layer,
      Profiles.layer,
      Guests.layer,
      Artwork.layer,
      OnlineArtwork.layer.pipe(Layer.provide(FetchHttpClient.layer)),
    ),
  ),
  Layer.provideMerge(Recorder.layer),
  Layer.provideMerge(Layer.mergeAll(Settings.layer, Planning.layer, Transcoder.layer)),
  Layer.provideMerge(Layer.mergeAll(Sources.layer, Guide.layer, Auth.layer, Hardware.layer)),
  Layer.provideMerge(
    Layer.mergeAll(
      Signing.layer,
      SecretBox.layer,
      FfmpegLive,
      FfmpegRunnerLive,
      M3uXmltvSource.layer.pipe(Layer.provide(FetchHttpClient.layer)),
    ),
  ),
  Layer.provideMerge(Layer.mergeAll(Db.layer, EventBus.layer, RateLimiter.layer, SecretKey.layer)),
);

/** The JSON API under `/api`. */
const ApiRoutes = HttpApiBuilder.layer(SlipstreamApi).pipe(
  Layer.provide(ApiHandlers.pipe(Layer.provide(AuthenticationLive))),
);

/** The built web app with SPA fallback, when `SLIPSTREAM_WEB_DIR` points at one. */
const WebRoutes = Layer.unwrap(
  Effect.map(ServerConfig, (config) =>
    config.webDir === undefined
      ? Layer.empty
      : HttpStaticServer.layer({ root: config.webDir, spa: true, cacheControl: "no-cache" }),
  ),
);

/**
 * Logs method, path and status. Query strings are left out on purpose: HLS URLs carry tokens.
 * Segment and playlist requests log at debug level, they arrive every few seconds per viewer.
 */
const logRequests = HttpMiddleware.make((app) =>
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const started = yield* Clock.currentTimeMillis;
    const path = new URL(request.url, "http://localhost").pathname;
    return yield* app.pipe(
      Effect.tap((response) =>
        Effect.flatMap(Clock.currentTimeMillis, (ended) => {
          const log = path.startsWith("/hls/") ? Effect.logDebug : Effect.logInfo;
          return log(`${request.method} ${path} ${response.status}`).pipe(
            Effect.annotateLogs({ durationMs: ended - started }),
          );
        }),
      ),
      // What fails here answers 500 further out; without this it would leave no trace.
      Effect.tapCause((cause) => {
        // A response already chosen rides along in the cause; what is left is what went wrong.
        const [, reported] = HttpServerError.causeResponseStripped(cause);
        if (Option.isNone(reported)) return Effect.void;
        // A client that went away (an event stream closed, a player that moved on) is no error.
        if (Cause.hasInterruptsOnly(reported.value)) {
          return Effect.logDebug(`${request.method} ${path} ended: the client went away`);
        }
        return Effect.logError(`${request.method} ${path} failed`, reported.value);
      }),
    );
  }),
);

/** Headers every response carries: no framing (clickjacking), no MIME sniffing, no referrer. */
export const securityHeaders = {
  "x-frame-options": "DENY",
  "content-security-policy": "frame-ancestors 'none'",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
} as const;

/** Adds {@link securityHeaders} to every response, error answers included. */
const secureResponses = HttpMiddleware.make((app) =>
  Effect.andThen(
    HttpEffect.appendPreResponseHandler((_request, response) =>
      Effect.succeed(HttpServerResponse.setHeaders(response, securityHeaders)),
    ),
    app,
  ),
);

/**
 * The API areas whose answers are compressed: the large, read-heavy ones that carry no secret.
 * Answers with tokens, stream URLs or keys (auth, guests, invites, playback, streams,
 * settings) stay uncompressed, so their length can never leak a secret (BREACH).
 */
const compressedApi = [
  "/api/guide",
  "/api/recordings",
  "/api/channels",
  "/api/collections",
  "/api/rules",
  "/api/programmes",
] as const;

/** Text the browser and the app read whole: JSON, scripts, styles, HTML, SVG. */
const compressibleType = (contentType: string): boolean => {
  const type = contentType.split(";")[0]?.trim().toLowerCase() ?? "";
  return (
    type === "application/json" ||
    type === "text/javascript" ||
    type === "application/javascript" ||
    type === "text/css" ||
    type === "text/html" ||
    type === "image/svg+xml"
  );
};

/**
 * Whether the answer to `path` may be compressed: the web app's own files and the API areas in
 * {@link compressedApi}. Never HLS (video is compressed already, playlists carry tokens).
 */
export const compressiblePath = (path: string): boolean =>
  path.startsWith("/api/")
    ? compressedApi.some((prefix) => path === prefix || path.startsWith(`${prefix}/`))
    : !path.startsWith("/hls/");

/**
 * Compresses what {@link compressiblePath} allows with Brotli or gzip, as the client accepts:
 * a week of guide is a ninth of its size gzipped, the web app's scripts a quarter. Live events
 * (`text/event-stream`) are never compressed, since compression would hold them back.
 */
const compressResponses = HttpMiddleware.make((app) =>
  Effect.flatMap(HttpServerRequest.HttpServerRequest, (request) =>
    compressiblePath(new URL(request.url, "http://localhost").pathname)
      ? HttpMiddleware.compression({
          algorithms: ["br", "gzip"],
          // Brotli's level 4 is about gzip's speed and still smaller; 11 is for build steps.
          levels: { br: 4 },
          compressible: compressibleType,
        })(app)
      : app,
  ),
);

/** All routes, served by an `HttpServer` from the context. */
export const HttpLive = Layer.unwrap(
  Effect.map(ServerConfig, (config) =>
    HttpRouter.serve(Layer.mergeAll(ApiRoutes, HlsRoutes, WebRoutes), {
      disableLogger: true,
      middleware: (app) =>
        logRequests(
          secureResponses(
            compressResponses(
              HttpMiddleware.xForwardedHeaders({ trustedProxies: config.trustedProxies })(app),
            ),
          ),
        ),
    }),
  ),
);

/** What the startup check says when a public https URL meets an empty proxy list. */
export const proxyWarning =
  "SLIPSTREAM_PUBLIC_URL is https but SLIPSTREAM_TRUSTED_PROXIES is empty: behind a reverse proxy, set it to the proxy's address so client addresses (sign-in limits, home or away) are right";

export const publicUrlWarning =
  "SLIPSTREAM_PUBLIC_URL is not set: guest invite and device sign-in links point at localhost and open only on this machine";

/**
 * Warns on startup about settings that look wrong:
 *
 * - published over https but trusting no proxy: behind a reverse proxy every request then seems
 *   to come from the proxy's address, so the sign-in limit per client address throttles everyone
 *   at once and "home or away" is judged by the proxy;
 * - no public URL: links that leave the server fall back to localhost (`linkOrigin`).
 */
export const ConfigWarnings = Layer.effectDiscard(
  Effect.gen(function* () {
    const config = yield* ServerConfig;
    if (config.publicUrl === undefined) yield* Effect.logWarning(publicUrlWarning);
    if (config.publicUrl?.startsWith("https://") === true && config.trustedProxies.length === 0) {
      yield* Effect.logWarning(proxyWarning);
    }
  }),
);

/** Node's HTTP server on the configured host and port. */
const NodeServerLive = Layer.unwrap(
  Effect.map(ServerConfig, (config) =>
    NodeHttpServer.layer(createServer, { port: config.port, host: config.host }),
  ),
);

/** The whole server, needing only a `ServerConfig`. Closing it stops every capture. */
export const makeServer = () =>
  Layer.mergeAll(
    HttpLive,
    SourceScheduler,
    FrameGrabber,
    OnlineArtworkWorker,
    AdvertiseLive,
    ConfigWarnings,
  ).pipe(Layer.provideMerge(ServicesLive), Layer.provideMerge(NodeServerLive));
