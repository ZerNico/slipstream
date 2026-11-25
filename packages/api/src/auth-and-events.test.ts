import { assert, describe, it, layer } from "@effect/vitest";
import { DateTime, Effect, Layer, Redacted, Schema } from "effect";
import { HttpClientRequest, HttpServer } from "effect/http";
import { HttpApiBuilder, HttpApiMiddleware, HttpApiTest } from "effect/http-api";
import { type User, UserId } from "@slipstream/domain";
import { SlipstreamApi } from "./api.ts";
import { DeviceCodeNotReady, Forbidden, NotFound, Unauthorized } from "./errors.ts";
import { deviceLinkUrl, type PendingDeviceSignIn } from "./groups/auth.ts";
import { ProfileInput, ProfileUpdate } from "./groups/profiles.ts";
import { RecordingEntry } from "./groups/recordings.ts";
import { ServerEvent, SystemInfo } from "./groups/system.ts";
import { Authentication, CurrentUser, csrfCookie, csrfHeader, sessionCookie } from "./security.ts";

describe("auth helpers and constants", () => {
  it("builds the approve URL with the code, like verification_uri_complete", () => {
    assert.strictEqual(
      deviceLinkUrl("https://tv.example.com/", "QK74RM"),
      "https://tv.example.com/link?code=QK74RM",
    );
    assert.strictEqual(
      deviceLinkUrl("http://192.168.12.11:8080", "QK 74"),
      "http://192.168.12.11:8080/link?code=QK%2074",
    );
  });

  it("names the cookies and the CSRF header the server and web share", () => {
    assert.deepStrictEqual(
      [sessionCookie, csrfCookie, csrfHeader],
      ["slipstream_session", "slipstream_csrf", "x-csrf-token"],
    );
  });
});

describe("schema additions", () => {
  it("decodes the Connected event the server sends first on every SSE stream", () => {
    const event = Schema.decodeUnknownSync(ServerEvent)({
      _tag: "Connected",
      at: "2026-11-21T20:00:00.000Z",
    });
    assert.strictEqual(event._tag, "Connected");
  });

  it("decodes RecordingRemoved with the owners it had, and needs at least one", () => {
    const decode = Schema.decodeUnknownSync(ServerEvent);
    const event = decode({ _tag: "RecordingRemoved", recordingId: "r1", ownerIds: ["alice"] });
    assert.strictEqual(event._tag, "RecordingRemoved");
    if (event._tag === "RecordingRemoved")
      assert.deepStrictEqual(event.ownerIds, [UserId.make("alice")]);
    assert.throws(() => decode({ _tag: "RecordingRemoved", recordingId: "r1", ownerIds: [] }));
  });

  it("requires the household time zone and keeps hardware detection optional", () => {
    const decode = Schema.decodeUnknownSync(SystemInfo);
    const info = {
      version: "0.1.0",
      timeZone: "Europe/Berlin",
      ffmpeg: { version: "9.0.2", selfCheck: "ok" },
      storage: [],
      sources: [],
    };
    assert.strictEqual(decode(info).hardware, undefined);
    assert.deepStrictEqual(decode({ ...info, hardware: { encoders: [] } }).hardware, {
      encoders: [],
    });
    const { timeZone: _timeZone, ...withoutZone } = info;
    assert.throws(() => decode(withoutZone));
  });

  it("adds a profile with its own sign-in only when the password is long enough", () => {
    const decode = Schema.decodeUnknownSync(ProfileInput);
    const input = { displayName: "Mila", avatarTone: "green" };
    assert.strictEqual(decode(input).login, undefined);
    assert.deepStrictEqual(
      decode({ ...input, login: { username: "mila", password: "correct horse" } }).login,
      { username: "mila", password: "correct horse" },
    );
    assert.throws(() => decode({ ...input, login: { username: "mila", password: "short" } }));
  });

  it("changes a password through the profile update, with the current one for your own", () => {
    const decode = Schema.decodeUnknownSync(ProfileUpdate);
    assert.deepStrictEqual(decode({ password: "correct horse", currentPassword: "old one" }), {
      password: "correct horse",
      currentPassword: "old one",
    });
    assert.throws(() => decode({ password: "short" }));
  });

  it("carries the caller's watched state and resume position on every library entry", () => {
    const fields = Object.keys(RecordingEntry.fields);
    assert.includeMembers(fields, ["watched", "positionMillis"]);
  });
});

const createdAt = DateTime.makeUnsafe("2026-11-01T00:00:00Z");
const alice: User = {
  id: UserId.make("alice"),
  username: "alice",
  displayName: "Alice",
  role: "admin",
  createdAt,
};
const ben: User = {
  id: UserId.make("ben"),
  username: "ben",
  displayName: "Ben",
  role: "user",
  createdAt,
};

