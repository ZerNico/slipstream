/**
 * Round trips through the real HTTP server and the real `@slipstream/api` contract: first-run
 * setup, cookie sessions with CSRF, rate limiting, device tokens, device-code sign-in, roles,
 * and what the request log says when an event stream's client goes away.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Context, Effect, Exit, Layer, Logger, Redacted, References, Scope } from "effect";
import { FetchHttpClient, HttpClientRequest, HttpServer } from "effect/http";
import { HttpApiClient, HttpApiMiddleware } from "effect/http-api";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Authentication, SlipstreamApi } from "@slipstream/api";
import { hashPassword } from "../src/auth/crypto.ts";
import { ServerConfig } from "../src/config.ts";
import { users } from "../src/db/schema.ts";
import { makeServer } from "../src/server.ts";
import { Browser, startTestServer, type TestServer } from "./harness.ts";
import { testSettings } from "./support.ts";

let server: TestServer;
const password = "correct horse battery staple";

beforeAll(async () => {
  server = await startTestServer({ publicUrl: "https://tv.example.test" });
});

afterAll(async () => {
  await server?.close();
});

/** A typed `HttpApiClient` that sends a bearer token, like the app does. */
const apiClient = (token: string) =>
  HttpApiClient.make(SlipstreamApi, { baseUrl: server.url }).pipe(
    Effect.provide(
      Layer.mergeAll(
        FetchHttpClient.layer,
        HttpApiMiddleware.layerClient(Authentication, ({ next, request }) =>
          next(HttpClientRequest.bearerToken(request, Redacted.make(token))),
        ),
      ),
    ),
  );

describe("first-run setup", () => {
  it("requires setup, refuses sign-in before it, and runs exactly once", async () => {
    const browser = new Browser(server.url);
    expect((await browser.request("GET", "/api/auth/setup")).json).toEqual({ required: true });

    const early = await browser.request("POST", "/api/auth/login", { username: "admin", password });
    expect(early.status).toBe(409);
    expect(early.json).toMatchObject({ _tag: "SetupRequired" });

    const weak = await browser.request("POST", "/api/auth/setup", {
      username: "admin",
      displayName: "Admin",
      password: "short",
    });
    expect(weak.status).toBe(400);

    const setup = await browser.request("POST", "/api/auth/setup", {
      username: " Admin ",
      displayName: "Household Admin",
      password,
    });
    expect(setup.status).toBe(200);
    expect(setup.json).toMatchObject({ user: { username: "admin", role: "admin" } });
    expect(setup.json).not.toHaveProperty("token");
    const cookies = setup.headers.getSetCookie();
    const session = cookies.find((line) => line.startsWith("slipstream_session="));
    expect(session).toMatch(/HttpOnly/i);
    expect(session).toMatch(/SameSite=Lax/i);
    // The public URL is https, so cookies are Secure.
    expect(session).toMatch(/Secure/i);
    expect(cookies.find((line) => line.startsWith("slipstream_csrf="))).not.toMatch(/HttpOnly/i);

    const again = await browser.request("POST", "/api/auth/setup", {
      username: "other",
      displayName: "Other",
      password,
    });
    expect(again.status).toBe(409);
    expect(again.json).toMatchObject({ _tag: "AlreadySetUp" });
    expect((await browser.request("GET", "/api/auth/setup")).json).toEqual({ required: false });
  });
});

