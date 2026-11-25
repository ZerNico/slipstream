/**
 * The household groups through the real HTTP server, against a guide from
 * `@slipstream/fake-source`: household profiles with PINs and profile switching (browser and
 * household TV), guests by invite with their access enforced in the services, recording settings
 * and the default extra time, per-profile record options, artwork, collection and rule previews,
 * and the stream budget.
 */
import { Effect, Layer, Redacted } from "effect";
import { FetchHttpClient, HttpClientRequest } from "effect/http";
import { HttpApiClient, HttpApiMiddleware } from "effect/http-api";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Authentication, SlipstreamApi } from "@slipstream/api";
import { startFakeSource, type RunningFakeSource } from "@slipstream/fake-source";
import { Browser, startTestServer, type TestServer } from "./harness.ts";

let server: TestServer;
let fake: RunningFakeSource & { close(): Promise<void> };
let admin: Browser;
let adminId: string;
const password = "correct horse battery staple";

interface Channel {
  readonly id: string;
  readonly name: string;
}
interface Programme {
  readonly id: string;
  readonly channelId: string;
  readonly start: string;
  readonly end: string;
  readonly title: string;
  readonly categories: ReadonlyArray<string>;
}

let sourceId: string;
let news: Channel;
let f1: Channel;
/** An upcoming news programme, far enough ahead that recording it starts no capture. */
let upcoming: Programme;

beforeAll(async () => {
  [server, fake] = await Promise.all([startTestServer(), startFakeSource()]);
  admin = new Browser(server.url);
  const setup = await admin.request("POST", "/api/auth/setup", {
    username: "admin",
    displayName: "Admin",
    password,
  });
  adminId = (setup.json as { user: { id: string } }).user.id;
  const source = await admin.request("POST", "/api/sources", {
    name: "Fake",
    config: {
      _tag: "M3u",
      playlistUrl: `${fake.url}/playlist.m3u`,
      guideUrl: `${fake.url}/epg.xml`,
    },
    refreshIntervalMinutes: 60,
    headers: {},
    guideCleanup: { removeDuplicates: true, rewrites: [] },
    enabled: true,
  });
  sourceId = (source.json as { id: string }).id;
  await admin.request("POST", `/api/sources/${sourceId}/refresh`);
  const channels = (await admin.request("GET", "/api/channels")).json as Array<Channel>;
  news = channels.find((channel) => channel.name === "Nachrichten 24")!;
  f1 = channels.find((channel) => channel.name === "Sportkanal F1 HD")!;
  const from = new Date();
  const to = new Date(from.getTime() + 8 * 3_600_000);
  const guide = (
    await admin.request(
      "GET",
      `/api/guide?from=${from.toISOString()}&to=${to.toISOString()}&channels=${news.id}`,
    )
  ).json as Array<Programme>;
  upcoming = guide.find(
    (programme) =>
      programme.categories.includes("Nachrichten") &&
      Date.parse(programme.start) > Date.now() + 40 * 60_000,
  )!;
});

afterAll(async () => {
  await Promise.all([server?.close(), fake?.close()]);
});

const signIn = async (username: string, secret: string) => {
  const browser = new Browser(server.url);
  await browser.request("POST", "/api/auth/login", { username, password: secret });
  return browser;
};

/** A client that signs every request with a bearer token, like the TV app. */
const bearer = (token: string) => {
  const client = new Browser(server.url);
  return (method: string, path: string, body?: unknown) =>
    client.request(method, path, body, { authorization: `Bearer ${token}` });
};

let miaId: string;

