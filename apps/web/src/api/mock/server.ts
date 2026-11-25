import { Effect, Layer, Redacted } from "effect";
import { HttpRouter, HttpServer, HttpServerRequest } from "effect/http";
import { HttpApiBuilder } from "effect/http-api";
import {
  Authentication,
  csrfHeader,
  csrfSafeMethods,
  CurrentUser,
  type ServerEvent,
  SlipstreamApi,
  Unauthorized,
} from "@slipstream/api";
import type { UserId } from "@slipstream/domain";
import type { MockData } from "./fixtures.ts";
import { makeMockContext, type MockOptions } from "./context.ts";
import { systemGroup } from "./system.ts";
import { authGroup } from "./auth.ts";
import { devicesGroup } from "./devices.ts";
import { sourcesGroup } from "./sources.ts";
import { channelsGroup } from "./channels.ts";
import { guideGroup } from "./guide.ts";
import { recordingsGroup } from "./recordings.ts";
import { rulesGroup } from "./rules.ts";
import { collectionsGroup } from "./collections.ts";
import { capturesGroup } from "./captures.ts";
import { playbackGroup } from "./playback.ts";
import { settingsGroup } from "./settings.ts";
import { profilesGroup } from "./profiles.ts";
import { guestsGroup, invitesGroup } from "./guests.ts";
import { streamsGroup } from "./streams.ts";
import { artworkGroup, programmesGroup } from "./programmes.ts";

export { mockPassword } from "./context.ts";
export type { MockOptions } from "./context.ts";

/**
 * A running mock: its data, a `fetch` that reaches it, and a way to push live events and to
 * hear the ones its handlers publish (what every SSE connection receives).
 */
export interface MockServer {
  readonly data: MockData;
  readonly handler: (request: Request) => Promise<Response>;
  readonly publish: (event: ServerEvent) => void;
  /** Hears every published event until the returned function is called. */
  readonly subscribe: (listener: (event: ServerEvent) => void) => () => void;
  readonly dispose: () => Promise<void>;
}

/**
 * An in-memory Slipstream server implementing the whole contract (`SlipstreamApi`) over the
 * fixtures. Served by Vite in `pnpm dev:mock`, and handed to the real
 * client as its `fetch` in tests, so screens and hooks run against actual HTTP semantics:
 * status codes, cookies and CSRF, schema encoding and SSE.
 */
export const makeMockServer = (options: MockOptions = {}): MockServer => {
  const ctx = makeMockContext(options);
  const { sessions, userById } = ctx;
  const { household } = ctx.data;
  if (options.extraTime !== undefined) {
    household.recording = { ...household.recording, extraTime: options.extraTime };
  }
  const provideUser = <A, E, R>(effect: Effect.Effect<A, E, R>, userId: UserId | undefined) => {
    const user = userById(userId);
    return user === undefined
      ? Effect.fail(new Unauthorized())
      : Effect.provideService(effect, CurrentUser, user);
  };

  // Like the server: a state-changing request signed in by cookie must echo the CSRF cookie.
  // The auto-signed-in dev session has no cookie, so it has nothing to echo.
  const AuthenticationLive = Layer.succeed(Authentication)({
    cookie: (effect, { credential, endpoint }) =>
      Effect.gen(function* () {
        const session = sessions.get(Redacted.value(credential));
        if (session !== undefined && !csrfSafeMethods.has(endpoint.method)) {
          const request = yield* HttpServerRequest.HttpServerRequest;
          if (request.headers[csrfHeader] !== session.csrf) {
            return yield* Effect.fail(new Unauthorized());
          }
        }
        return yield* provideUser(effect, session?.userId ?? ctx.autoUser);
      }),
    bearer: (effect, { credential }) =>
      provideUser(effect, sessions.get(Redacted.value(credential))?.userId ?? ctx.autoUser),
  });

  const app = HttpApiBuilder.layer(SlipstreamApi)
    .pipe(
      Layer.provide([
        systemGroup(ctx),
        authGroup(ctx),
        devicesGroup(ctx),
        sourcesGroup(ctx),
        channelsGroup(ctx),
        guideGroup(ctx),
        recordingsGroup(ctx),
        rulesGroup(ctx),
        collectionsGroup(ctx),
        capturesGroup(ctx),
        playbackGroup(ctx),
        profilesGroup(ctx),
        guestsGroup(ctx),
        invitesGroup(ctx),
        settingsGroup(ctx),
        artworkGroup(),
        streamsGroup(ctx),
        programmesGroup(ctx),
      ]),
    )
    .pipe(Layer.provide(AuthenticationLive), Layer.provide(HttpServer.layerServices));

  const web = HttpRouter.toWebHandler(app, { disableLogger: true });
  return {
    data: ctx.data,
    handler: (request) => web.handler(request),
    publish: ctx.publish,
    subscribe: (listener) => {
      ctx.listeners.add(listener);
      return () => {
        ctx.listeners.delete(listener);
      };
    },
    dispose: web.dispose,
  };
};
