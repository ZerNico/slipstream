import { readFileSync } from "node:fs";
import { assert, describe, it, layer } from "@effect/vitest";
import { DateTime, Effect, Layer, Redacted } from "effect";
import { HttpClientRequest, HttpServer } from "effect/http";
import { HttpApiBuilder, HttpApiMiddleware, HttpApiTest } from "effect/http-api";
import { ChannelId, type Programme, ProgrammeId, UserId } from "@slipstream/domain";
import { openApiSpec, SlipstreamApi } from "./api.ts";
import { NotFound, Unauthorized } from "./errors.ts";
import { Authentication, CurrentUser } from "./security.ts";

describe("openapi.json", () => {
  const spec = openApiSpec();

  it("is up to date with the HttpApi definition (run `pnpm openapi` to regenerate)", () => {
    const committed: unknown = JSON.parse(
      readFileSync(new URL("../openapi.json", import.meta.url), "utf8"),
    );
    assert.deepStrictEqual(committed, JSON.parse(JSON.stringify(spec)));
  });

  it("has every group from PLAN 7", () => {
    const tags = new Set(
      Object.values(spec.paths).flatMap((item) =>
        Object.values(item).flatMap((operation: unknown) =>
          typeof operation === "object" && operation !== null && "operationId" in operation
            ? [String(operation.operationId).split(".")[0]]
            : [],
        ),
      ),
    );
    for (const group of [
      "sources",
      "channels",
      "guide",
      "recordings",
      "rules",
      "collections",
      "captures",
      "playback",
      "auth",
      "devices",
      "system",
      "profiles",
      "guests",
      "invites",
      "settings",
      "artwork",
      "streams",
      "programmes",
    ]) {
      assert.isTrue(tags.has(group), `missing group ${group}`);
    }
  });

  it("requires authentication everywhere except health, setup, login, device codes and invites", () => {
    const publicOperations: Array<string> = [];
    for (const [path, item] of Object.entries(spec.paths)) {
      for (const [method, operation] of Object.entries(item)) {
        if (typeof operation !== "object" || operation === null || !("security" in operation)) {
          continue;
        }
        const security = operation.security as ReadonlyArray<unknown> | undefined;
        if (security === undefined || security.length === 0) {
          publicOperations.push(`${method.toUpperCase()} ${path}`);
        }
      }
    }
    assert.deepStrictEqual(publicOperations.toSorted(), [
      "GET /api/auth/setup",
      "GET /api/health",
      "POST /api/auth/device-code",
      "POST /api/auth/device-code/token",
      "POST /api/auth/login",
      "POST /api/auth/setup",
      "POST /api/invites/accept",
      "POST /api/invites/lookup",
    ]);
  });
});

const sky = ChannelId.make("sky-sport-f1");
const race: Programme = {
  id: ProgrammeId.make("race"),
  channelId: sky,
  title: "Live F1: Rennen - GP Las Vegas",
  start: DateTime.makeUnsafe("2026-11-22T04:00:00Z"),
  end: DateTime.makeUnsafe("2026-11-22T06:00:00Z"),
  categories: ["Sport"],
  repeat: false,
  live: true,
};

const AuthenticationLive = Layer.succeed(Authentication)({
  cookie: () => Effect.fail(new Unauthorized()),
  bearer: (effect, { credential }) =>
    Redacted.value(credential) === "device-token"
      ? Effect.provideService(effect, CurrentUser, {
          id: UserId.make("alice"),
          username: "alice",
          displayName: "Alice",
          role: "admin",
          createdAt: DateTime.makeUnsafe("2026-11-01T00:00:00Z"),
        })
      : Effect.fail(new Unauthorized()),
});

const GuideHandlers = HttpApiBuilder.group(SlipstreamApi, "guide", (handlers) =>
  handlers.handleAll({
    window: ({ query }) =>
      Effect.succeed(
        DateTime.isLessThan(query.from, race.end) && DateTime.isLessThan(race.start, query.to)
          ? [race]
          : [],
      ),
    extent: () => Effect.succeed({ end: race.end }),
    nowNext: () => Effect.succeed([{ channelId: sky, now: race }]),
    search: ({ query }) => Effect.succeed(race.title.includes(query.q) ? [race] : []),
    repeats: () => Effect.succeed([]),
    programme: ({ params }) =>
      params.programmeId === race.id
        ? Effect.succeed(race)
        : Effect.fail(new NotFound({ entity: "programme", id: params.programmeId })),
  }),
);

const withToken = (token: string) =>
  HttpApiMiddleware.layerClient(Authentication, ({ next, request }) =>
    next(HttpClientRequest.bearerToken(request, token)),
  );

const makeClient = HttpApiTest.groups(SlipstreamApi, ["guide"]);

layer(
  Layer.mergeAll(
    GuideHandlers.pipe(Layer.provideMerge(AuthenticationLive)),
    HttpServer.layerServices,
  ),
)("contract round trip", (test) => {
  test.effect("decodes instants and programmes through query and response", () =>
    Effect.gen(function* () {
      const client = yield* makeClient;
      const programmes = yield* client.guide.window({
        query: {
          from: DateTime.makeUnsafe("2026-11-22T00:00:00Z"),
          to: DateTime.makeUnsafe("2026-11-23T00:00:00Z"),
        },
      });
      assert.strictEqual(programmes.length, 1);
      assert.strictEqual(DateTime.formatIso(programmes[0]!.start), "2026-11-22T04:00:00.000Z");
      const empty = yield* client.guide.window({
        query: {
          from: DateTime.makeUnsafe("2026-11-23T00:00:00Z"),
          to: DateTime.makeUnsafe("2026-11-24T00:00:00Z"),
        },
      });
      assert.deepStrictEqual(empty, []);
    }).pipe(Effect.provide(withToken("device-token"))),
  );

  test.effect("returns typed NotFound errors", () =>
    Effect.gen(function* () {
      const client = yield* makeClient;
      const error = yield* client.guide
        .programme({ params: { programmeId: ProgrammeId.make("missing") } })
        .pipe(Effect.flip);
      assert.strictEqual(error._tag, "NotFound");
    }).pipe(Effect.provide(withToken("device-token"))),
  );

  test.effect("rejects an unknown device token", () =>
    Effect.gen(function* () {
      const client = yield* makeClient;
      const error = yield* client.guide.nowNext().pipe(Effect.flip);
      assert.strictEqual(error._tag, "Unauthorized");
    }).pipe(Effect.provide(withToken("revoked"))),
  );
});
