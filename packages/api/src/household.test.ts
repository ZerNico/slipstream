import { assert, describe, it, layer } from "@effect/vitest";
import { DateTime, Effect, Layer, Redacted } from "effect";
import { HttpClientRequest, HttpServer } from "effect/http";
import { HttpApiBuilder, HttpApiMiddleware, HttpApiTest } from "effect/http-api";
import {
  ChannelId,
  CollectionId,
  defaultExtraTime,
  fullAccess,
  type GuestInvite,
  InviteId,
  inviteLifetimeMillis,
  PlaybackSessionId,
  type Profile,
  ProgrammeId,
  RecordingId,
  resolveArtwork,
  SourceId,
  type User,
  UserId,
} from "@slipstream/domain";
import { openApiSpec, SlipstreamApi } from "./api.ts";
import {
  Forbidden,
  InvalidCredentials,
  InviteInvalid,
  NotFound,
  ProfileLocked,
  Unauthorized,
} from "./errors.ts";
import { frameContentType, frameUrl } from "./groups/artwork.ts";
import { inviteUrl } from "./groups/guests.ts";
import type { RecordingSettings } from "./groups/settings.ts";
import { Authentication, CurrentUser } from "./security.ts";

const createdAt = DateTime.makeUnsafe("2026-11-01T00:00:00Z");
const now = DateTime.makeUnsafe("2026-11-22T17:42:00Z");
const skyF1 = ChannelId.make("sky-sport-f1");
const kidsCollection = CollectionId.make("kids");

const jonas: Profile = {
  id: UserId.make("jonas"),
  displayName: "Jonas",
  role: "admin",
  kind: "household",
  avatarTone: "amber",
  hasPin: false,
  access: fullAccess,
  createdAt,
};
const mara: Profile = { ...jonas, id: UserId.make("mara"), displayName: "Mara", role: "user" };
const kids: Profile = {
  ...mara,
  id: UserId.make("kids"),
  displayName: "Kids",
  avatarTone: "green",
  hasPin: false,
  access: {
    channelIds: [ChannelId.make("kika")],
    collectionIds: [kidsCollection],
    mayRecord: true,
  },
};
const pins = new Map<string, string>([[mara.id, "0815"]]);

const asUser = (profile: Profile): User => ({
  id: profile.id,
  username: profile.id,
  displayName: profile.displayName,
  role: profile.role,
  createdAt: profile.createdAt,
});

const AuthenticationLive = Layer.succeed(Authentication)({
  cookie: () => Effect.fail(new Unauthorized()),
  bearer: (effect, { credential }) => {
    const profile = [jonas, mara, kids].find((p) => `${p.id}-token` === Redacted.value(credential));
    return profile === undefined
      ? Effect.fail(new Unauthorized())
      : Effect.provideService(effect, CurrentUser, asUser(profile));
  },
});

const profiles = [jonas, mara, kids];
const byId = (id: string) => profiles.find((profile) => profile.id === id);

/** An in-memory profiles handler that follows the contract's switching rules. */
const ProfilesHandlers = HttpApiBuilder.group(SlipstreamApi, "profiles", (handlers) =>
  handlers.handleAll({
    list: () => Effect.succeed(profiles),
    me: () =>
      Effect.gen(function* () {
        const user = yield* CurrentUser;
        return byId(user.id) ?? jonas;
      }),
    create: () => Effect.fail(new Forbidden()),
    update: ({ params }) => Effect.fail(new NotFound({ entity: "user", id: params.userId })),
    remove: () => Effect.fail(new Forbidden()),
    setPin: () => Effect.fail(new Forbidden()),
    verifyPin: ({ params, payload }) =>
      pins.get(params.userId) === payload.pin ? Effect.void : Effect.fail(new InvalidCredentials()),
    switch: ({ params, payload }) => {
      const target = byId(params.userId);
      if (target === undefined) {
        return Effect.fail(new NotFound({ entity: "user", id: params.userId }));
      }
      const pin = pins.get(target.id);
      if (pin !== undefined && payload.secret === undefined) {
        return Effect.fail(new ProfileLocked({ requires: "pin" }));
      }
      if (pin !== undefined && payload.secret !== pin) {
        return Effect.fail(new InvalidCredentials());
      }
      return Effect.succeed({ user: asUser(target), expiresAt: now });
    },
  }),
);

