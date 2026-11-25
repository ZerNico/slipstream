import { createServer } from "node:http";
import { NodeHttpServer } from "@effect/platform-node";
import { Context, Effect, Exit, Layer, Schema, Scope, Stream } from "effect";
import { HttpRouter, HttpServer, HttpServerRequest, HttpServerResponse } from "effect/http";
import { bigGuideChannels, renderBigPlaylist } from "./big-lineup.ts";
import { channels, findChannel } from "./channels.ts";
import { defaultSettings, FakeSourceConfig, type FakeSourceSettings } from "./config.ts";
import {
  FaultControl,
  type FaultState,
  FaultUpdate,
  noFaults,
  type StreamPlan,
  StreamFaultsQuery,
} from "./faults.ts";
import { Ffmpeg } from "./ffmpeg.ts";
import { renderLogo, renderPlaylist, renderXmltv } from "./render.ts";
import { programmesBetween } from "./schedule.ts";
import { StreamSessions } from "./sessions.ts";

/** Options for starting a fake source; everything has a default. */
export interface FakeSourceOptions {
  readonly timeZone?: string | undefined;
  readonly guideHours?: number | undefined;
  readonly duplicateProgrammes?: boolean | undefined;
  readonly ffmpegPath?: string | undefined;
  readonly fontFile?: string | null | undefined;
  /** 0 (the default) picks a free port. */
  readonly port?: number | undefined;
  readonly host?: string | undefined;
  /** Source-wide faults and limits at start; `/control` changes them later. */
  readonly faults?: Partial<FaultState> | undefined;
  /** Log every request and the listen address (the CLI does; tests usually don't). */
  readonly verbose?: boolean | undefined;
}

/** A stream cut short by the `dropAfter` fault in `reset` mode. */
class InjectedDrop extends Schema.TaggedError<InjectedDrop>()("InjectedDrop", {
  afterSeconds: Schema.Number,
}) {}

/** Fault query keys a playlist request passes on to its stream URLs. */
const faultKeys = ["refuse", "dropAfter", "dropMode", "stallAfter"] as const;

const seconds = (value: number) => Effect.sleep(`${Math.round(value * 1000)} millis`);

/** The URL clients reached us at, so playlist and guide links work behind any host name. */
const baseUrl = (request: HttpServerRequest.HttpServerRequest) =>
  `http://${request.headers["host"] ?? "localhost"}`;

const badRequest = (error: Schema.SchemaError) =>
  HttpServerResponse.text(`invalid parameters: ${error.message}`, { status: 400 });

/**
 * Applies a plan's stall and drop to a stream. A stall stops the bytes (and ffmpeg, via `stop`)
 * but keeps the connection open; a drop ends the response after its delay, cleanly (`eof`) or by
 * destroying the connection (`reset`).
 */
const withFaults = (
  body: Stream.Stream<Uint8Array, unknown>,
  plan: StreamPlan,
  stop: Effect.Effect<void>,
): Stream.Stream<Uint8Array, unknown> => {
  const stalled =
    plan.stallAfter === null
      ? body
      : body.pipe(
          Stream.interruptWhen(seconds(plan.stallAfter)),
          Stream.concat(Stream.fromEffect(stop).pipe(Stream.drain)),
          Stream.concat(Stream.never),
        );
  if (plan.dropAfter === null) return stalled;
  const afterSeconds = plan.dropAfter;
  return stalled.pipe(
    Stream.interruptWhen(seconds(afterSeconds)),
    Stream.concat(
      plan.dropMode === "reset" ? Stream.fail(new InjectedDrop({ afterSeconds })) : Stream.empty,
    ),
  );
};

const index = `Slipstream fake source

GET    /playlist.m3u           M3U playlist (fault query parameters are copied to stream URLs;
                               ?lineup=big: ~4,800 streams in 28 groups, HD/FHD/SD copies)
GET    /epg.xml                XMLTV guide (?duplicates=1, ?hours=48, ?lineup=big)
GET    /logo/<channel>.svg     channel logo
GET    /stream/<channel>.ts    live MPEG-TS (?refuse=403|429|509|eof, ?dropAfter=s,
                               ?dropMode=reset|eof, ?stallAfter=s)
GET    /control                fault settings and open streams
POST   /control                change fault settings (JSON, null clears)
DELETE /control                reset fault settings
`;

