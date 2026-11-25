/**
 * The first-start seed of `pnpm dev`: the dev admin, the fake source (added and refreshed), the
 * F1 example rule and a "Formel 1" collection, so every screen has data straight away. It talks
 * to the server through the typed API client (`SlipstreamApi`) with a session cookie and the
 * CSRF header, like the web app, so no production code knows about dev accounts and every
 * payload is checked against the contract. Every step looks before it creates, so running it
 * twice changes nothing.
 */
import {
  type CollectionInput,
  csrfCookie,
  csrfHeader,
  type RuleInput,
  SlipstreamApi,
} from "@slipstream/api";
import type { ChannelId, CollectionId } from "@slipstream/domain";
import { Effect, Ref } from "effect";
import { type Cookies, FetchHttpClient, HttpClient, HttpClientRequest } from "effect/http";
import { HttpApiClient } from "effect/http-api";
import type { DevAdmin } from "./dev-state.ts";

/** What the seed reports back for the terminal. */
export interface SeedSummary {
  readonly adminCreated: boolean;
  readonly streams: number;
  readonly programmes: number;
  readonly channels: number;
  readonly rule: string;
  readonly collection: string;
}

/** The channel of the fake source the example rule records. */
export const F1_CHANNEL = "Sportkanal F1 HD";

/** The F1 example rule from PLAN 6.6, as the API takes it. */
export const f1Rule = (channelId: ChannelId, collectionId: CollectionId): RuleInput => ({
  name: "F1 live sessions",
  enabled: true,
  matcher: {
    channels: [channelId],
    title: [
      { _tag: "StartsWith", values: ["Live F1:"] },
      {
        _tag: "Contains",
        values: [
          "1. Freies Training",
          "2. Freies Training",
          "3. Freies Training",
          "Qualifying",
          "Sprint Qualifying",
          "Sprint",
          "Rennen",
        ],
      },
    ],
    categories: [],
    weekdays: [],
  },
  padding: { beforeMinutes: 5, afterMinutes: 60 },
  retention: { _tag: "KeepAll" },
  collectionId,
  skipRepeats: true,
});

/**
 * A collection for everything F1 ("F1: ..." and "Live F1: ..."), laid out as
 * `Formel 1 > {year} > {event} > {programme}`: "Live F1: Qualifying - GP Katar" lands in
 * `Formel 1 > 2026 > GP Katar > Qualifying`.
 */
export const f1Collection: CollectionInput = {
  name: "Formel 1",
  rank: 0,
  matcher: {
    channels: [],
    title: [{ _tag: "StartsWith", values: ["Live F1:", "F1:"] }],
    categories: [],
    weekdays: [],
  },
  labels: [],
  layout: {
    parts: [
      { _tag: "Split", name: "programme", before: { separator: " - ", occurrence: "last" } },
      { _tag: "Split", name: "event", after: { separator: " - ", occurrence: "last" } },
    ],
    path: ["{year}", "{event}", "{programme}"],
  },
};

/**
 * The typed client for `baseUrl`, signed in by cookie: it keeps the cookies the server sets and
 * echoes the CSRF cookie in the CSRF header on writes, as the web client does.
 */
const cookieClient = (baseUrl: string) =>
  Effect.gen(function* () {
    const jar = yield* Ref.make<ReadonlyArray<Cookies.Cookie>>([]);
    const withCsrf = (request: HttpClientRequest.HttpClientRequest) =>
      Effect.map(Ref.get(jar), (cookies) => {
        const token = cookies.find((cookie) => cookie.name === csrfCookie)?.value;
        return request.method === "GET" || token === undefined
          ? request
          : HttpClientRequest.setHeader(request, csrfHeader, token);
      });
    return yield* HttpApiClient.make(SlipstreamApi, {
      baseUrl,
      transformClient: (client) =>
        client.pipe(HttpClient.mapRequestEffect(withCsrf), HttpClient.withCookiesRef(jar)),
    });
  });

type Client = Effect.Success<ReturnType<typeof cookieClient>>;

/** Signs in as the dev admin, creating it on a fresh server; true when it was created. */
const signIn = (api: Client, admin: DevAdmin) =>
  Effect.gen(function* () {
    if ((yield* api.auth.setupStatus()).required) {
      yield* api.auth.setup({
        payload: { username: admin.username, displayName: "Dev Admin", password: admin.password },
      });
      return true;
    }
    yield* api.auth
      .login({ payload: { username: admin.username, password: admin.password } })
      .pipe(
        Effect.mapError(
          () =>
            new Error(
              "This checkout's database has an admin, but not the dev one from .data/dev/instance.json. Run pnpm dev:reset to start fresh.",
            ),
        ),
      );
    return false;
  });

/** Runs the seed against a running dev server. */
export const seed = (options: {
  readonly serverUrl: string;
  readonly sourceUrl: string;
  readonly admin: DevAdmin;
}): Promise<SeedSummary> =>
  Effect.gen(function* () {
    const api = yield* cookieClient(options.serverUrl);
    const adminCreated = yield* signIn(api, options.admin);

    const source =
      (yield* api.sources.list()).find((candidate) => candidate.name === "Fake source") ??
      (yield* api.sources.create({
        payload: {
          name: "Fake source",
          config: {
            _tag: "M3u",
            playlistUrl: `${options.sourceUrl}/playlist.m3u`,
            guideUrl: `${options.sourceUrl}/epg.xml`,
          },
          refreshIntervalMinutes: 60,
          headers: {},
          guideCleanup: { removeDuplicates: true, rewrites: [] },
          enabled: true,
        },
      }));
    const check = yield* api.sources.refresh({ params: { sourceId: source.id } });

    const channels = yield* api.channels.list({ query: {} });
    const f1 = channels.find((channel) => channel.name === F1_CHANNEL);
    if (f1 === undefined) {
      return yield* Effect.fail(
        new Error(`The fake source refreshed, but no "${F1_CHANNEL}" channel appeared.`),
      );
    }

    const collection =
      (yield* api.collections.list()).find((candidate) => candidate.name === f1Collection.name) ??
      (yield* api.collections.create({ payload: f1Collection }));

    const draft = f1Rule(f1.id, collection.id);
    const rule =
      (yield* api.rules.list()).find((candidate) => candidate.name === draft.name) ??
      (yield* api.rules.create({ payload: draft }));

    return {
      adminCreated,
      streams: check.streams,
      programmes: check.programmes,
      channels: channels.length,
      rule: rule.name,
      collection: collection.name,
    };
  }).pipe(Effect.provide(FetchHttpClient.layer), Effect.runPromise);
