/**
 * `@slipstream/api` handlers: thin adapters from endpoints to services. Roles, profile access and
 * guest permissions are enforced in the services; handlers only pass the signed-in user (and,
 * where it matters, the request's credential and address) along.
 */
import { Effect, Layer } from "effect";
import { HttpEffect, HttpServerResponse } from "effect/http";
import { HttpApiBuilder } from "effect/http-api";
import { CurrentUser, SlipstreamApi } from "@slipstream/api";
import { Artwork } from "../artwork/service.ts";
import { Auth } from "../auth/service.ts";
import { Captures } from "../captures/service.ts";
import { Channels } from "../channels/service.ts";
import { Collections } from "../collections/service.ts";
import { ServerConfig } from "../config.ts";
import { Db } from "../db/client.ts";
import { EventBus } from "../events.ts";
import { sessionEvents } from "../household/events.ts";
import { Guests } from "../guests/service.ts";
import { Guide } from "../guide/service.ts";
import { Planning } from "../planning/service.ts";
import { Playback } from "../playback/service.ts";
import { Profiles } from "../profiles/service.ts";
import { Programmes } from "../programmes/service.ts";
import { Recordings } from "../recordings/service.ts";
import { Rules } from "../rules/service.ts";
import { OnlineArtwork } from "../artwork/online-artwork.ts";
import { Settings } from "../settings/service.ts";
import { Sources } from "../sources/service.ts";
import { Streams } from "../streams/service.ts";
import { SystemInfoService } from "../system/service.ts";
import {
  clearSessionCookies,
  clientAddress,
  currentPrincipal,
  requestCredential,
  requestOrigin,
  setSessionCookies,
} from "./authentication.ts";
import type { IssuedSession } from "../auth/service.ts";

/** Sets cookies for browser sign-ins and returns the API result. */
const respond = (issued: IssuedSession) =>
  Effect.as(
    issued.cookie === undefined ? Effect.void : setSessionCookies(issued.cookie),
    issued.result,
  );

const SystemHandlers = HttpApiBuilder.group(SlipstreamApi, "system", (handlers) =>
  Effect.gen(function* () {
    const system = yield* SystemInfoService;
    const bus = yield* EventBus;
    const auth = yield* Auth;
    const { read } = yield* Db;
    const config = yield* ServerConfig;
    return handlers.handleAll({
      health: () => Effect.succeed({ status: "ok" as const }),
      info: () => system.info,
      // The stream follows the sign-in the middleware resolved: fresh role and access per
      // event, and it ends with it.
      events: () =>
        Effect.map(currentPrincipal, (principal) =>
          sessionEvents({
            connect: bus.connect,
            householdChanges: bus.householdChanges,
            db: read,
            timeZone: config.timeZone,
            sessionUser: auth.sessionUser(principal.sessionId),
          }),
        ),
    });
  }),
);

const AuthHandlers = HttpApiBuilder.group(SlipstreamApi, "auth", (handlers) =>
  Effect.gen(function* () {
    const auth = yield* Auth;
    return handlers.handleAll({
      setupStatus: () => Effect.map(auth.setupRequired, (required) => ({ required })),
      setup: ({ payload }) => Effect.flatMap(auth.setup(payload), respond),
      login: ({ payload }) =>
        Effect.gen(function* () {
          const address = yield* clientAddress;
          // Signing in again as the account this browser or device is signed in as skips the
          // per-username backoff; a session of anyone else (a guest guessing the admin) does not.
          const signedInAs = yield* requestCredential.pipe(
            Effect.flatMap((token) => auth.authenticate(token)),
            Effect.map((principal) => principal.user),
            Effect.orElseSucceed(() => undefined),
          );
          return yield* respond(yield* auth.login(payload, address, signedInAs));
        }),
      startDeviceCode: ({ payload }) =>
        Effect.flatMap(clientAddress, (address) => auth.startDeviceCode(payload, address)),
      pollDeviceCode: ({ payload }) =>
        Effect.map(auth.pollDeviceCode(payload.deviceCode), (issued) => issued.result),
      pendingDeviceCode: ({ params }) => auth.pendingDeviceCode(params.userCode),
      approveDeviceCode: ({ payload }) =>
        Effect.flatMap(CurrentUser, (user) => auth.approveDeviceCode(user, payload)),
      logout: () =>
        requestCredential.pipe(Effect.flatMap(auth.logout), Effect.andThen(clearSessionCookies)),
      me: () => CurrentUser,
    });
  }),
);

