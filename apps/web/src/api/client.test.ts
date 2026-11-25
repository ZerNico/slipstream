import { afterEach, describe, expect, it } from "vitest";
import { localParts, RecordingId, UserId } from "@slipstream/domain";
import { csrfCookie, type ServerEvent } from "@slipstream/api";
import { clientsLayer, makeApi, readCookie, type Api, type EventsStatus } from "./client.ts";
import { ApiError, problemOf } from "./errors.ts";
import { mockTimeZone } from "./mock/fixtures.ts";
import { mockPassword } from "./mock/server.ts";
import { mockApi } from "./mock/testing.ts";
import { mockOrigin } from "./mock/household.ts";

const disposers: Array<() => Promise<void>> = [];
const start = (...args: Parameters<typeof mockApi>) => {
  const mock = mockApi(...args);
  disposers.push(mock.api.dispose, mock.server.dispose);
  return mock;
};
afterEach(async () => {
  await Promise.all(disposers.splice(0).map((dispose) => dispose()));
});

const signIn = (api: Api) =>
  api.call((client) =>
    client.auth.login({ payload: { username: "alex", password: mockPassword } }),
  );

/** A write that needs the CSRF header when the session is a cookie. */
const unprotect = (api: Api) =>
  api.call((client) =>
    client.recordings.update({
      params: { recordingId: RecordingId.make("der-pate") },
      payload: { protected: false },
    }),
  );