describe("household profiles", () => {
  it("lets admins add profiles and checks what they send", async () => {
    const created = await admin.request("POST", "/api/profiles", {
      displayName: "Mia",
      avatarTone: "rose",
      access: { channelIds: [news.id], mayRecord: false },
    });
    expect(created.status).toBe(200);
    expect(created.json).toMatchObject({
      displayName: "Mia",
      role: "user",
      kind: "household",
      avatarTone: "rose",
      hasPin: false,
      access: { channelIds: [news.id], mayRecord: false },
    });
    miaId = (created.json as { id: string }).id;

    const lockedOut = await admin.request("POST", "/api/profiles", {
      displayName: "Papa",
      avatarTone: "blue",
      role: "admin",
    });
    expect(lockedOut.status).toBe(422);
    expect(lockedOut.json).toMatchObject({ problems: [{ path: "pin", code: "requiredForAdmin" }] });

    const unknown = await admin.request("POST", "/api/profiles", {
      displayName: "Ghost",
      avatarTone: "teal",
      access: { channelIds: ["nope"], mayRecord: true },
    });
    expect(unknown.json).toMatchObject({
      problems: [{ path: "access.channelIds.0", code: "unknownChannel" }],
    });

    const list = (await admin.request("GET", "/api/profiles")).json as Array<{ id: string }>;
    expect(list.map((profile) => profile.id)).toEqual([adminId, miaId]);
    expect((await admin.request("GET", "/api/profiles/me")).json).toMatchObject({
      id: adminId,
      role: "admin",
      access: { mayRecord: true },
    });
  });

  it("keeps the last admin", async () => {
    const demote = await admin.request("PATCH", `/api/profiles/${adminId}`, { role: "user" });
    expect(demote.status).toBe(409);
    expect(demote.json).toMatchObject({ _tag: "Conflict", code: "lastAdmin" });
  });

  it("switches a browser to a profile with its PIN, and back to the admin with the password", async () => {
    expect((await admin.request("PUT", `/api/profiles/${miaId}/pin`, { pin: "1234" })).status).toBe(
      204,
    );
    const browser = await signIn("admin", password);

    const locked = await browser.request("POST", `/api/profiles/${miaId}/switch`, {});
    expect(locked.status).toBe(403);
    expect(locked.json).toMatchObject({ _tag: "ProfileLocked", requires: "pin" });
    const wrong = await browser.request("POST", `/api/profiles/${miaId}/switch`, {
      secret: "0000",
    });
    expect(wrong.status).toBe(401);
    const oldCookie = browser.cookies.get("slipstream_session");
    const switched = await browser.request("POST", `/api/profiles/${miaId}/switch`, {
      secret: "1234",
    });
    expect(switched.status).toBe(200);
    expect(switched.json).toMatchObject({ user: { id: miaId, displayName: "Mia" } });
    expect(browser.cookies.get("slipstream_session")).not.toBe(oldCookie);

    // The old browser session ended with the switch.
    const stale = new Browser(server.url);
    stale.cookies.set("slipstream_session", oldCookie ?? "");
    expect((await stale.request("GET", "/api/auth/me")).status).toBe(401);

    // Mia sees only her channel and may not record.
    expect((await browser.request("GET", "/api/profiles/me")).json).toMatchObject({
      id: miaId,
      hasPin: true,
    });
    const channels = (await browser.request("GET", "/api/channels")).json as Array<Channel>;
    expect(channels.map((channel) => channel.id)).toEqual([news.id]);
    expect((await browser.request("GET", `/api/channels/${f1.id}`)).status).toBe(404);
    const record = await browser.request("POST", "/api/recordings", {
      _tag: "Programme",
      programmeId: upcoming.id,
    });
    expect(record.status).toBe(403);
    const access = await browser.request("PATCH", `/api/profiles/${miaId}`, {
      access: { mayRecord: true },
    });
    expect(access.status).toBe(403);
    expect(
      (await browser.request("PATCH", `/api/profiles/${miaId}`, { avatarTone: "green" })).json,
    ).toMatchObject({ avatarTone: "green" });

    // Her own PIN changes only with the current one.
    expect(
      (await browser.request("PUT", `/api/profiles/${miaId}/pin`, { pin: "4321" })).status,
    ).toBe(401);
    expect(
      (
        await browser.request("PUT", `/api/profiles/${miaId}/pin`, {
          pin: "4321",
          currentPin: "1234",
        })
      ).status,
    ).toBe(204);
    expect(
      (await browser.request("POST", `/api/profiles/${miaId}/pin/verify`, { pin: "4321" })).status,
    ).toBe(204);

    // The admin profile has no PIN, so it asks for the password.
    const toAdmin = await browser.request("POST", `/api/profiles/${adminId}/switch`, {});
    expect(toAdmin.json).toMatchObject({ _tag: "ProfileLocked", requires: "password" });
    const back = await browser.request("POST", `/api/profiles/${adminId}/switch`, {
      secret: password,
    });
    expect(back.json).toMatchObject({ user: { id: adminId, role: "admin" } });
  });

  it("approves a household TV that never acts as an admin and switches without a new token", async () => {
    const tv = new Browser(server.url);
    const grant = (await tv.request("POST", "/api/auth/device-code", {
      name: "Living Room Shield",
      kind: "tv",
    })) as { json: { deviceCode: string; userCode: string } };
    const approved = await admin.request("POST", "/api/auth/device-code/approve", {
      userCode: grant.json.userCode,
      approve: true,
      household: true,
    });
    expect(approved.json).toMatchObject({ userId: adminId });
    const login = (await tv.request("POST", "/api/auth/device-code/token", {
      deviceCode: grant.json.deviceCode,
    })) as { json: { token: string; device: { household?: boolean } } };
    expect(login.json.device.household).toBe(true);
    const call = bearer(login.json.token);
    expect((await call("GET", "/api/auth/me")).json).toMatchObject({ id: adminId, role: "user" });
    expect((await call("GET", "/api/guests")).status).toBe(403);

    const switched = await call("POST", `/api/profiles/${miaId}/switch`, { secret: "4321" });
    expect(switched.status).toBe(200);
    expect(switched.json).toMatchObject({ user: { id: miaId }, device: { household: true } });
    expect(switched.json).not.toHaveProperty("token");
    expect((await call("GET", "/api/auth/me")).json).toMatchObject({ id: miaId });
  });
});