const invite: GuestInvite = {
  id: InviteId.make("lisa"),
  name: "Lisa",
  access: { collectionIds: [CollectionId.make("films")], mayRecord: true, maxStreams: 1 },
  createdBy: jonas.id,
  createdAt,
  expiresAt: DateTime.makeUnsafe(
    DateTime.toEpochMillis(createdAt) + (inviteLifetimeMillis("sevenDays") ?? 0),
  ),
  url: inviteUrl("https://tv.example.com/", "secret-token"),
};

const InvitesHandlers = HttpApiBuilder.group(SlipstreamApi, "invites", (handlers) =>
  handlers.handleAll({
    lookup: ({ payload }) =>
      payload.token === "secret-token"
        ? Effect.succeed({
            name: invite.name,
            invitedBy: jonas.displayName,
            access: invite.access,
            ...(invite.expiresAt === undefined ? {} : { expiresAt: invite.expiresAt }),
          })
        : Effect.fail(new InviteInvalid({ reason: "used" })),
    accept: () => Effect.fail(new InviteInvalid({ reason: "expired" })),
  }),
);

let settings: RecordingSettings = {
  extraTime: {
    padding: { beforeMinutes: 2, afterMinutes: 10 },
    overrides: [
      { _tag: "Channel", channelId: skyF1, padding: { beforeMinutes: 5, afterMinutes: 60 } },
    ],
  },
  artworkOrder: ["guide", "frame"],
};

const SettingsHandlers = HttpApiBuilder.group(SlipstreamApi, "settings", (handlers) =>
  handlers.handleAll({
    recording: () => Effect.sync(() => settings),
    artwork: () => Effect.succeed({ tmdb: false }),
    saveArtwork: () => Effect.succeed({ tmdb: false }),
    saveRecording: ({ payload }) =>
      Effect.gen(function* () {
        const user = yield* CurrentUser;
        if (user.role !== "admin") return yield* new Forbidden();
        settings = payload;
        return payload;
      }),
    playback: () => Effect.die("not used in this test"),
    savePlayback: () => Effect.die("not used in this test"),
  }),
);

const frameBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
const race = RecordingId.make("r-q");
const grabbedAt = DateTime.makeUnsafe("2026-11-22T17:10:00Z");

const ArtworkHandlers = HttpApiBuilder.group(SlipstreamApi, "artwork", (handlers) =>
  handlers.handleAll({
    resolve: ({ query }) =>
      Effect.succeed(
        (query.recordingIds ?? "")
          .split(",")
          .filter((id) => id === race)
          .map((id) => ({
            target: { _tag: "Recording" as const, recordingId: RecordingId.make(id) },
            artwork: resolveArtwork(
              {
                channelId: skyF1,
                title: "Live F1: Qualifying",
                categories: ["Sport"],
                frame: { recordingId: race, grabbedAt },
              },
              settings.artworkOrder,
            ),
          })),
      ),
    frame: ({ params }) =>
      params.recordingId === race
        ? Effect.succeed(frameBytes)
        : Effect.fail(new NotFound({ entity: "frame", id: params.recordingId })),
  }),
);

const StreamsHandlers = HttpApiBuilder.group(SlipstreamApi, "streams", (handlers) =>
  handlers.handleAll({
    list: () =>
      Effect.succeed([
        {
          sourceId: SourceId.make("tvproxy"),
          name: "tvproxy",
          counts: { maxStreams: 4, keptForRecordings: 2, recording: 2, watching: 2 },
          uses: [
            {
              _tag: "Watching" as const,
              channelId: ChannelId.make("arte"),
              playbackSessionId: PlaybackSessionId.make("kitchen"),
              since: now,
              deviceName: "Kitchen Shield",
            },
          ],
        },
      ]),
    stopWatching: ({ params }) =>
      params.playbackSessionId === "kitchen"
        ? Effect.void
        : Effect.fail(new NotFound({ entity: "playbackSession", id: params.playbackSessionId })),
  }),
);