describe("api client against the mock server", () => {
  it("reports a missing session as Unauthorized, then works after signing in", async () => {
    const { api } = start();
    const before = await api.call((client) => client.auth.me()).catch((error: unknown) => error);
    expect(before).toBeInstanceOf(ApiError);
    expect(problemOf(before)._tag).toBe("Unauthorized");

    const result = await signIn(api);
    expect(result.user.username).toBe("alex");
    const me = await api.call((client) => client.auth.me());
    expect(me.displayName).toBe("Alex");
  });

  it("turns declared errors into typed problems", async () => {
    const { api } = start();
    const wrong = await api
      .call((client) =>
        client.auth.login({ payload: { username: "alex", password: "not the password" } }),
      )
      .then(() => undefined, problemOf);
    expect(wrong?._tag).toBe("InvalidCredentials");

    await signIn(api);
    const missing = await api
      .call((client) =>
        client.recordings.get({ params: { recordingId: RecordingId.make("nope") } }),
      )
      .catch(problemOf);
    expect(missing).toMatchObject({ _tag: "NotFound", entity: "recording", id: "nope" });
  });

  it("reports an unreachable server as Offline", async () => {
    const api = makeApi(
      clientsLayer({
        baseUrl: mockOrigin,
        fetch: () => Promise.reject(new TypeError("Failed to fetch")),
      }),
    );
    disposers.push(api.dispose);
    const problem = await api.call((client) => client.system.health()).catch(problemOf);
    expect(problem).toEqual({ _tag: "Offline" });
  });

  it("decodes instants from the wire into DateTime values", async () => {
    const { api, server } = start();
    await signIn(api);
    const recordings = await api.call((client) => client.recordings.list({ query: {} }));
    // Every recording but the hidden ones (a replaced original, a chain's anchor).
    expect(recordings).toHaveLength(
      server.data.recordings.filter((entry) => entry.hiddenAt === undefined).length,
    );
    const race = recordings.find((entry) => entry.id === "rennen-las-vegas");
    expect(race?.state).toBe("recording");
    expect(race?.group.folders.map((segment) => segment._tag)).toEqual(["Text", "Text", "Text"]);
  });

  it("follows the event stream and stops when asked", async () => {
    const { api, server } = start();
    await signIn(api);
    const events: ServerEvent[] = [];
    const statuses: EventsStatus[] = [];
    const opened = new Promise<void>((resolve) => {
      const stop = api.events(
        (event) => events.push(event),
        (status) => {
          statuses.push(status);
          if (status === "open") resolve();
        },
      );
      disposers.push(async () => stop());
    });
    await opened;
    const event: ServerEvent = {
      _tag: "RecordingChanged",
      recordingId: RecordingId.make("rennen-las-vegas"),
      state: "completed",
    };
    // "open" means the server's Connected event arrived, so it is subscribed by now.
    expect(events.map((received) => received._tag)).toEqual(["Connected"]);
    server.publish(event);
    await expect.poll(() => events.length).toBe(2);
    expect(events[1]).toEqual(event);
    expect(statuses.slice(0, 2)).toEqual(["connecting", "open"]);
  });

  it("echoes the CSRF cookie on writes, which a cookie session needs", async () => {
    const { server } = start();
    let cookies = "";
    // A browser's cookie jar: keeps what the server sets and sends it back.
    const jarFetch: typeof globalThis.fetch = async (input, init) => {
      const request = new Request(input, init);
      const headers = new Headers(request.headers);
      if (cookies !== "") headers.set("cookie", cookies);
      const response = await server.handler(new Request(request, { headers }));
      for (const header of response.headers.getSetCookie()) {
        const [pair = ""] = header.split(";");
        const [name = ""] = pair.split("=");
        const kept = cookies.split("; ").filter((c) => c !== "" && !c.startsWith(`${name}=`));
        cookies = [...kept, pair].join("; ");
      }
      return response;
    };
    const csrf = () => readCookie(cookies, csrfCookie);
    const baseUrl = mockOrigin;
    const withHeader = makeApi(clientsLayer({ baseUrl, fetch: jarFetch, csrfToken: csrf }));
    const withoutHeader = makeApi(
      clientsLayer({ baseUrl, fetch: jarFetch, csrfToken: () => undefined }),
    );
    disposers.push(withHeader.dispose, withoutHeader.dispose);

    await signIn(withHeader);
    expect(csrf()).toBeDefined();
    expect((await unprotect(withHeader)).protected).toBe(false);
    expect(await unprotect(withoutHeader).then(() => undefined, problemOf)).toEqual(
      expect.objectContaining({ _tag: "Unauthorized" }),
    );
    // Reads need no token.
    expect((await withoutHeader.call((client) => client.auth.me())).username).toBe("alex");
  });

  it("reads one cookie out of a cookie header", () => {
    expect(readCookie("a=1; slipstream_csrf=x%3Dy; b=2", csrfCookie)).toBe("x=y");
    expect(readCookie("a=1", csrfCookie)).toBeUndefined();
  });

  it("gives every library entry the caller's watched state, and filters by it", async () => {
    const { api } = start();
    await signIn(api);
    const unwatched = await api.call((client) =>
      client.recordings.list({ query: { watched: false } }),
    );
    expect(unwatched.some((entry) => entry.id === "weekend-1")).toBe(false);
    expect(unwatched.some((entry) => entry.id === "weekend-4")).toBe(true);
    const resumed = await api.call((client) =>
      client.recordings.get({ params: { recordingId: RecordingId.make("weekend-4") } }),
    );
    expect(resumed).toMatchObject({ watched: false, positionMillis: 61 * 60_000 });
  });

  it("previews a rule with the similar programmes it won't record", async () => {
    const { api, server } = start();
    await signIn(api);
    const rule = server.data.rules.find((candidate) => candidate.id === "tatort");
    const tatort = server.data.programmes.find((programme) => programme.title === "Tatort");
    if (rule === undefined || tatort === undefined) throw new Error("fixture missing");
    const { id: _id, ownerId: _owner, createdAt: _created, ...input } = rule;
    const airs = localParts(tatort.start, mockTimeZone).weekday;
    const other = airs === "mon" ? "tue" : "mon";
    const preview = await api.call((client) =>
      client.rules.preview({
        payload: { rule: { ...input, matcher: { ...input.matcher, weekdays: [other] } } },
      }),
    );
    expect(preview.matches).toEqual([]);
  });

  it("looks up a TV's code and approves it as another profile", async () => {
    const { api, server } = start();
    await signIn(api);
    const pending = await api.call((client) =>
      client.auth.pendingDeviceCode({ params: { userCode: "qk7-4rm" } }),
    );
    expect(pending.device.name).toBe("Living Room Shield");
    const household = UserId.make("household");
    const result = await api.call((client) =>
      client.auth.approveDeviceCode({
        payload: { userCode: "QK74RM", approve: true, userId: household },
      }),
    );
    expect(result.userId).toBe(household);
    expect(server.data.devices.filter((device) => device.userId === household)).toHaveLength(2);
  });

  it("keeps the last admin and refuses taken usernames", async () => {
    const { api } = start();
    await signIn(api);
    const demote = await api
      .call((client) =>
        client.profiles.update({
          params: { userId: UserId.make("alex") },
          payload: { role: "user" },
        }),
      )
      .then(() => undefined, problemOf);
    expect(demote).toEqual(expect.objectContaining({ _tag: "Conflict", code: "lastAdmin" }));
    const taken = await api
      .call((client) =>
        client.profiles.create({
          payload: {
            displayName: "Kim",
            avatarTone: "teal",
            login: { username: "kim", password: "long enough!" },
          },
        }),
      )
      .then(() => undefined, problemOf);
    expect(taken).toEqual(expect.objectContaining({ _tag: "Conflict", code: "usernameTaken" }));
  });

  it("hands out source views without secrets", async () => {
    const { api } = start();
    await signIn(api);
    const sources = await api.call((client) => client.sources.list());
    const backup = sources.find((source) => source.id === "backup-iptv");
    expect(backup?.config).toEqual({
      _tag: "M3u",
      playlistUrl: {
        url: "http://iptv.example/get.php?username=***&password=***&type=m3u",
        hasCredentials: true,
      },
    });
    expect(JSON.stringify(sources)).not.toContain("hunter22");
  });
});