/** Creates a guest invite for `name` and reads the token from its link. */
const invite = async (name: string) => {
  const created = await admin.request("POST", "/api/guests/invites", {
    name,
    access: { channelIds: [news.id], collectionIds: [], mayRecord: false, maxStreams: 1 },
    expiry: "sevenDays",
  });
  expect(created.status).toBe(200);
  const body = created.json as { id: string; url: string; expiresAt?: string };
  return { ...body, token: new URL(body.url).searchParams.get("token") ?? "" };
};

let lisaId: string;
let lisa: Browser;

describe("guests", () => {
  it("invites a guest by link, who accepts it exactly once", async () => {
    const created = await invite("Lisa");
    expect(created.url).toMatch(/\/invite\?token=/);
    expect(created.expiresAt).toBeDefined();
    const pending = (await admin.request("GET", "/api/guests/invites")).json as Array<{
      url: string;
    }>;
    expect(pending.map((entry) => entry.url)).toEqual([created.url]);

    const stranger = new Browser(server.url);
    expect(
      (await stranger.request("POST", "/api/invites/lookup", { token: created.token })).json,
    ).toMatchObject({ name: "Lisa", invitedBy: "Admin", access: { mayRecord: false } });
    expect(
      (await stranger.request("POST", "/api/invites/lookup", { token: "made-up" })).status,
    ).toBe(404);

    const taken = await stranger.request("POST", "/api/invites/accept", {
      token: created.token,
      username: "admin",
      password: "lisa password 1",
    });
    expect(taken.json).toMatchObject({ _tag: "Conflict", code: "usernameTaken" });
    lisa = new Browser(server.url);
    const accepted = await lisa.request("POST", "/api/invites/accept", {
      token: created.token,
      username: "Lisa",
      password: "lisa password 1",
    });
    expect(accepted.status).toBe(200);
    expect(accepted.json).toMatchObject({ user: { username: "lisa", displayName: "Lisa" } });
    lisaId = (accepted.json as { user: { id: string } }).user.id;

    const used = await stranger.request("POST", "/api/invites/lookup", { token: created.token });
    expect(used.status).toBe(410);
    expect(used.json).toMatchObject({ _tag: "InviteInvalid", reason: "used" });
    expect((await admin.request("GET", "/api/guests/invites")).json).toEqual([]);
  });

  it("shows a guest only what their access allows", async () => {
    expect((await lisa.request("GET", "/api/profiles")).json).toMatchObject([
      { id: lisaId, kind: "guest" },
    ]);
    expect((await lisa.request("POST", `/api/profiles/${adminId}/switch`, {})).status).toBe(403);
    const nowNext = (await lisa.request("GET", "/api/guide/now-next")).json as Array<{
      channelId: string;
    }>;
    expect(nowNext.map((entry) => entry.channelId)).toEqual([news.id]);
    expect((await lisa.request("GET", "/api/collections")).json).toEqual([]);
    expect((await lisa.request("GET", "/api/guests")).status).toBe(403);
    expect((await lisa.request("GET", "/api/recordings")).json).toEqual([]);
    const live = await lisa.request("POST", "/api/playback/sessions", {
      source: { _tag: "Live", channelId: f1.id },
      capabilities: {
        video: [],
        audio: [],
        audioPassthrough: [],
        hdr: false,
        canDeinterlace: true,
      },
      quality: { _tag: "Auto" },
    });
    expect(live.status).toBe(404);
  });

  it("lists guests with where they were last seen, and lets admins change them", async () => {
    const guests = (await admin.request("GET", "/api/guests")).json as Array<{
      id: string;
      lastSeenAt?: string;
      lastSeenFrom?: string;
    }>;
    expect(guests).toHaveLength(1);
    expect(guests[0]).toMatchObject({ id: lisaId, lastSeenFrom: "home" });
    expect(guests[0]?.lastSeenAt).toBeDefined();
    expect(
      (await admin.request("PATCH", `/api/guests/${lisaId}`, { displayName: "Lisa M." })).json,
    ).toMatchObject({ displayName: "Lisa M.", kind: "guest" });
    expect(
      (await admin.request("PATCH", `/api/guests/${adminId}`, { displayName: "X" })).status,
    ).toBe(404);
  });

  it("revokes an invite", async () => {
    const created = await invite("Tom");
    expect((await admin.request("DELETE", `/api/guests/invites/${created.id}`)).status).toBe(204);
    expect((await admin.request("DELETE", `/api/guests/invites/${created.id}`)).status).toBe(404);
    const lookup = await admin.request("POST", "/api/invites/lookup", { token: created.token });
    expect(lookup.json).toMatchObject({ _tag: "InviteInvalid", reason: "revoked" });
  });
});