const tokens: Record<string, User> = { "alice-token": alice, "ben-token": ben };

const AuthenticationLive = Layer.succeed(Authentication)({
  cookie: () => Effect.fail(new Unauthorized()),
  bearer: (effect, { credential }) => {
    const user = tokens[Redacted.value(credential)];
    return user === undefined
      ? Effect.fail(new Unauthorized())
      : Effect.provideService(effect, CurrentUser, user);
  },
});

const unused = Effect.die("not used in this test");

const adminOnly = Effect.gen(function* () {
  const caller = yield* CurrentUser;
  if (caller.role !== "admin") return yield* new Forbidden();
});

const pending: PendingDeviceSignIn = {
  userCode: "QK74RM",
  device: { name: "Living Room Shield", kind: "tv" },
  expiresAt: DateTime.makeUnsafe("2026-11-21T20:10:00Z"),
};

const AuthHandlers = HttpApiBuilder.group(SlipstreamApi, "auth", (handlers) =>
  handlers.handleAll({
    setupStatus: () => Effect.succeed({ required: false }),
    setup: () => unused,
    login: () => unused,
    startDeviceCode: () => unused,
    pollDeviceCode: () => unused,
    pendingDeviceCode: ({ params }) =>
      params.userCode === pending.userCode
        ? Effect.succeed(pending)
        : params.userCode === "OLD123"
          ? Effect.fail(new DeviceCodeNotReady({ reason: "expired" }))
          : Effect.fail(new NotFound({ entity: "device", id: params.userCode })),
    approveDeviceCode: ({ payload }) =>
      Effect.gen(function* () {
        const caller = yield* CurrentUser;
        if (payload.userId !== undefined && payload.userId !== caller.id) yield* adminOnly;
        return payload.approve
          ? { device: pending.device, userId: payload.userId ?? caller.id }
          : { device: pending.device };
      }),
    logout: () => unused,
    me: () =>
      Effect.gen(function* () {
        return yield* CurrentUser;
      }),
  }),
);

const as = (token: string) =>
  HttpApiMiddleware.layerClient(Authentication, ({ next, request }) =>
    next(HttpClientRequest.bearerToken(request, token)),
  );

const makeClient = HttpApiTest.groups(SlipstreamApi, ["auth"]);

/** Runs `f` with a client that signs in with `token` (the token is fixed when it is built). */
const asCaller = <A, E, R>(
  token: string,
  f: (client: Effect.Success<typeof makeClient>) => Effect.Effect<A, E, R>,
) => makeClient.pipe(Effect.flatMap(f), Effect.provide(as(token)));

layer(
  Layer.mergeAll(
    AuthHandlers.pipe(Layer.provideMerge(AuthenticationLive)),
    HttpServer.layerServices,
  ),
)("device-code approval round trip", (test) => {
  test.effect(
    "looks up a pending TV sign-in by its code, beside the static device-code routes",
    () =>
      Effect.gen(function* () {
        const client = yield* makeClient;
        const found = yield* client.auth.pendingDeviceCode({ params: { userCode: "QK74RM" } });
        assert.deepStrictEqual(found.device, { name: "Living Room Shield", kind: "tv" });
        const expired = yield* client.auth
          .pendingDeviceCode({ params: { userCode: "OLD123" } })
          .pipe(Effect.flip);
        assert.deepInclude(expired, { _tag: "DeviceCodeNotReady", reason: "expired" });
        const missing = yield* client.auth
          .pendingDeviceCode({ params: { userCode: "NOPE00" } })
          .pipe(Effect.flip);
        assert.strictEqual(missing._tag, "NotFound");
      }).pipe(Effect.provide(as("ben-token"))),
  );

  test.effect("lets an admin approve as another profile, and nobody else", () =>
    Effect.gen(function* () {
      const asBen = yield* asCaller("alice-token", (client) =>
        client.auth.approveDeviceCode({
          payload: { userCode: "QK74RM", approve: true, userId: ben.id },
        }),
      );
      assert.strictEqual(asBen.userId, ben.id);
      const self = yield* asCaller("ben-token", (client) =>
        client.auth.approveDeviceCode({ payload: { userCode: "QK74RM", approve: true } }),
      );
      assert.strictEqual(self.userId, ben.id);
      const denied = yield* asCaller("ben-token", (client) =>
        client.auth.approveDeviceCode({
          payload: { userCode: "QK74RM", approve: true, userId: alice.id },
        }),
      ).pipe(Effect.flip);
      assert.strictEqual(denied._tag, "Forbidden");
    }),
  );
});
