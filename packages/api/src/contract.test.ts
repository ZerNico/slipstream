import { assert, describe, it, layer } from "@effect/vitest";
import { DateTime, Effect, Layer, Redacted, Schema } from "effect";
import { HttpClientRequest, HttpServer } from "effect/http";
import { HttpApiBuilder, HttpApiMiddleware, HttpApiTest } from "effect/http-api";
import {
  applySourceConfigPatch,
  ChannelId,
  CollectionId,
  decideTranscode,
  deliveryOf,
  HttpUrl,
  type MediaCapabilities,
  PlaybackSessionId,
  ProgrammeId,
  RecordingId,
  RerunView,
  type Rule,
  RuleId,
  type Source,
  SourceId,
  type StreamInfo,
  UserId,
  viewSource,
} from "@slipstream/domain";
import { openApiSpec, SlipstreamApi } from "./api.ts";
import { InvalidInput, NotFound, RangeNotCaptured, Unauthorized } from "./errors.ts";
import { CollectionInput } from "./groups/collections.ts";
import { RuleInput, RuleUpdate } from "./groups/rules.ts";
import { ServerEvent } from "./groups/system.ts";
import { Authentication, CurrentUser } from "./security.ts";

type Json =
  | null
  | boolean
  | number
  | string
  | ReadonlyArray<Json>
  | { readonly [key: string]: Json };

describe("write-only secrets in openapi.json", () => {
  const spec = JSON.parse(JSON.stringify(openApiSpec())) as {
    paths: Record<string, Record<string, Json>>;
    components: { schemas: Record<string, Json> };
  };

  /** Every property name reachable from a schema, following `$ref`s. */
  const propertyNames = (schema: Json, seen = new Set<string>()): Set<string> => {
    const names = new Set<string>();
    const visit = (node: Json): void => {
      if (node === null || typeof node !== "object") return;
      if (Array.isArray(node)) {
        node.forEach(visit);
        return;
      }
      const record = node as { readonly [key: string]: Json };
      const ref = record.$ref;
      if (typeof ref === "string") {
        const name = ref.split("/").at(-1) ?? "";
        if (seen.has(name)) return;
        seen.add(name);
        visit(spec.components.schemas[name] ?? null);
      }
      const properties = record.properties;
      if (properties !== null && typeof properties === "object" && !Array.isArray(properties)) {
        for (const key of Object.keys(properties)) names.add(key);
      }
      Object.values(record).forEach(visit);
    };
    visit(schema);
    return names;
  };

  it("never returns a password, secret header values or stream URLs from the sources group", () => {
    const responses = Object.entries(spec.paths)
      .filter(([path]) => path.startsWith("/api/sources"))
      .flatMap(([, item]) => Object.values(item))
      .map((operation) => (operation as { responses?: Json }).responses ?? null);
    assert.isAbove(responses.length, 0);
    const names = propertyNames(responses);
    for (const secret of ["password", "secretHeaders"]) {
      assert.isFalse(names.has(secret), `a sources response exposes "${secret}"`);
    }
    assert.isTrue(names.has("hasPassword"));
    assert.isTrue(names.has("secretHeaderNames"));
    assert.isTrue(names.has("hasCredentials"));
    const streams = spec.paths["/api/sources/{sourceId}/streams"]?.get as { responses?: Json };
    assert.isFalse(propertyNames(streams.responses ?? null).has("url"));
  });

  it("still accepts secrets on create and update", () => {
    const create = spec.paths["/api/sources"]?.post as { requestBody?: Json };
    assert.isTrue(propertyNames(create.requestBody ?? null).has("password"));
    assert.isTrue(propertyNames(create.requestBody ?? null).has("secretHeaders"));
  });
});

const alice = {
  id: UserId.make("alice"),
  username: "alice",
  displayName: "Alice",
  role: "admin" as const,
  createdAt: DateTime.makeUnsafe("2026-11-01T00:00:00Z"),
};

const AuthenticationLive = Layer.succeed(Authentication)({
  cookie: () => Effect.fail(new Unauthorized()),
  bearer: (effect, { credential }) =>
    Redacted.value(credential) === "device-token"
      ? Effect.provideService(effect, CurrentUser, alice)
      : Effect.fail(new Unauthorized()),
});

const now = DateTime.makeUnsafe("2026-11-21T20:00:00Z");
const unused = Effect.die("not used in this test");