/** `?lineup=big` swaps the eight channels for the big playlist (see big-lineup.ts). */
const isBig = (params: URLSearchParams) => params.get("lineup") === "big";

const GuideQuery = Schema.Struct({
  lineup: Schema.optional(Schema.Literals(["standard", "big"])),
  duplicates: Schema.optional(Schema.Literals(["0", "1", "true", "false"])),
  hours: Schema.optional(
    Schema.NumberFromString.pipe(
      Schema.decodeTo(Schema.Finite.check(Schema.isBetween({ minimum: 1, maximum: 24 * 14 }))),
    ),
  ),
});

const Routes = Layer.effectDiscard(
  Effect.gen(function* () {
    const router = yield* HttpRouter.HttpRouter;
    const config = yield* FakeSourceConfig;
    const faults = yield* FaultControl;
    const sessions = yield* StreamSessions;
    const ffmpeg = yield* Ffmpeg;

    const playlist = Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      const params = new URL(request.url, "http://localhost").searchParams;
      const forwarded = new URLSearchParams();
      for (const key of faultKeys) {
        const value = params.get(key);
        if (value !== null) forwarded.set(key, value);
      }
      const options = { baseUrl: baseUrl(request), streamQuery: forwarded.toString() };
      return HttpServerResponse.text(
        isBig(params) ? renderBigPlaylist(options) : renderPlaylist({ ...options, channels }),
        { contentType: "audio/x-mpegurl" },
      );
    });

    const guide = Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      const query = yield* HttpServerRequest.schemaSearchParams(GuideQuery);
      const now = new Date();
      // Start at the top of the hour so the programme on air now is always included.
      const from = new Date(Math.floor(now.getTime() / 3_600_000) * 3_600_000);
      const to = new Date(now.getTime() + (query.hours ?? config.guideHours) * 3_600_000);
      const duplicates =
        query.duplicates === undefined
          ? config.duplicateProgrammes
          : query.duplicates === "1" || query.duplicates === "true";
      return HttpServerResponse.text(
        renderXmltv({
          baseUrl: baseUrl(request),
          channels,
          programmes: channels.flatMap((channel) =>
            programmesBetween(channel, from, to, config.timeZone),
          ),
          timeZone: config.timeZone,
          duplicates,
          ...(query.lineup === "big" ? { extraChannels: bigGuideChannels() } : {}),
        }),
        { contentType: "application/xml; charset=utf-8" },
      );
    }).pipe(Effect.catchTag("SchemaError", (error) => Effect.succeed(badRequest(error))));

    const logo = Effect.gen(function* () {
      const { file = "" } = yield* HttpRouter.params;
      const channel = findChannel(file.replace(/\.svg$/, ""));
      if (!channel) return HttpServerResponse.text("unknown channel", { status: 404 });
      return HttpServerResponse.text(renderLogo(channel), { contentType: "image/svg+xml" });
    });

    const stream = Effect.gen(function* () {
      const { file = "" } = yield* HttpRouter.params;
      const channel = findChannel(file.replace(/\.ts$/, ""));
      if (!channel) return HttpServerResponse.text("unknown channel", { status: 404 });
      const query = yield* HttpServerRequest.schemaSearchParams(StreamFaultsQuery);
      const plan = yield* faults.plan(query);
      if (plan.refuse === "eof") return HttpServerResponse.text("", { contentType: "video/mp2t" });
      if (plan.refuse !== null) {
        return HttpServerResponse.text(`refused by fault injection (${plan.refuse})`, {
          status: plan.refuse,
        });
      }
      const { maxStreams, limitStatus } = yield* faults.state;
      const session = yield* sessions.open(channel.id, maxStreams).pipe(Effect.option);
      if (session._tag === "None") {
        return HttpServerResponse.text(`stream limit of ${maxStreams} reached`, {
          status: limitStatus,
        });
      }
      // Both the slot and ffmpeg live in the request scope, which closes once the response is
      // written or the client goes away.
      const handle = yield* ffmpeg.live(channel);
      yield* sessions.attachProcess(session.value, handle.pid);
      const body = withFaults(handle.stdout, plan, Effect.ignore(handle.kill()));
      return HttpServerResponse.stream(body, { contentType: "video/mp2t" });
    }).pipe(
      Effect.catchTags({
        SchemaError: (error) => Effect.succeed(badRequest(error)),
        FfmpegError: (error) =>
          Effect.logError("ffmpeg failed to start", error).pipe(
            Effect.as(HttpServerResponse.text(`ffmpeg failed: ${error.message}`, { status: 503 })),
          ),
      }),
    );

    const controlState = Effect.gen(function* () {
      return yield* HttpServerResponse.json({
        faults: yield* faults.state,
        sessions: yield* sessions.list,
      });
    });

    const updateControl = HttpServerRequest.schemaBodyJson(FaultUpdate).pipe(
      Effect.flatMap((update) => faults.update(update)),
      Effect.andThen(controlState),
      Effect.catchTag("SchemaError", (error) => Effect.succeed(badRequest(error))),
    );

    yield* router.addAll([
      HttpRouter.route("GET", "/", Effect.succeed(HttpServerResponse.text(index))),
      HttpRouter.route("GET", "/playlist.m3u", playlist),
      HttpRouter.route("GET", "/epg.xml", guide),
      HttpRouter.route("GET", "/logo/:file", logo),
      HttpRouter.route("GET", "/stream/:file", stream),
      HttpRouter.route("GET", "/control", controlState),
      HttpRouter.route("POST", "/control", updateControl),
      HttpRouter.route("DELETE", "/control", Effect.andThen(faults.reset, controlState)),
    ]);
  }),
);