const DevicesHandlers = HttpApiBuilder.group(SlipstreamApi, "devices", (handlers) =>
  Effect.gen(function* () {
    const auth = yield* Auth;
    return handlers.handleAll({
      list: () => Effect.flatMap(CurrentUser, auth.listDevices),
      rename: ({ params, payload }) =>
        Effect.flatMap(CurrentUser, (user) =>
          auth.renameDevice(user, params.deviceId, payload.name),
        ),
      revoke: ({ params }) =>
        Effect.flatMap(CurrentUser, (user) => auth.revokeDevice(user, params.deviceId)),
    });
  }),
);

const SourcesHandlers = HttpApiBuilder.group(SlipstreamApi, "sources", (handlers) =>
  Effect.gen(function* () {
    const sources = yield* Sources;
    const withUser = CurrentUser;
    return handlers.handleAll({
      // Sources are admin-only; for everyone else the list is simply empty.
      list: () =>
        Effect.flatMap(withUser, sources.list).pipe(
          Effect.catchTag("Forbidden", () => Effect.succeed([])),
        ),
      get: ({ params }) => Effect.flatMap(withUser, (user) => sources.get(user, params.sourceId)),
      create: ({ payload }) => Effect.flatMap(withUser, (user) => sources.create(user, payload)),
      update: ({ params, payload }) =>
        Effect.flatMap(withUser, (user) => sources.update(user, params.sourceId, payload)),
      remove: ({ params }) =>
        Effect.flatMap(withUser, (user) => sources.remove(user, params.sourceId)),
      refresh: ({ params }) =>
        Effect.flatMap(withUser, (user) => sources.refresh(user, params.sourceId)),
      test: ({ payload }) => Effect.flatMap(withUser, (user) => sources.test(user, payload)),
      streams: ({ params, query }) =>
        Effect.flatMap(withUser, (user) => sources.streams(user, params.sourceId, query.search)),
      catalogue: ({ params, query }) =>
        Effect.flatMap(withUser, (user) => sources.catalogue(user, params.sourceId, query)),
      groups: ({ params }) =>
        Effect.flatMap(withUser, (user) => sources.groups(user, params.sourceId)),
      addStreams: ({ params, payload }) =>
        Effect.flatMap(withUser, (user) =>
          sources.addStreams(user, params.sourceId, payload.streamIds),
        ),
      ignoreStreams: ({ params, payload }) =>
        Effect.flatMap(withUser, (user) =>
          sources.ignoreStreams(user, params.sourceId, payload.streamIds, payload.ignored),
        ),
      markReviewed: ({ params }) =>
        Effect.flatMap(withUser, (user) => sources.markReviewed(user, params.sourceId)),
    });
  }),
);