/** An in-memory sources handler that stores secrets and answers with views, as the server must. */
const store = new Map<string, Source>();
const SourcesHandlers = HttpApiBuilder.group(SlipstreamApi, "sources", (handlers) =>
  handlers.handleAll({
    list: () => Effect.succeed([...store.values()].map(viewSource)),
    get: ({ params }) => {
      const source = store.get(params.sourceId);
      return source === undefined
        ? Effect.fail(new NotFound({ entity: "source", id: params.sourceId }))
        : Effect.succeed(viewSource(source));
    },
    create: ({ payload }) => {
      const source: Source = {
        ...payload,
        id: SourceId.make(`s${store.size + 1}`),
        health: "unknown",
      };
      store.set(source.id, source);
      return Effect.succeed(viewSource(source));
    },
    update: ({ params, payload }) => {
      const current = store.get(params.sourceId);
      if (current === undefined) {
        return Effect.fail(new NotFound({ entity: "source", id: params.sourceId }));
      }
      const config =
        payload.config === undefined
          ? current.config
          : applySourceConfigPatch(current.config, payload.config);
      if (config._tag === "MissingSecret") {
        return Effect.fail(
          new InvalidInput({ problems: [{ path: `config.${config.field}`, code: "required" }] }),
        );
      }
      const { secretHeaders: _secretHeaders, ...rest } = payload;
      const next: Source = { ...current, ...rest, config };
      store.set(next.id, next);
      return Effect.succeed(viewSource(next));
    },
    remove: () => unused,
    refresh: () => unused,
    test: () => unused,
    streams: () => Effect.succeed([]),
    catalogue: () => Effect.succeed({ total: 0, streams: [] }),
    groups: () => Effect.succeed([]),
    addStreams: () => unused,
    ignoreStreams: () => unused,
    markReviewed: () => unused,
  }),
);

const CollectionsHandlers = HttpApiBuilder.group(SlipstreamApi, "collections", (handlers) =>
  handlers.handleAll({
    list: () => Effect.succeed([]),
    get: ({ params }) =>
      Effect.fail(new NotFound({ entity: "collection", id: params.collectionId })),
    create: () => unused,
    update: () => unused,
    remove: () => unused,
    reorder: () => unused,
    previewSimilar: () =>
      Effect.succeed({ extension: { _tag: "AlreadyMatches" as const }, past: [], future: [] }),
    moveSimilar: ({ params }) =>
      Effect.fail(new NotFound({ entity: "collection", id: params.collectionId })),
    preview: () => unused,
    unlink: () => unused,
  }),
);

/** An in-memory rules handler that keeps what a PATCH leaves out, as the server must. */
const rules = new Map<string, Rule>();
/** The query of the last `DELETE /rules/:id`, as the server received it. */
let lastRemoval: unknown;
const RulesHandlers = HttpApiBuilder.group(SlipstreamApi, "rules", (handlers) =>
  handlers.handleAll({
    list: () => Effect.succeed([...rules.values()]),
    get: () => unused,
    create: ({ payload }) => {
      const rule: Rule = {
        ...payload,
        id: RuleId.make(`r${rules.size + 1}`),
        ownerId: alice.id,
        createdAt: now,
        offerDeclined: false,
      };
      rules.set(rule.id, rule);
      return Effect.succeed(rule);
    },
    update: ({ params, payload }) => {
      const current = rules.get(params.ruleId);
      if (current === undefined)
        return Effect.fail(new NotFound({ entity: "rule", id: params.ruleId }));
      const { collectionId: _collection, ...rest } = payload;
      const next: Rule = { ...current, ...rest };
      rules.set(next.id, next);
      return Effect.succeed(next);
    },
    remove: ({ query }) => {
      lastRemoval = query;
      return Effect.void;
    },
    preview: ({ payload }) =>
      Effect.succeed({
        matches: [
          {
            programme: {
              id: ProgrammeId.make("tatort-one"),
              channelId: ChannelId.make("one"),
              title: "Tatort",
              start: now,
              end: DateTime.add(now, { minutes: 90 }),
              categories: [],
              repeat: false,
              live: false,
            },
            range: { start: now, end: DateTime.add(now, { minutes: 90 }) },
            skip: {
              _tag: "Repeat" as const,
              of: { start: now, channelId: ChannelId.make("das-erste"), state: "history" as const },
            },
          },
        ],
        ...(payload.rule.collectionId === undefined
          ? {
              offer: {
                name: "Live F1",
                layout: { parts: [], path: ["{year}", "{programme}"] },
                groups: 3,
                examples: ["Live F1: Rennen - GP Katar"],
              },
            }
          : {}),
      }),
    offer: () => Effect.succeed({}),
    declineOffer: ({ params }) => {
      const current = rules.get(params.ruleId);
      if (current === undefined)
        return Effect.fail(new NotFound({ entity: "rule", id: params.ruleId }));
      const next = { ...current, offerDeclined: true };
      rules.set(next.id, next);
      return Effect.succeed(next);
    },
    group: () => unused,
    ungroup: () => unused,
    history: () => Effect.succeed({ count: 12 }),
    forgetHistory: () => Effect.succeed({ count: 0 }),
  }),
);