describe("cookie sessions", () => {
  it("authenticates by cookie and demands the CSRF token on changes", async () => {
    const browser = new Browser(server.url);
    const login = await browser.request("POST", "/api/auth/login", { username: "ADMIN", password });
    expect(login.status).toBe(200);
    expect((await browser.request("GET", "/api/auth/me")).json).toMatchObject({
      username: "admin",
    });

    const forged = await browser.request("POST", "/api/auth/logout", undefined, {
      "x-csrf-token": "forged",
    });
    expect(forged.status).toBe(401);
    expect((await browser.request("GET", "/api/auth/me")).status).toBe(200);

    const logout = await browser.request("POST", "/api/auth/logout");
    expect(logout.status).toBe(204);
    expect(browser.cookies.has("slipstream_session")).toBe(false);
    expect((await fetch(`${server.url}/api/auth/me`)).status).toBe(401);
  });

  it("rejects requests without credentials and with unknown tokens", async () => {
    expect((await fetch(`${server.url}/api/channels`)).status).toBe(401);
    const bogus = await fetch(`${server.url}/api/channels`, {
      headers: { authorization: "Bearer nope" },
    });
    expect(bogus.status).toBe(401);
  });

  it("slows down repeated failed sign-ins per username without saying whether it exists", async () => {
    const browser = new Browser(server.url);
    const attempts = [];
    for (let attempt = 0; attempt < 5; attempt += 1) {
      attempts.push(
        await browser.request("POST", "/api/auth/login", {
          username: "mallory",
          password: "guess",
        }),
      );
    }
    // Three free guesses, then each wrong one doubles the wait before the next.
    expect(attempts.slice(0, 4).map((result) => result.status)).toEqual([401, 401, 401, 401]);
    expect(attempts[0]?.json).toMatchObject({ _tag: "InvalidCredentials" });
    expect(attempts[4]?.status).toBe(429);
    expect(attempts[4]?.json).toMatchObject({ _tag: "RateLimited", retryAfterSeconds: 2 });

    // Being signed in as someone does not lift another username's backoff.
    const signedIn = new Browser(server.url);
    await signedIn.request("POST", "/api/auth/login", { username: "admin", password });
    const other = await signedIn.request("POST", "/api/auth/login", {
      username: "mallory",
      password: "guess",
    });
    expect(other.status).toBe(429);

    // Someone guessing the admin's password slows down sign-ins as the admin, but a browser
    // signed in as the admin is its owner, so the admin's backoff does not hold it up.
    const guesser = new Browser(server.url);
    for (let attempt = 0; attempt < 4; attempt += 1) {
      await guesser.request("POST", "/api/auth/login", { username: "admin", password: "guess" });
    }
    const held = await guesser.request("POST", "/api/auth/login", { username: "admin", password });
    expect(held.status).toBe(429);
    const owner = await signedIn.request("POST", "/api/auth/login", {
      username: "admin",
      password,
    });
    expect(owner.status).toBe(200);
  });
});

describe("device tokens", () => {
  it("issues a revocable bearer token for an app sign-in", async () => {
    const browser = new Browser(server.url);
    const login = await browser.request("POST", "/api/auth/login", {
      username: "admin",
      password,
      device: { name: "Pixel", kind: "phone" },
    });
    expect(login.status).toBe(200);
    const body = login.json as { token: string; device: { id: string; name: string } };
    expect(body.device.name).toBe("Pixel");
    expect(login.headers.getSetCookie()).toEqual([]);

    const me = await Effect.runPromise(
      Effect.flatMap(apiClient(body.token), (client) => client.auth.me()),
    );
    expect(me.username).toBe("admin");

    const devices = await Effect.runPromise(
      Effect.flatMap(apiClient(body.token), (client) => client.devices.list()),
    );
    expect(devices.map((device) => device.name)).toContain("Pixel");

    await Effect.runPromise(
      Effect.flatMap(apiClient(body.token), (client) =>
        client.devices.revoke({
          params: { deviceId: devices.find((d) => d.name === "Pixel")!.id },
        }),
      ),
    );
    const after = await Effect.runPromise(
      Effect.flatMap(apiClient(body.token), (client) => client.auth.me()).pipe(Effect.flip),
    );
    expect(after._tag).toBe("Unauthorized");
  });
});