let recordingId: string;

describe("recording settings and record options", () => {
  it("starts from the shipped defaults and validates what admins save", async () => {
    expect((await lisa.request("GET", "/api/settings/recording")).json).toEqual({
      extraTime: { padding: { beforeMinutes: 2, afterMinutes: 10 }, overrides: [] },
      artworkOrder: ["guide", "frame"],
    });
    const channelOverride = {
      _tag: "Channel",
      channelId: f1.id,
      padding: { beforeMinutes: 5, afterMinutes: 60 },
    };
    const duplicate = await admin.request("PUT", "/api/settings/recording", {
      extraTime: {
        padding: { beforeMinutes: 2, afterMinutes: 10 },
        overrides: [channelOverride, channelOverride],
      },
      artworkOrder: ["guide", "frame"],
    });
    expect(duplicate.status).toBe(422);
    expect(duplicate.json).toMatchObject({
      problems: [{ path: "extraTime.overrides.1", code: "duplicateChannel" }],
    });
    const unknown = await admin.request("PUT", "/api/settings/recording", {
      extraTime: {
        padding: { beforeMinutes: 2, afterMinutes: 10 },
        overrides: [{ ...channelOverride, channelId: "gone" }],
      },
      artworkOrder: [],
    });
    expect(unknown.status).toBe(404);
    const settings = {
      extraTime: {
        padding: { beforeMinutes: 2, afterMinutes: 10 },
        overrides: [
          channelOverride,
          {
            _tag: "Category",
            category: "nachrichten",
            padding: { beforeMinutes: 3, afterMinutes: 15 },
          },
        ],
      },
      artworkOrder: ["frame", "guide"],
    };
    expect((await lisa.request("PUT", "/api/settings/recording", settings)).status).toBe(403);
    expect((await admin.request("PUT", "/api/settings/recording", settings)).json).toEqual(
      settings,
    );
    expect((await admin.request("GET", "/api/settings/recording")).json).toEqual(settings);
  });

  it("answers record options and records with the default extra time", async () => {
    const options = await admin.request("GET", `/api/programmes/${upcoming.id}/record-options`);
    expect(options.status).toBe(200);
    expect(options.json).toMatchObject({
      programmeId: upcoming.id,
      extraTime: {
        padding: { beforeMinutes: 3, afterMinutes: 15 },
        source: { _tag: "Category", category: "nachrichten" },
      },
      goesTo: { automatic: true, newCollection: true, initial: { _tag: "Automatic" } },
      automaticGroup: { source: "title" },
      status: { _tag: "NotScheduled" },
    });

    const created = await admin.request("POST", "/api/recordings", {
      _tag: "Programme",
      programmeId: upcoming.id,
    });
    expect(created.status).toBe(200);
    expect(created.json).toMatchObject({
      padding: { beforeMinutes: 3, afterMinutes: 15 },
      artwork: { _tag: "Generated", style: "news", channelId: news.id },
    });
    recordingId = (created.json as { id: string }).id;
    expect(
      (await admin.request("GET", `/api/programmes/${upcoming.id}/record-options`)).json,
    ).toMatchObject({
      status: { _tag: "Recorded", recordingId, padding: { beforeMinutes: 3, afterMinutes: 15 } },
    });

    // Lisa sees the channel but not where the recording lands, and may not record.
    const forLisa = (await lisa.request("GET", `/api/programmes/${upcoming.id}/record-options`))
      .json as Record<string, unknown>;
    expect(forLisa).toMatchObject({ status: { _tag: "Household", adminId } });
    expect(forLisa).not.toHaveProperty("goesTo");
    expect((await lisa.request("GET", `/api/recordings/${recordingId}`)).status).toBe(404);

    // A programme on a channel she may not see does not exist for her.
    const nowNext = (await admin.request("GET", "/api/guide/now-next")).json as Array<{
      channelId: string;
      next?: Programme;
    }>;
    const hiddenId = nowNext.find((entry) => entry.channelId === f1.id)?.next?.id ?? "none";
    expect((await admin.request("GET", `/api/programmes/${hiddenId}/record-options`)).status).toBe(
      200,
    );
    expect((await lisa.request("GET", `/api/programmes/${hiddenId}/record-options`)).status).toBe(
      404,
    );
  });

  it("keeps server playback settings and the probe's result apart", async () => {
    const initial = (await admin.request("GET", "/api/settings/playback")).json;
    expect(initial).toEqual({
      hardwareAcceleration: "auto",
      preference: "quality",
      pictureConversions: "unlimited",
      quality: { home: "auto", away: "auto", mobile: "auto" },
    });
    const next = {
      hardwareAcceleration: "off",
      preference: "power",
      pictureConversions: "3",
      quality: { home: "original", away: "4000", mobile: "2000" },
    };
    expect((await lisa.request("PUT", "/api/settings/playback", next)).status).toBe(403);
    expect((await admin.request("PUT", "/api/settings/playback", next)).json).toEqual(next);
    expect((await lisa.request("GET", "/api/settings/playback")).json).toEqual(next);
    // Only the offered choices: no limit, automatic, or 1 to 10.
    for (const pictureConversions of ["0", "11", 2, "none"]) {
      expect(
        (await admin.request("PUT", "/api/settings/playback", { ...next, pictureConversions }))
          .status,
      ).toBe(400);
    }
  });

  it("keeps live TV running and its rewind buffer as an admin sets it", async () => {
    // Everyone reads the defaults: 10 minutes running, the buffer kept for an hour.
    expect((await lisa.request("GET", "/api/settings/live")).json).toEqual({
      keepRunning: 10,
      keepBufferMinutes: 60,
    });
    const next = { keepRunning: "programmeEnd", keepBufferMinutes: 0 };
    expect((await lisa.request("PUT", "/api/settings/live", next)).status).toBe(403);
    expect((await admin.request("PUT", "/api/settings/live", next)).json).toEqual(next);
    expect((await lisa.request("GET", "/api/settings/live")).json).toEqual(next);
    // Out of range: at most an hour running, at most a day of buffer.
    for (const invalid of [
      { keepRunning: 0, keepBufferMinutes: 60 },
      { keepRunning: 61, keepBufferMinutes: 60 },
      { keepRunning: 10, keepBufferMinutes: 24 * 60 + 1 },
    ]) {
      expect((await admin.request("PUT", "/api/settings/live", invalid)).status).toBe(400);
    }
    expect((await admin.request("GET", "/api/settings/live")).json).toEqual(next);
  });
});