const RecordingsHandlers = HttpApiBuilder.group(SlipstreamApi, "recordings", (handlers) =>
  handlers.handleAll({
    list: () => Effect.succeed([]),
    get: ({ params }) => Effect.fail(new NotFound({ entity: "recording", id: params.recordingId })),
    create: () => unused,
    update: () => unused,
    stop: () => unused,
    remove: () => unused,
    keepOriginal: () => unused,
    conflicts: () => Effect.succeed([]),
    retention: () =>
      Effect.succeed([
        {
          recordingId: RecordingId.make("katar-race"),
          reason: { _tag: "BeyondNewestEvents" as const, count: 2, event: "GP Katar" },
          policyFrom: { _tag: "Collection" as const, collectionId: CollectionId.make("f1") },
        },
      ]),
  }),
);

const surround: StreamInfo = {
  container: "mpegts",
  video: { codec: "h264", width: 1920, height: 1080, fps: 50, interlaced: false },
  audio: [{ codec: "ac3", channels: 6, language: "deu" }],
  bitrateKbps: 8000,
  probedAt: now,
};
const sessionCapabilities = new Map<string, MediaCapabilities>();

const PlaybackHandlers = HttpApiBuilder.group(SlipstreamApi, "playback", (handlers) =>
  handlers.handleAll({
    createSession: ({ payload }) => {
      // This fake's timeshift buffer holds nothing: every range is gone.
      if (payload.source._tag === "Range") {
        return Effect.fail(
          new RangeNotCaptured({
            channelId: payload.source.channelId,
            range: payload.source.range,
          }),
        );
      }
      const id = PlaybackSessionId.make("session-1");
      sessionCapabilities.set(id, payload.capabilities);
      const plan = decideTranscode({ ...payload, stream: surround, hardware: { encoders: [] } });
      return Effect.succeed({
        id,
        playlistUrl: "/hls/live/sky.m3u8?token=t",
        plan,
        expiresAt: now,
      });
    },
    updateSession: ({ params, payload }) => {
      const capabilities = sessionCapabilities.get(params.playbackSessionId);
      if (capabilities === undefined) {
        return Effect.fail(
          new NotFound({ entity: "playbackSession", id: params.playbackSessionId }),
        );
      }
      const plan = decideTranscode({
        stream: surround,
        capabilities,
        quality: payload.quality ?? { _tag: "Auto" },
        playbackRate: payload.playbackRate,
        hardware: { encoders: [] },
      });
      return Effect.succeed({
        id: params.playbackSessionId,
        playlistUrl: "/hls/live/sky.m3u8?token=t2",
        plan,
        expiresAt: now,
      });
    },
    endSession: () => unused,
    state: () => unused,
    saveState: () => unused,
    continueWatching: () => Effect.succeed([]),
  }),
);

const withToken = HttpApiMiddleware.layerClient(Authentication, ({ next, request }) =>
  next(HttpClientRequest.bearerToken(request, "device-token")),
);

const makeClient = HttpApiTest.groups(SlipstreamApi, [
  "sources",
  "collections",
  "recordings",
  "playback",
  "rules",
]);

const url = Schema.decodeUnknownSync(HttpUrl);

const tatortRule = {
  name: "Tatort",
  enabled: true,
  matcher: {
    channels: [ChannelId.make("das-erste")],
    title: [{ _tag: "StartsWith", values: ["Tatort"] }],
    categories: [],
    weekdays: [],
  },
  padding: { beforeMinutes: 0, afterMinutes: 0 },
  retention: { _tag: "KeepAll" },
} as const;