describe("device-code sign-in", () => {
  it("lets a signed-in user approve a TV by its short code", async () => {
    const tv = new Browser(server.url);
    const grant = await tv.request("POST", "/api/auth/device-code", {
      name: "Living Room Shield",
      kind: "tv",
    });
    expect(grant.status).toBe(200);
    const { deviceCode, userCode, verificationUrl, intervalSeconds } = grant.json as {
      deviceCode: string;
      userCode: string;
      verificationUrl: string;
      intervalSeconds: number;
    };
    expect(userCode).toMatch(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
    expect(verificationUrl).toBe(`https://tv.example.test/link?code=${userCode}`);
    expect(intervalSeconds).toBe(5);

    const phone = new Browser(server.url);
    await phone.request("POST", "/api/auth/login", { username: "admin", password });
    const typed = userCode.toLowerCase().replace("-", " ");
    const approve = await phone.request("POST", "/api/auth/device-code/approve", {
      userCode: typed,
      approve: true,
    });
    expect(approve.status).toBe(200);
    expect(approve.json).toMatchObject({ device: { name: "Living Room Shield", kind: "tv" } });

    const token = await tv.request("POST", "/api/auth/device-code/token", { deviceCode });
    expect(token.status).toBe(200);
    const result = token.json as { token: string; device: { kind: string } };
    expect(result.device.kind).toBe("tv");
    const me = await Effect.runPromise(
      Effect.flatMap(apiClient(result.token), (client) => client.auth.me()),
    );
    expect(me.username).toBe("admin");

    // The code is used up.
    const reuse = await tv.request("POST", "/api/auth/device-code/token", { deviceCode });
    expect(reuse.json).toMatchObject({ _tag: "DeviceCodeNotReady", reason: "expired" });
  });

  it("answers pending, then slowDown when polled faster than the interval, and denied", async () => {
    const tv = new Browser(server.url);
    const grant = (
      await tv.request("POST", "/api/auth/device-code", { name: "Bedroom TV", kind: "tv" })
    ).json as { deviceCode: string; userCode: string };
    const poll = () =>
      tv.request("POST", "/api/auth/device-code/token", { deviceCode: grant.deviceCode });
    expect((await poll()).json).toMatchObject({ reason: "pending" });
    expect((await poll()).json).toMatchObject({ reason: "slowDown" });

    const phone = new Browser(server.url);
    await phone.request("POST", "/api/auth/login", { username: "admin", password });
    await phone.request("POST", "/api/auth/device-code/approve", {
      userCode: grant.userCode,
      approve: false,
    });
    expect((await poll()).json).toMatchObject({ reason: "denied" });

    const unknown = await phone.request("POST", "/api/auth/device-code/approve", {
      userCode: "ZZZZ-ZZZZ",
      approve: true,
    });
    expect(unknown.status).toBe(404);
  });
});

describe("roles", () => {
  it("keeps admin-only changes away from ordinary users", async () => {
    await server.run(
      Effect.gen(function* () {
        yield* server.db.write.insert(users).values({
          id: "user-1",
          username: "kid",
          displayName: "Kid",
          role: "user",
          passwordHash: yield* hashPassword(password),
          createdAt: Date.now(),
        });
      }),
    );
    const kid = new Browser(server.url);
    expect(
      (await kid.request("POST", "/api/auth/login", { username: "kid", password })).status,
    ).toBe(200);
    const create = await kid.request("POST", "/api/sources", {
      name: "Mine",
      config: { _tag: "M3u", playlistUrl: "http://example.test/playlist.m3u" },
      refreshIntervalMinutes: 60,
      headers: {},
      guideCleanup: { removeDuplicates: true, rewrites: [] },
      enabled: true,
    });
    expect(create.status).toBe(403);
    expect((await kid.request("GET", "/api/sources")).json).toEqual([]);
    const channel = await kid.request("POST", "/api/channels", {
      name: "X",
      favourite: false,
      hidden: false,
    });
    expect(channel.status).toBe(403);
    // Users still read the channel list and their own devices.
    expect((await kid.request("GET", "/api/channels")).status).toBe(200);
    expect((await kid.request("GET", "/api/devices")).json).toEqual([]);
  });
});

describe("system", () => {
  it("answers the public health probe and shows system info to signed-in users", async () => {
    expect(await (await fetch(`${server.url}/api/health`)).json()).toEqual({ status: "ok" });
    const browser = new Browser(server.url);
    await browser.request("POST", "/api/auth/login", { username: "admin", password });
    const info = await browser.request("GET", "/api/system");
    expect(info.status).toBe(200);
    expect(info.json).toMatchObject({
      version: "0.1.4",
      timeZone: "Europe/Berlin",
      ffmpeg: { selfCheck: "pending" },
      storage: [{ recordingsBytes: 0, bufferBytes: 0 }],
      sources: [],
    });
    // Startup checks are off in tests, so hardware detection has not run.
    expect(info.json).not.toHaveProperty("hardware");
    const [storage] = (info.json as { storage: Array<{ totalBytes: number; freeBytes: number }> })
      .storage;
    expect(storage!.totalBytes).toBeGreaterThan(storage!.freeBytes);
  });
});

describe("live events", () => {
  it("says Connected first, then pushes recording changes over SSE", async () => {
    const browser = new Browser(server.url);
    await browser.request("POST", "/api/auth/login", { username: "admin", password });
    const controller = new AbortController();
    // Headers arrive with the first event, so subscribe first and trigger the event after.
    const pending = fetch(`${server.url}/api/events`, {
      headers: { cookie: `slipstream_session=${browser.cookies.get("slipstream_session")}` },
      signal: controller.signal,
    });
    await new Promise((resolve) => setTimeout(resolve, 300));

    const channel = (
      await browser.request("POST", "/api/channels", {
        name: "Events",
        favourite: false,
        hidden: false,
      })
    ).json as { id: string };
    const start = new Date(Date.now() + 3_600_000);
    const recording = (
      await browser.request("POST", "/api/recordings", {
        _tag: "Manual",
        channelId: channel.id,
        range: {
          start: start.toISOString(),
          end: new Date(start.getTime() + 600_000).toISOString(),
        },
        title: "Later",
      })
    ).json as { id: string };

    const response = await pending;
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    const reader = response.body!.pipeThrough(new TextDecoderStream()).getReader();
    let received = "";
    while (!received.includes(recording.id)) {
      const chunk = await reader.read();
      if (chunk.done) break;
      received += chunk.value;
    }
    controller.abort();
    const data = received
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map(
        (line) =>
          JSON.parse(line.slice(5)) as { _tag: string; recordingId?: string; state?: string },
      );
    expect(data[0]?._tag).toBe("Connected");
    expect(data).toContainEqual({
      _tag: "RecordingChanged",
      recordingId: recording.id,
      state: "scheduled",
    });
  });
});

describe("the request log", () => {
  it("logs an event stream whose client went away at debug level, not as an error", async () => {
    const root = mkdtempSync(join(tmpdir(), "slipstream-log-"));
    const lines: Array<{ readonly level: string; readonly message: string }> = [];
    const capture = Logger.layer([
      Logger.make(({ logLevel, message }) => {
        lines.push({ level: logLevel, message: String(message) });
      }),
    ]);
    const scope = Scope.makeUnsafe();
    try {
      const context = await Effect.runPromise(
        Layer.build(
          makeServer().pipe(
            Layer.provideMerge(ServerConfig.layerWith(testSettings(root))),
            Layer.provide(capture),
            Layer.provide(Layer.succeed(References.MinimumLogLevel, "Debug")),
          ),
        ).pipe(Scope.provide(scope)),
      );
      const address = Context.get(context, HttpServer.HttpServer).address;
      if (address._tag === "UnixPathAddress") throw new Error("expected a TCP address");
      const url = `http://127.0.0.1:${address.port}`;
      const browser = new Browser(url);
      await browser.request("POST", "/api/auth/setup", {
        username: "admin",
        displayName: "Admin",
        password,
      });
      const controller = new AbortController();
      const response = await fetch(`${url}/api/events`, {
        headers: {
          cookie: [...browser.cookies].map(([name, value]) => `${name}=${value}`).join("; "),
        },
        signal: controller.signal,
      });
      expect(response.status).toBe(200);
      const reader = response.body!.getReader();
      expect(new TextDecoder().decode((await reader.read()).value)).toContain("Connected");
      controller.abort();
      await expect
        .poll(() => lines.filter((line) => line.message.includes("GET /api/events")), {
          timeout: 5000,
        })
        .toContainEqual({ level: "Debug", message: "GET /api/events ended: the client went away" });
      expect(lines.filter((line) => line.level === "Error")).toEqual([]);
    } finally {
      await Effect.runPromise(Scope.close(scope, Exit.void));
      rmSync(root, { recursive: true, force: true });
    }
  });
});