describe("artwork", () => {
  it("resolves programmes and recordings, leaving out what the caller cannot see", async () => {
    const result = await admin.request(
      "GET",
      `/api/artwork?programmeIds=${upcoming.id},unknown&recordingIds=${recordingId}`,
    );
    expect(result.json).toEqual([
      {
        target: { _tag: "Programme", programmeId: upcoming.id },
        artwork: expect.objectContaining({ _tag: "Generated", style: "news" }),
      },
      {
        target: { _tag: "Recording", recordingId },
        artwork: expect.objectContaining({ _tag: "Generated", channelId: news.id }),
      },
    ]);
    const forLisa = (await lisa.request("GET", `/api/artwork?recordingIds=${recordingId}`)).json;
    expect(forLisa).toEqual([]);
    const frame = await admin.request("GET", `/api/artwork/frames/${recordingId}`);
    expect(frame.status).toBe(404);
    expect(frame.json).toMatchObject({ entity: "frame" });
    expect((await lisa.request("GET", `/api/artwork/frames/${recordingId}`)).json).toMatchObject({
      entity: "recording",
    });
  });
});

/** A matcher for the upcoming programme's title. */
const matcher = () => ({
  channels: [],
  title: [{ _tag: "IsExactly", values: [upcoming.title] }],
  categories: [],
  weekdays: [],
});