describe("series recordings in the contract (recording model §7)", () => {
  it("decodes a create without skipRepeats (older TV builds) to Only episodes you don't have yet", () => {
    const decoded = Schema.decodeUnknownSync(RuleInput)(tatortRule);
    assert.strictEqual(decoded.skipRepeats, true);
    assert.strictEqual(
      Schema.decodeUnknownSync(RuleInput)({ ...tatortRule, skipRepeats: false }).skipRepeats,
      false,
    );
  });

  it("never takes offerDeclined from a client", () => {
    const decoded = Schema.decodeUnknownSync(RuleInput)({ ...tatortRule, offerDeclined: true });
    assert.notProperty(decoded, "offerDeclined");
    const update = Schema.decodeUnknownSync(RuleUpdate)({ offerDeclined: true, name: "Tatort" });
    assert.deepStrictEqual(update, { name: "Tatort" });
  });

  it("leaves skipRepeats out of an update that does not name it", () => {
    assert.notProperty(Schema.decodeUnknownSync(RuleUpdate)({ enabled: false }), "skipRepeats");
  });

  it("never takes follows from a collection client", () => {
    const decoded = Schema.decodeUnknownSync(CollectionInput)({
      name: "Formel 1",
      rank: 0,
      matcher: tatortRule.matcher,
      labels: [],
      layout: { parts: [], path: [] },
      follows: { ruleId: "live-f1" },
    });
    assert.notProperty(decoded, "follows");
  });

  it("carries RecordingReplaced and the rerun state on the wire", () => {
    const event = Schema.decodeUnknownSync(ServerEvent)({
      _tag: "RecordingReplaced",
      id: "tatort-one",
      replacedId: "tatort-erste",
    });
    assert.deepStrictEqual(event, {
      _tag: "RecordingReplaced",
      id: RecordingId.make("tatort-one"),
      replacedId: RecordingId.make("tatort-erste"),
    });
    const rerun = Schema.decodeUnknownSync(RerunView)({
      state: "scheduled",
      repeat: { recordingId: "tatort-one", start: "2026-11-24T19:15:00Z", channelId: "one" },
      until: "2026-12-06T20:45:00Z",
    });
    assert.strictEqual(rerun.repeat?.recordingId, "tatort-one");
  });
});