const ProgrammesHandlers = HttpApiBuilder.group(SlipstreamApi, "programmes", (handlers) =>
  handlers.handleAll({
    recordOptions: ({ params }) =>
      Effect.succeed({
        programmeId: params.programmeId,
        extraTime: defaultExtraTime(settings.extraTime, {
          channelIds: [skyF1],
          categories: ["Sport"],
        }),
        automaticGroup: {
          source: "title" as const,
          folders: [{ _tag: "Text" as const, text: "Live F1" }],
          item: { _tag: "Airing" as const, start: now },
        },
        status: { _tag: "Household" as const, adminId: jonas.id },
        every: { kind: "broadcasts" as const, name: "Live F1" },
      }),
  }),
);

const as = (profile: Profile) =>
  HttpApiMiddleware.layerClient(Authentication, ({ next, request }) =>
    next(HttpClientRequest.bearerToken(request, `${profile.id}-token`)),
  );

const makeClient = HttpApiTest.groups(SlipstreamApi, [
  "profiles",
  "invites",
  "settings",
  "artwork",
  "streams",
  "programmes",
]);

describe("household groups in openapi.json", () => {
  const spec = JSON.parse(JSON.stringify(openApiSpec())) as {
    paths: Record<string, Record<string, { responses?: Record<string, { content?: object }> }>>;
  };

  it("serves frames as JPEG bytes", () => {
    const content = spec.paths["/api/artwork/frames/{recordingId}"]?.get?.responses?.["200"]
      ?.content as Record<string, unknown> | undefined;
    assert.deepStrictEqual(Object.keys(content ?? {}), [frameContentType]);
  });

  it("keeps invite tokens out of paths so request logs never hold them", () => {
    assert.isFalse(Object.keys(spec.paths).some((path) => path.includes("token}")));
  });

  it("builds frame and invite URLs that change with the frame and escape the token", () => {
    assert.strictEqual(frameUrl(race, grabbedAt), `/api/artwork/frames/r-q?v=1795367400000`);
    assert.strictEqual(
      inviteUrl("http://192.168.12.11:8080", "a b"),
      "http://192.168.12.11:8080/invite?token=a%20b",
    );
  });
});