describe("previews", () => {
  it("previews a draft collection with where recordings come from and what stays elsewhere", async () => {
    const draft = {
      name: "Abendnachrichten",
      rank: 0,
      matcher: matcher(),
      labels: [],
      layout: { parts: [], path: ["{date}"] },
    };
    const first = (await admin.request("POST", "/api/collections/preview", { collection: draft }))
      .json as {
      recordings: Array<{ recordingId: string; from?: { source: string } }>;
      elsewhere?: Array<unknown>;
    };
    expect(first.recordings.find((entry) => entry.recordingId === recordingId)).toMatchObject({
      from: { source: "title" },
    });
    expect(first.elsewhere).toEqual([]);

    const pinned = await admin.request("POST", "/api/collections", { ...draft, name: "Pinned" });
    const pinnedId = (pinned.json as { id: string }).id;
    await admin.request("PATCH", `/api/recordings/${recordingId}`, {
      pinnedCollectionId: pinnedId,
    });
    const second = (await admin.request("POST", "/api/collections/preview", { collection: draft }))
      .json as { elsewhere?: Array<unknown> };
    expect(second.elsewhere).toEqual([
      { recordingId, title: upcoming.title, collectionId: pinnedId, reason: "pinned" },
    ]);
  });

  it("says where a rule's matches would land", async () => {
    const preview = (
      await admin.request("POST", "/api/rules/preview", {
        rule: {
          name: "News",
          enabled: true,
          matcher: matcher(),
          padding: { beforeMinutes: 1, afterMinutes: 2 },
          retention: { _tag: "KeepAll" },
        },
      })
    ).json as { matches: Array<{ group?: { source: string } }> };
    expect(preview.matches.length).toBeGreaterThan(0);
    expect(preview.matches[0]?.group).toBeDefined();
  });
});