const ChannelsHandlers = HttpApiBuilder.group(SlipstreamApi, "channels", (handlers) =>
  Effect.gen(function* () {
    const channels = yield* Channels;
    const withUser = CurrentUser;
    return handlers.handleAll({
      list: ({ query }) =>
        Effect.flatMap(withUser, (user) =>
          channels.list(user, query.includeHidden === true && user.role === "admin"),
        ),
      get: ({ params }) => Effect.flatMap(withUser, (user) => channels.get(user, params.channelId)),
      create: ({ payload }) => Effect.flatMap(withUser, (user) => channels.create(user, payload)),
      update: ({ params, payload }) =>
        Effect.flatMap(withUser, (user) => channels.update(user, params.channelId, payload)),
      remove: ({ params }) =>
        Effect.flatMap(withUser, (user) => channels.remove(user, params.channelId)),
      setNumber: ({ params, payload }) =>
        Effect.flatMap(withUser, (user) =>
          channels.setNumber(user, params.channelId, payload.number),
        ),
      placeNumbers: ({ payload }) =>
        Effect.flatMap(withUser, (user) => channels.placeNumbers(user, payload.ids, payload.start)),
      removePreview: ({ payload }) =>
        Effect.flatMap(withUser, (user) => channels.removePreview(user, payload.ids)),
      removeMany: ({ payload }) =>
        Effect.flatMap(withUser, (user) => channels.removeMany(user, payload.ids)),
      mergePreview: ({ payload }) =>
        Effect.flatMap(withUser, (user) =>
          channels.mergePreview(user, payload.keepId, payload.otherIds),
        ),
      merge: ({ payload }) =>
        Effect.flatMap(withUser, (user) => channels.merge(user, payload.keepId, payload.otherIds)),
      split: ({ params, payload }) =>
        Effect.flatMap(withUser, (user) =>
          channels.split(user, params.channelId, payload.sourceStreamId),
        ),
      review: () => Effect.flatMap(withUser, (user) => channels.review(user)),
      keepApart: ({ payload }) =>
        Effect.flatMap(withUser, (user) => channels.keepApart(user, payload.ids)),
      guideChannels: ({ query }) =>
        Effect.flatMap(withUser, (user) => channels.guideChannels(user, query.search)),
      guideSuggestions: ({ params }) =>
        Effect.flatMap(withUser, (user) => channels.guideSuggestions(user, params.channelId)),
      streams: ({ params }) =>
        Effect.flatMap(withUser, (user) => channels.streams(user, params.channelId)),
      setStreams: ({ params, payload }) =>
        Effect.flatMap(withUser, (user) => channels.setStreams(user, params.channelId, payload)),
    });
  }),
);

const GuideHandlers = HttpApiBuilder.group(SlipstreamApi, "guide", (handlers) =>
  Effect.gen(function* () {
    const guide = yield* Guide;
    const planning = yield* Planning;
    return handlers.handleAll({
      window: ({ query }) =>
        Effect.flatMap(CurrentUser, (user) =>
          guide.window(user, query.from, query.to, query.channels),
        ),
      extent: () => Effect.flatMap(CurrentUser, guide.extent),
      nowNext: () => Effect.flatMap(CurrentUser, guide.nowNext),
      search: ({ query }) =>
        Effect.flatMap(CurrentUser, (user) => guide.search(user, query.q, query.from)),
      programme: ({ params }) =>
        Effect.flatMap(CurrentUser, (user) => guide.programmeFor(user, params.programmeId)),
      repeats: ({ query }) =>
        Effect.flatMap(CurrentUser, (user) => planning.guideRepeats(user, query.from, query.to)),
    });
  }),
);

const RecordingsHandlers = HttpApiBuilder.group(SlipstreamApi, "recordings", (handlers) =>
  Effect.gen(function* () {
    const recordings = yield* Recordings;
    const withUser = CurrentUser;
    return handlers.handleAll({
      list: ({ query }) => Effect.flatMap(withUser, (user) => recordings.list(user, query)),
      get: ({ params }) =>
        Effect.flatMap(withUser, (user) => recordings.get(user, params.recordingId)),
      create: ({ payload }) => Effect.flatMap(withUser, (user) => recordings.create(user, payload)),
      update: ({ params, payload }) =>
        Effect.flatMap(withUser, (user) => recordings.update(user, params.recordingId, payload)),
      stop: ({ params }) =>
        Effect.flatMap(withUser, (user) => recordings.stop(user, params.recordingId)),
      remove: ({ params, query }) =>
        Effect.flatMap(withUser, (user) => recordings.remove(user, params.recordingId, query)),
      conflicts: ({ query }) =>
        Effect.flatMap(withUser, (user) => recordings.conflicts(user, query.from, query.to)),
      retention: () => recordings.retention,
      keepOriginal: ({ params }) =>
        Effect.flatMap(withUser, (user) => recordings.keepOriginal(user, params.recordingId)),
    });
  }),
);