layer(
  Layer.mergeAll(
    Layer.mergeAll(
      SourcesHandlers,
      CollectionsHandlers,
      RecordingsHandlers,
      PlaybackHandlers,
      RulesHandlers,
    ).pipe(Layer.provideMerge(AuthenticationLive)),
    HttpServer.layerServices,
  ),
)("secrets, suggestions, retention and sessions round trip", (test) => {
  test.effect("keeps skipRepeats when an older client PATCHes a rule without it", () =>
    Effect.gen(function* () {
      const client = yield* makeClient;
      const created = yield* client.rules.create({
        payload: { ...tatortRule, skipRepeats: false },
      });
      assert.strictEqual(created.skipRepeats, false);
      assert.strictEqual(created.offerDeclined, false);
      // An older client knows neither field: the rule keeps "Every airing".
      const renamed = yield* client.rules.update({
        params: { ruleId: created.id },
        payload: { name: "Tatort (Erste)" },
      });
      assert.strictEqual(renamed.skipRepeats, false);
      assert.strictEqual(renamed.name, "Tatort (Erste)");
      const declined = yield* client.rules.declineOffer({ params: { ruleId: created.id } });
      assert.strictEqual(declined.offerDeclined, true);
    }).pipe(Effect.provide(withToken)),
  );

  test.effect("sends the delete choices and answers previews with skips and the offer", () =>
    Effect.gen(function* () {
      const client = yield* makeClient;
      yield* client.rules.remove({
        params: { ruleId: RuleId.make("r1") },
        query: { collection: "remove", undo: true },
      });
      assert.deepStrictEqual(lastRemoval, { collection: "remove", undo: true });
      yield* client.rules.remove({ params: { ruleId: RuleId.make("r1") }, query: {} });
      assert.deepStrictEqual(lastRemoval, {});
      const preview = yield* client.rules.preview({
        payload: { rule: { ...tatortRule, skipRepeats: true } },
      });
      assert.strictEqual(preview.matches[0]?.skip?._tag, "Repeat");
      assert.strictEqual(preview.offer?.groups, 3);
      assert.deepStrictEqual(
        yield* client.rules.history({ params: { ruleId: RuleId.make("r1") } }),
        { count: 12 },
      );
    }).pipe(Effect.provide(withToken)),
  );

  test.effect("takes a password in and never hands it back, and keeps it on update", () =>
    Effect.gen(function* () {
      const client = yield* makeClient;
      const created = yield* client.sources.create({
        payload: {
          name: "Provider",
          config: {
            _tag: "Xtream",
            serverUrl: url("http://line.example.com:8080"),
            username: "alice",
            password: "hunter2",
          },
          refreshIntervalMinutes: 720,
          headers: {},
          secretHeaders: { Authorization: "Bearer abc" },
          guideCleanup: { removeDuplicates: true, rewrites: [] },
          enabled: true,
        },
      });
      assert.notInclude(JSON.stringify(created), "hunter2");
      assert.notInclude(JSON.stringify(created), "Bearer abc");
      assert.deepStrictEqual(created.secretHeaderNames, ["Authorization"]);
      assert.deepInclude(created.config, { _tag: "Xtream", hasPassword: true });

      const renamed = yield* client.sources.update({
        params: { sourceId: created.id },
        payload: { config: { _tag: "Xtream", username: "bob" } },
      });
      assert.deepInclude(renamed.config, { username: "bob", hasPassword: true });
      const stored = store.get(created.id)?.config;
      assert.deepInclude(stored, { password: "hunter2" });

      const switched = yield* client.sources
        .update({
          params: { sourceId: created.id },
          payload: { config: { _tag: "Url" } },
        })
        .pipe(Effect.flip);
      assert.strictEqual(switched._tag, "InvalidInput");
    }).pipe(Effect.provide(withToken)),
  );

  test.effect("routes the static suggestion and retention paths before the id routes", () =>
    Effect.gen(function* () {
      const client = yield* makeClient;
      const retention = yield* client.recordings.retention();
      assert.strictEqual(retention[0]?.reason._tag, "BeyondNewestEvents");
      const preview = yield* client.collections.previewSimilar({
        params: { collectionId: CollectionId.make("f1") },
        payload: { recordingId: RecordingId.make("press") },
      });
      assert.strictEqual(preview.extension._tag, "AlreadyMatches");
    }).pipe(Effect.provide(withToken)),
  );

  test.effect("switches passthrough surround to stereo when the session speeds up", () =>
    Effect.gen(function* () {
      const client = yield* makeClient;
      const session = yield* client.playback.createSession({
        payload: {
          source: { _tag: "Live", channelId: ChannelId.make("sky-sport-f1") },
          capabilities: {
            video: [{ codec: "h264", profiles: [], maxWidth: 3840, maxHeight: 2160 }],
            audio: ["aac"],
            audioPassthrough: ["ac3"],
            hdr: false,
            canDeinterlace: true,
          },
          quality: { _tag: "Auto" },
          network: "lan",
        },
      });
      assert.strictEqual(deliveryOf(session.plan).decision, "direct");
      const faster = yield* client.playback.updateSession({
        params: { playbackSessionId: session.id },
        payload: { playbackRate: 1.5 },
      });
      assert.deepStrictEqual(deliveryOf(faster.plan), {
        decision: "audio",
        reasons: ["catchUpPassthrough"],
      });
      assert.deepInclude(faster.plan?.audio, { _tag: "Encode", channels: 2 });

      const tooFast = yield* client.playback
        .updateSession({ params: { playbackSessionId: session.id }, payload: { playbackRate: 16 } })
        .pipe(Effect.flip);
      // The contract caps the speed at 4x; the client refuses to send 16x.
      assert.strictEqual(tooFast._tag, "SchemaError");
    }).pipe(Effect.provide(withToken)),
  );

  test.effect("answers a range the buffer no longer holds with a typed RangeNotCaptured", () =>
    Effect.gen(function* () {
      const client = yield* makeClient;
      const channelId = ChannelId.make("sky-sport-f1");
      const range = { start: now, end: DateTime.add(now, { minutes: 90 }) };
      const gone = yield* client.playback
        .createSession({
          payload: {
            source: { _tag: "Range", channelId, range },
            capabilities: {
              video: [{ codec: "h264", profiles: [], maxWidth: 1920, maxHeight: 1080 }],
              audio: ["aac"],
              audioPassthrough: [],
              hdr: false,
              canDeinterlace: true,
            },
            quality: { _tag: "Auto" },
            network: "lan",
          },
        })
        .pipe(Effect.flip);
      assert.instanceOf(gone, RangeNotCaptured);
      assert.strictEqual(gone._tag, "RangeNotCaptured");
      if (gone._tag === "RangeNotCaptured") assert.strictEqual(gone.channelId, channelId);
    }).pipe(Effect.provide(withToken)),
  );
});