/**
 * The fake source as a layer: an HTTP server with playlist, guide, logos, live streams and the
 * fault control endpoint. `FaultControl` and `StreamSessions` are exposed so tests can drive
 * faults and watch streams directly. Closing the layer stops the server and every ffmpeg.
 */
export const layer = (options: FakeSourceOptions = {}) => {
  const settings: FakeSourceSettings = {
    timeZone: options.timeZone ?? defaultSettings.timeZone,
    guideHours: options.guideHours ?? defaultSettings.guideHours,
    duplicateProgrammes: options.duplicateProgrammes ?? defaultSettings.duplicateProgrammes,
    ffmpegPath: options.ffmpegPath ?? defaultSettings.ffmpegPath,
    fontFile: options.fontFile ?? defaultSettings.fontFile,
  };
  const verbose = options.verbose ?? false;
  const server = NodeHttpServer.layer(() => createServer(), {
    port: options.port ?? 0,
    host: options.host ?? "127.0.0.1",
    // Live streams never finish on their own; don't wait long for them on shutdown.
    gracefulShutdownTimeout: "500 millis",
  });
  const services = Layer.mergeAll(
    FaultControl.layer({ ...noFaults, ...options.faults }),
    StreamSessions.layer,
    Ffmpeg.layer,
  ).pipe(Layer.provideMerge(Layer.succeed(FakeSourceConfig, settings)));
  return HttpRouter.serve(Routes, { disableLogger: !verbose, disableListenLog: !verbose }).pipe(
    Layer.provideMerge(services),
    Layer.provideMerge(server),
  );
};

/** A running fake source. */
export interface RunningFakeSource {
  /** e.g. `http://127.0.0.1:53124` */
  readonly url: string;
  readonly port: number;
  readonly faults: FaultControl["Service"];
  readonly sessions: StreamSessions["Service"];
}

/** Starts a fake source for the life of the current scope. */
export const start = Effect.fnUntraced(function* (options: FakeSourceOptions = {}) {
  const context = yield* Layer.build(layer(options));
  const { address } = Context.get(context, HttpServer.HttpServer);
  if (address._tag === "UnixPathAddress") {
    return yield* Effect.die(new Error("the fake source listens on TCP only"));
  }
  const port = address.port;
  const host = options.host ?? "127.0.0.1";
  return {
    url: `http://${host.includes(":") ? `[${host}]` : host}:${port}`,
    port,
    faults: Context.get(context, FaultControl),
    sessions: Context.get(context, StreamSessions),
  } satisfies RunningFakeSource;
});

/**
 * Starts a fake source from Promise-based code (plain vitest, scripts). `close` stops the server
 * and every ffmpeg it started.
 */
export const startFakeSource = async (
  options: FakeSourceOptions = {},
): Promise<RunningFakeSource & { close(): Promise<void> }> => {
  const scope = Scope.makeUnsafe();
  const close = () => Effect.runPromise(Scope.close(scope, Exit.void));
  try {
    const running = await Effect.runPromise(Scope.provide(scope)(start(options)));
    return { ...running, close };
  } catch (error) {
    await close();
    throw error;
  }
};