const RulesHandlers = HttpApiBuilder.group(SlipstreamApi, "rules", (handlers) =>
  Effect.gen(function* () {
    const rules = yield* Rules;
    const withUser = CurrentUser;
    return handlers.handleAll({
      list: () => Effect.flatMap(withUser, rules.list),
      get: ({ params }) => Effect.flatMap(withUser, (user) => rules.get(user, params.ruleId)),
      create: ({ payload }) => Effect.flatMap(withUser, (user) => rules.create(user, payload)),
      update: ({ params, payload }) =>
        Effect.flatMap(withUser, (user) => rules.update(user, params.ruleId, payload)),
      remove: ({ params, query }) =>
        Effect.flatMap(withUser, (user) => rules.remove(user, params.ruleId, query)),
      preview: ({ payload }) =>
        Effect.flatMap(withUser, (user) => rules.preview(user, payload.rule, payload.until)),
      offer: ({ params }) => Effect.flatMap(withUser, (user) => rules.offer(user, params.ruleId)),
      declineOffer: ({ params }) =>
        Effect.flatMap(withUser, (user) => rules.declineOffer(user, params.ruleId)),
      group: ({ params, payload }) =>
        Effect.flatMap(withUser, (user) => rules.group(user, params.ruleId, payload)),
      ungroup: ({ params }) =>
        Effect.flatMap(withUser, (user) => rules.ungroup(user, params.ruleId)),
      history: ({ params }) =>
        Effect.flatMap(withUser, (user) => rules.history(user, params.ruleId)),
      forgetHistory: ({ params }) =>
        Effect.flatMap(withUser, (user) => rules.forgetHistory(user, params.ruleId)),
    });
  }),
);

const CollectionsHandlers = HttpApiBuilder.group(SlipstreamApi, "collections", (handlers) =>
  Effect.gen(function* () {
    const collections = yield* Collections;
    const withUser = CurrentUser;
    return handlers.handleAll({
      list: () => Effect.flatMap(withUser, collections.list),
      get: ({ params }) =>
        Effect.flatMap(withUser, (user) => collections.get(user, params.collectionId)),
      create: ({ payload }) =>
        Effect.flatMap(withUser, (user) => collections.create(user, payload)),
      update: ({ params, payload }) =>
        Effect.flatMap(withUser, (user) => collections.update(user, params.collectionId, payload)),
      remove: ({ params }) =>
        Effect.flatMap(withUser, (user) => collections.remove(user, params.collectionId)),
      reorder: ({ payload }) =>
        Effect.flatMap(withUser, (user) => collections.reorder(user, payload.collectionIds)),
      preview: ({ payload }) =>
        Effect.flatMap(withUser, (user) =>
          collections.preview(user, payload.collection, payload.collectionId),
        ),
      previewSimilar: ({ params, payload }) =>
        Effect.flatMap(withUser, (user) =>
          collections.previewSimilar(user, params.collectionId, payload.recordingId),
        ),
      moveSimilar: ({ params, payload }) =>
        Effect.flatMap(withUser, (user) =>
          collections.moveSimilar(user, params.collectionId, payload.recordingId),
        ),
      unlink: ({ params }) =>
        Effect.flatMap(withUser, (user) => collections.unlink(user, params.collectionId)),
    });
  }),
);

const CapturesHandlers = HttpApiBuilder.group(SlipstreamApi, "captures", (handlers) =>
  Effect.gen(function* () {
    const captures = yield* Captures;
    const withUser = CurrentUser;
    return handlers.handleAll({
      list: ({ query }) => Effect.flatMap(withUser, (user) => captures.list(user, query.active)),
      get: ({ params }) => Effect.flatMap(withUser, (user) => captures.get(user, params.captureId)),
      log: ({ params, query }) =>
        Effect.flatMap(withUser, (user) => captures.log(user, params.captureId, query.after)),
      stop: ({ params }) =>
        Effect.flatMap(withUser, (user) => captures.stop(user, params.captureId)),
    });
  }),
);