describe("streams", () => {
  it("shows each source's budget and refuses live viewing when every stream is kept", async () => {
    expect(
      (
        await admin.request("PATCH", `/api/sources/${sourceId}`, {
          maxStreams: 1,
          keptForRecordings: 2,
        })
      ).status,
    ).toBe(422);
    const patched = await admin.request("PATCH", `/api/sources/${sourceId}`, {
      maxStreams: 1,
      keptForRecordings: 1,
    });
    expect(patched.json).toMatchObject({ maxStreams: 1, keptForRecordings: 1 });
    expect((await lisa.request("GET", "/api/streams")).json).toEqual([
      {
        sourceId,
        name: "Fake",
        counts: { maxStreams: 1, keptForRecordings: 1, recording: 0, watching: 0 },
        uses: [],
      },
    ]);
    const live = await admin.request("POST", "/api/playback/sessions", {
      source: { _tag: "Live", channelId: news.id },
      capabilities: {
        video: [],
        audio: [],
        audioPassthrough: [],
        hdr: false,
        canDeinterlace: true,
      },
      quality: { _tag: "Auto" },
    });
    expect(live.status).toBe(409);
    expect(live.json).toMatchObject({ _tag: "StreamLimitReached", reason: "sourceFull", sourceId });
    expect((await admin.request("POST", "/api/streams/watching/nope/stop")).status).toBe(404);
  });
});

describe("typed client", () => {
  it("decodes every new group's answers with the contract", async () => {
    const login = (await new Browser(server.url).request("POST", "/api/auth/login", {
      username: "admin",
      password,
      device: { name: "Pixel", kind: "phone" },
    })) as { json: { token: string } };
    const client = HttpApiClient.make(SlipstreamApi, { baseUrl: server.url }).pipe(
      Effect.provide(
        Layer.mergeAll(
          FetchHttpClient.layer,
          HttpApiMiddleware.layerClient(Authentication, ({ next, request }) =>
            next(HttpClientRequest.bearerToken(request, Redacted.make(login.json.token))),
          ),
        ),
      ),
    );
    const answers = await Effect.runPromise(
      Effect.flatMap(client, (api) =>
        Effect.all({
          me: api.profiles.me(),
          guests: api.guests.list(),
          settings: api.settings.recording(),
          playback: api.settings.playback(),
          streams: api.streams.list(),
          options: api.programmes.recordOptions({ params: { programmeId: upcoming.id as never } }),
          artwork: api.artwork.resolve({ query: { programmeIds: upcoming.id } }),
        }),
      ),
    );
    expect(answers.me.id).toBe(adminId);
    expect(answers.guests.map((guest) => guest.kind)).toEqual(["guest"]);
    expect(answers.settings.artworkOrder).toEqual(["frame", "guide"]);
    expect(answers.playback.pictureConversions).toBe("3");
    expect(answers.streams[0]?.counts.maxStreams).toBe(1);
    expect(answers.options.status._tag).toBe("Recorded");
    expect(answers.artwork[0]?.artwork._tag).toBe("Generated");
  });
});