layer(
  Layer.mergeAll(
    Layer.mergeAll(
      ProfilesHandlers,
      InvitesHandlers,
      SettingsHandlers,
      ArtworkHandlers,
      StreamsHandlers,
      ProgrammesHandlers,
    ).pipe(Layer.provideMerge(AuthenticationLive)),
    HttpServer.layerServices,
  ),
)("household groups round trip", (test) => {
  test.effect("lists profiles with their locks and access, and knows who is asking", () =>
    Effect.gen(function* () {
      const client = yield* makeClient;
      const list = yield* client.profiles.list();
      assert.deepStrictEqual(
        list.map((profile) => [profile.displayName, profile.hasPin]),
        [
          ["Jonas", false],
          ["Mara", false],
          ["Kids", false],
        ],
      );
      const me = yield* client.profiles.me();
      assert.strictEqual(me.displayName, "Kids");
      assert.deepStrictEqual(me.access.collectionIds, [kidsCollection]);
    }).pipe(Effect.provide(as(kids))),
  );

  test.effect("asks for the PIN before switching to a locked profile", () =>
    Effect.gen(function* () {
      const client = yield* makeClient;
      const locked = yield* client.profiles
        .switch({ params: { userId: mara.id }, payload: {} })
        .pipe(Effect.flip);
      assert.strictEqual(locked._tag, "ProfileLocked");
      assert.deepInclude(locked, { requires: "pin" });
      const wrong = yield* client.profiles
        .switch({ params: { userId: mara.id }, payload: { secret: "1234" } })
        .pipe(Effect.flip);
      assert.strictEqual(wrong._tag, "InvalidCredentials");
      const switched = yield* client.profiles.switch({
        params: { userId: mara.id },
        payload: { secret: "0815" },
      });
      assert.strictEqual(switched.user.id, mara.id);
      yield* client.profiles.verifyPin({ params: { userId: mara.id }, payload: { pin: "0815" } });
    }).pipe(Effect.provide(as(jonas))),
  );

  test.effect("looks an invite up without signing in and reports used links", () =>
    Effect.gen(function* () {
      const client = yield* makeClient;
      const preview = yield* client.invites.lookup({ payload: { token: "secret-token" } });
      assert.strictEqual(preview.invitedBy, "Jonas");
      assert.strictEqual(preview.access.maxStreams, 1);
      const used = yield* client.invites.lookup({ payload: { token: "old" } }).pipe(Effect.flip);
      assert.deepInclude(used, { _tag: "InviteInvalid", reason: "used" });
    }),
  );

  test.effect("saves recording defaults as admin and refuses other profiles", () =>
    Effect.gen(function* () {
      const admin = yield* makeClient.pipe(Effect.provide(as(jonas)));
      const other = yield* makeClient.pipe(Effect.provide(as(mara)));
      const saved = yield* admin.settings.saveRecording({
        payload: {
          ...settings,
          extraTime: { ...settings.extraTime, padding: { beforeMinutes: 3, afterMinutes: 15 } },
        },
      });
      assert.deepStrictEqual(saved.extraTime.padding, { beforeMinutes: 3, afterMinutes: 15 });
      const refused = yield* other.settings.saveRecording({ payload: settings }).pipe(Effect.flip);
      assert.strictEqual(refused._tag, "Forbidden");
      const read = yield* other.settings.recording();
      assert.deepStrictEqual(read.extraTime.padding, { beforeMinutes: 3, afterMinutes: 15 });
    }),
  );

  test.effect("names the channel default in the record options of a sport programme", () =>
    Effect.gen(function* () {
      const client = yield* makeClient;
      const options = yield* client.programmes.recordOptions({
        params: { programmeId: ProgrammeId.make("qualifying") },
      });
      assert.deepStrictEqual(options.extraTime, {
        padding: { beforeMinutes: 5, afterMinutes: 60 },
        source: { _tag: "Channel", channelId: skyF1 },
      });
      assert.strictEqual(options.goesTo, undefined);
      assert.deepStrictEqual(options.status, { _tag: "Household", adminId: jonas.id });
    }).pipe(Effect.provide(as(kids))),
  );

  test.effect("resolves artwork to the frame and serves its bytes", () =>
    Effect.gen(function* () {
      const client = yield* makeClient;
      const [entry, ...rest] = yield* client.artwork.resolve({
        query: { recordingIds: `${race},unknown` },
      });
      assert.strictEqual(rest.length, 0);
      assert.deepStrictEqual(entry?.artwork, { _tag: "Frame", recordingId: race, grabbedAt });
      const bytes = yield* client.artwork.frame({ params: { recordingId: race }, query: {} });
      assert.deepStrictEqual([...bytes], [...frameBytes]);
      const missing = yield* client.artwork
        .frame({ params: { recordingId: RecordingId.make("failed") }, query: {} })
        .pipe(Effect.flip);
      assert.deepInclude(missing, { _tag: "NotFound", entity: "frame" });
    }).pipe(Effect.provide(as(jonas))),
  );

  test.effect("names who uses the watching streams and stops one", () =>
    Effect.gen(function* () {
      const client = yield* makeClient;
      const [tvproxy] = yield* client.streams.list();
      const use = tvproxy?.uses[0];
      assert.strictEqual(use?._tag === "Watching" ? use.deviceName : undefined, "Kitchen Shield");
      yield* client.streams.stopWatching({
        params: { playbackSessionId: PlaybackSessionId.make("kitchen") },
      });
    }).pipe(Effect.provide(as(mara))),
  );
});