const PlaybackHandlers = HttpApiBuilder.group(SlipstreamApi, "playback", (handlers) =>
  Effect.gen(function* () {
    const playback = yield* Playback;
    const auth = yield* Auth;
    const withUser = CurrentUser;
    /**
     * The sign-in behind the request (playlist tokens die with it), as the middleware resolved
     * it, its paired device, for "arte on Kitchen Shield", and whether it asks from home or
     * away, for the household's default quality.
     */
    const client = Effect.flatMap(currentPrincipal, (principal) =>
      Effect.map(
        Effect.all([
          principal.deviceId === undefined
            ? Effect.succeed(undefined)
            : auth.deviceName(principal.deviceId),
          requestOrigin,
        ]),
        ([deviceName, origin]) => ({ sessionId: principal.sessionId, deviceName, origin }),
      ),
    );
    return handlers.handleAll({
      createSession: ({ payload }) =>
        Effect.all([withUser, client]).pipe(
          Effect.flatMap(([user, from]) => playback.createSession(user, payload, from)),
        ),
      updateSession: ({ params, payload }) =>
        Effect.all([withUser, client]).pipe(
          Effect.flatMap(([user, from]) =>
            playback.updateSession(user, params.playbackSessionId, payload, from),
          ),
        ),
      endSession: ({ params }) =>
        Effect.flatMap(withUser, (user) => playback.endSession(user, params.playbackSessionId)),
      state: ({ params }) =>
        Effect.flatMap(withUser, (user) => playback.state(user, params.recordingId)),
      saveState: ({ payload }) =>
        Effect.flatMap(withUser, (user) => playback.saveState(user, payload)),
      continueWatching: () => Effect.flatMap(withUser, playback.continueWatching),
    });
  }),
);

const ProfilesHandlers = HttpApiBuilder.group(SlipstreamApi, "profiles", (handlers) =>
  Effect.gen(function* () {
    const profiles = yield* Profiles;
    return handlers.handleAll({
      list: () => Effect.flatMap(CurrentUser, profiles.list),
      me: () => Effect.flatMap(CurrentUser, profiles.me),
      create: ({ payload }) =>
        Effect.flatMap(CurrentUser, (user) => profiles.create(user, payload)),
      update: ({ params, payload }) =>
        Effect.gen(function* () {
          const principal = yield* currentPrincipal;
          const address = yield* clientAddress;
          return yield* profiles.update(principal.user, params.userId, payload, principal, address);
        }),
      remove: ({ params }) =>
        Effect.flatMap(CurrentUser, (user) => profiles.remove(user, params.userId)),
      setPin: ({ params, payload }) =>
        Effect.all([CurrentUser, clientAddress]).pipe(
          Effect.flatMap(([user, address]) =>
            profiles.setPin(user, params.userId, payload, address),
          ),
        ),
      verifyPin: ({ params, payload }) =>
        Effect.all([CurrentUser, clientAddress]).pipe(
          Effect.flatMap(([user, address]) =>
            profiles.verifyPin(user, params.userId, payload.pin, address),
          ),
        ),
      switch: ({ params, payload }) =>
        Effect.gen(function* () {
          const principal = yield* currentPrincipal;
          const address = yield* clientAddress;
          const issued = yield* profiles.switchTo(
            principal.user,
            principal,
            params.userId,
            payload.secret,
            address,
          );
          return yield* respond(issued);
        }),
    });
  }),
);

const GuestsHandlers = HttpApiBuilder.group(SlipstreamApi, "guests", (handlers) =>
  Effect.gen(function* () {
    const guests = yield* Guests;
    return handlers.handleAll({
      list: () => Effect.flatMap(CurrentUser, guests.list),
      invites: () => Effect.flatMap(CurrentUser, guests.pending),
      invite: ({ payload }) => Effect.flatMap(CurrentUser, (user) => guests.invite(user, payload)),
      revokeInvite: ({ params }) =>
        Effect.flatMap(CurrentUser, (user) => guests.revoke(user, params.inviteId)),
      update: ({ params, payload }) =>
        Effect.flatMap(CurrentUser, (user) => guests.update(user, params.userId, payload)),
    });
  }),
);

const InvitesHandlers = HttpApiBuilder.group(SlipstreamApi, "invites", (handlers) =>
  Effect.gen(function* () {
    const guests = yield* Guests;
    return handlers.handleAll({
      lookup: ({ payload }) =>
        Effect.flatMap(clientAddress, (address) => guests.lookup(payload.token, address)),
      accept: ({ payload }) =>
        clientAddress.pipe(
          Effect.flatMap((address) => guests.accept(payload, address)),
          Effect.flatMap(respond),
        ),
    });
  }),
);

const SettingsHandlers = HttpApiBuilder.group(SlipstreamApi, "settings", (handlers) =>
  Effect.gen(function* () {
    const settings = yield* Settings;
    const online = yield* OnlineArtwork;
    return handlers.handleAll({
      recording: () => settings.recording,
      artwork: () => online.view,
      saveArtwork: ({ payload }) =>
        Effect.flatMap(CurrentUser, (user) => online.save(user, payload)),
      saveRecording: ({ payload }) =>
        Effect.flatMap(CurrentUser, (user) => settings.saveRecording(user, payload)),
      playback: () => settings.playback,
      savePlayback: ({ payload }) =>
        Effect.flatMap(CurrentUser, (user) => settings.savePlayback(user, payload)),
    });
  }),
);

/** Frames never change under their URL (`?v=` is the moment they show). */
const cacheForever = HttpEffect.appendPreResponseHandler((_request, response) =>
  Effect.succeed(
    HttpServerResponse.setHeader(response, "cache-control", "private, max-age=31536000, immutable"),
  ),
);

const ArtworkHandlers = HttpApiBuilder.group(SlipstreamApi, "artwork", (handlers) =>
  Effect.gen(function* () {
    const artwork = yield* Artwork;
    return handlers.handleAll({
      resolve: ({ query }) => Effect.flatMap(CurrentUser, (user) => artwork.resolve(user, query)),
      frame: ({ params }) =>
        Effect.flatMap(CurrentUser, (user) => artwork.frame(user, params.recordingId)).pipe(
          Effect.tap(() => cacheForever),
        ),
    });
  }),
);

const StreamsHandlers = HttpApiBuilder.group(SlipstreamApi, "streams", (handlers) =>
  Effect.gen(function* () {
    const streams = yield* Streams;
    return handlers.handleAll({
      list: () => Effect.flatMap(CurrentUser, streams.list),
      stopWatching: ({ params }) =>
        Effect.flatMap(CurrentUser, (user) => streams.stopWatching(user, params.playbackSessionId)),
    });
  }),
);

const ProgrammesHandlers = HttpApiBuilder.group(SlipstreamApi, "programmes", (handlers) =>
  Effect.gen(function* () {
    const programmes = yield* Programmes;
    return handlers.handleAll({
      recordOptions: ({ params }) =>
        Effect.flatMap(CurrentUser, (user) => programmes.recordOptions(user, params.programmeId)),
    });
  }),
);

/** Every API group's handlers; needs the services and the `Authentication` middleware. */
export const ApiHandlers = Layer.mergeAll(
  SystemHandlers,
  AuthHandlers,
  DevicesHandlers,
  SourcesHandlers,
  ChannelsHandlers,
  GuideHandlers,
  RecordingsHandlers,
  RulesHandlers,
  CollectionsHandlers,
  CapturesHandlers,
  PlaybackHandlers,
  ProfilesHandlers,
  GuestsHandlers,
  InvitesHandlers,
  SettingsHandlers,
  ArtworkHandlers,
  StreamsHandlers,
  ProgrammesHandlers,
);
