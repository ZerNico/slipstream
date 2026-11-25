/**
 * Pictures found online (TMDB) for programmes and recordings the guide has no picture for, with
 * the household's own key (Settings › Recording). The key is sealed at rest like source
 * passwords and never sent back. A background pass looks titles up (one lookup per title, every
 * airing shares it), caches the answer in `online_artwork` (also "nothing found", asked again
 * after a month) and writes the picture onto the rows as `online_image_url`, so every list the
 * server sends carries it without a request of its own.
 */
import { and, gt, inArray, isNull, lt } from "drizzle-orm";
import { Clock, Context, Duration, Effect, Layer, Schedule, Schema } from "effect";
import { HttpClient, HttpClientRequest } from "effect/http";
import {
  type ArtworkSettings,
  type ArtworkSettingsUpdate,
  type Forbidden,
  InvalidInput,
} from "@slipstream/api";
import { DAY, HOUR, type User } from "@slipstream/domain";
import { requireAdmin } from "../auth/service.ts";
import { ServerConfig } from "../config.ts";
import { Db } from "../db/client.ts";
import { chunks } from "../db/codec.ts";
import { onlineArtwork, programmes, recordings } from "../db/schema.ts";
import { SecretBox } from "../sources/secret-box.ts";
import { Settings } from "../settings/service.ts";
import {
  onlineQuery,
  type OnlineQuery,
  pickImage,
  searchLanguage,
  TMDB_API,
  tmdbAuth,
  tmdbSearchUrl,
} from "./online.ts";

const SETTINGS_KEY = "tmdb";
/** How long "nothing found" holds before the title is asked again. */
const RETRY_NOTHING_MS = 30 * DAY;
/** Lookups per pass, and the pause between two: well inside TMDB's rate limit. */
const LOOKUPS_PER_PASS = 40;
const LOOKUP_GAP = Duration.millis(300);
/** How often the pass runs. */
const PASS_INTERVAL = Duration.minutes(2);
/** The guide the pass covers: what aired recently and the next three days. */
const GUIDE_BACK_MS = 6 * HOUR;
const GUIDE_AHEAD_MS = 3 * DAY;
/** How long one TMDB request may take. */
const REQUEST_TIMEOUT = Duration.seconds(10);
/** Cached lookups read per query, under SQLite's variable limit. */
const KEYS_PER_QUERY = 500;

/** The stored key, sealed. */
const StoredKey = Schema.Struct({ key: Schema.String });

/** What a TMDB search answers, as far as picking a picture goes (`pickImage`). */
const TmdbSearch = Schema.Struct({
  results: Schema.Array(
    Schema.Struct({
      title: Schema.optionalKey(Schema.String),
      name: Schema.optionalKey(Schema.String),
      original_title: Schema.optionalKey(Schema.String),
      original_name: Schema.optionalKey(Schema.String),
      backdrop_path: Schema.optionalKey(Schema.NullOr(Schema.String)),
    }),
  ),
});

/** TMDB refused the key. */
class KeyRefused extends Schema.TaggedError<KeyRefused>()("KeyRefused", {}) {}
/** TMDB could not be reached or answered with something else. */
class Unreachable extends Schema.TaggedError<Unreachable>()("Unreachable", {}) {}

/** TMDB over the server's HTTP client: the key check and the picture search. */
const makeTmdb = (client: HttpClient.HttpClient) => {
  /** A GET against TMDB with the key, as JSON. */
  const get = (url: string, key: string): Effect.Effect<unknown, KeyRefused | Unreachable> =>
    client
      .execute(
        HttpClientRequest.get(url).pipe(
          HttpClientRequest.setHeaders({ accept: "application/json", ...tmdbAuth(key).headers }),
        ),
      )
      .pipe(
        Effect.timeout(REQUEST_TIMEOUT),
        Effect.mapError(() => new Unreachable()),
        Effect.flatMap((response): Effect.Effect<unknown, KeyRefused | Unreachable> =>
          response.status === 401
            ? Effect.fail(new KeyRefused())
            : response.status >= 200 && response.status < 300
              ? Effect.mapError(response.json, () => new Unreachable())
              : Effect.fail(new Unreachable()),
        ),
      );

  /** Whether TMDB takes the key: its configuration endpoint answers only with a valid one. */
  const checkKey = (key: string) => {
    const url = new URL(`${TMDB_API}/configuration`);
    for (const [name, value] of Object.entries(tmdbAuth(key).params)) {
      url.searchParams.set(name, value);
    }
    return Effect.asVoid(get(url.toString(), key));
  };

  /** The picture TMDB has for a lookup, or undefined. */
  const search = (query: OnlineQuery, key: string, language: string) =>
    get(tmdbSearchUrl(query, key, language), key).pipe(
      Effect.flatMap((body) =>
        Effect.mapError(Schema.decodeUnknownEffect(TmdbSearch)(body), () => new Unreachable()),
      ),
      Effect.map((body) => pickImage(body.results, query)),
    );

  return { checkKey, search };
};

/** Settings › Recording's online pictures, and the pass that finds them. */
export class OnlineArtwork extends Context.Service<
  OnlineArtwork,
  {
    readonly view: Effect.Effect<ArtworkSettings>;
    readonly save: (
      actor: User,
      input: ArtworkSettingsUpdate,
    ) => Effect.Effect<ArtworkSettings, InvalidInput | Forbidden>;
    /**
     * One lookup pass; does nothing without a key. Tests may lift the per-pass limit and the
     * pause between lookups.
     */
    readonly pass: (options?: {
      readonly lookups?: number;
      readonly gap?: Duration.Duration;
    }) => Effect.Effect<void>;
  }
>()("@slipstream/server/OnlineArtwork") {
  static readonly layer = Layer.effect(
    OnlineArtwork,
    Effect.gen(function* () {
      const { read, write } = yield* Db;
      const box = yield* SecretBox;
      const config = yield* ServerConfig;
      const settings = yield* Settings;
      const tmdb = makeTmdb(yield* HttpClient.HttpClient);

      /**
       * The stored key, or undefined: none, or one that no longer opens (another secret key) or
       * decodes, which counts as none until it is saved again.
       */
      const storedKey = Effect.gen(function* () {
        const value = yield* settings.stored(SETTINGS_KEY);
        if (value === undefined) return undefined;
        return yield* box.tryOpen(value).pipe(
          Effect.flatMap(Schema.decodeUnknownEffect(StoredKey)),
          Effect.map((stored) => stored.key),
          Effect.catchTags({
            SecretBoxError: (error) =>
              Effect.as(Effect.logWarning("The stored TMDB key does not open", error), undefined),
            SchemaError: () => Effect.succeed(undefined),
          }),
        );
      });

      const view: Effect.Effect<ArtworkSettings> = Effect.map(storedKey, (key) => ({
        tmdb: key !== undefined,
      }));

      const save = Effect.fn("OnlineArtwork.save")(function* (
        actor: User,
        input: ArtworkSettingsUpdate,
      ) {
        yield* requireAdmin(actor);
        const key = input.tmdbKey?.trim() ?? "";
        if (key === "") {
          yield* settings.forget(SETTINGS_KEY);
          return { tmdb: false };
        }
        yield* tmdb.checkKey(key).pipe(
          Effect.catchTags({
            KeyRefused: () =>
              Effect.fail(
                new InvalidInput({ problems: [{ path: "tmdbKey", code: "invalidKey" }] }),
              ),
            Unreachable: () =>
              Effect.fail(
                new InvalidInput({ problems: [{ path: "tmdbKey", code: "unreachable" }] }),
              ),
          }),
        );
        yield* settings.store(SETTINGS_KEY, box.seal({ key }));
        return { tmdb: true };
      });

      const pass = Effect.fn("OnlineArtwork.pass")(function* (
        options: { readonly lookups?: number; readonly gap?: Duration.Duration } = {},
      ) {
        const key = yield* storedKey;
        if (key === undefined) return;
        const now = yield* Clock.currentTimeMillis;
        const subject = {
          id: programmes.id,
          title: programmes.title,
          categories: programmes.categories,
          originalAirDate: programmes.originalAirDate,
          onlineImageUrl: programmes.onlineImageUrl,
        };
        const guide = yield* (
          read
            .select(subject)
            .from(programmes)
            .where(
              and(
                isNull(programmes.imageUrl),
                gt(programmes.end, now - GUIDE_BACK_MS),
                lt(programmes.start, now + GUIDE_AHEAD_MS),
              ),
            )
            // What airs soonest is looked up first.
            .orderBy(programmes.start)
            .pipe(Effect.orDie)
        );
        const recorded = yield* read
          .select({
            id: recordings.id,
            title: recordings.title,
            categories: recordings.categories,
            originalAirDate: recordings.originalAirDate,
            onlineImageUrl: recordings.onlineImageUrl,
          })
          .from(recordings)
          .where(and(isNull(recordings.imageUrl), isNull(recordings.hiddenAt)))
          .pipe(Effect.orDie);
        const keyed = (rows: typeof guide) =>
          rows.flatMap((row) => {
            const query = onlineQuery(row);
            return query === undefined ? [] : [{ row, query }];
          });
        const guideRows = keyed(guide);
        const recordingRows = keyed(recorded);
        // Recordings first: they stay; then the guide in start order.
        const queries = new Map(
          [...recordingRows, ...guideRows].map(({ query }) => [query.key, query]),
        );
        if (queries.size === 0) return;

        // What the cache knows, then the lookups it lacks (or whose "nothing" is old).
        const keys = [...queries.keys()];
        const cached = new Map<string, { imageUrl: string | null; lookedUpAt: number }>();
        for (const batch of chunks(keys, KEYS_PER_QUERY)) {
          const rows = yield* read
            .select()
            .from(onlineArtwork)
            .where(inArray(onlineArtwork.titleKey, [...batch]))
            .pipe(Effect.orDie);
          for (const row of rows) cached.set(row.titleKey, row);
        }
        const due = keys
          .filter((titleKey) => {
            const hit = cached.get(titleKey);
            return (
              hit === undefined ||
              (hit.imageUrl === null && now - hit.lookedUpAt > RETRY_NOTHING_MS)
            );
          })
          .slice(0, options.lookups ?? LOOKUPS_PER_PASS);
        const language = searchLanguage(config.timeZone);
        for (const titleKey of due) {
          const query = queries.get(titleKey);
          if (query === undefined) continue;
          const found = yield* tmdb.search(query, key, language).pipe(Effect.result);
          // A refused key or TMDB away: stop here, the next pass tries again.
          if (found._tag === "Failure") {
            yield* Effect.logWarning(
              found.failure._tag === "KeyRefused"
                ? "TMDB refused the key; check Settings › Recording"
                : "TMDB could not be reached; trying again later",
            );
            break;
          }
          const imageUrl = found.success ?? null;
          const lookedUpAt = yield* Clock.currentTimeMillis;
          yield* write
            .insert(onlineArtwork)
            .values({ titleKey, imageUrl, lookedUpAt })
            .onConflictDoUpdate({ target: onlineArtwork.titleKey, set: { imageUrl, lookedUpAt } })
            .pipe(Effect.orDie);
          cached.set(titleKey, { imageUrl, lookedUpAt });
          yield* Effect.sleep(options.gap ?? LOOKUP_GAP);
        }

        // Every row whose picture differs from what its title found gets it.
        const changes = (rows: typeof guideRows) => {
          const byImage = new Map<string | null, string[]>();
          for (const { row, query } of rows) {
            const hit = cached.get(query.key);
            if (hit === undefined) continue;
            if (hit.imageUrl === row.onlineImageUrl) continue;
            byImage.set(hit.imageUrl, [...(byImage.get(hit.imageUrl) ?? []), row.id]);
          }
          return byImage;
        };
        for (const [imageUrl, ids] of changes(guideRows)) {
          yield* write
            .update(programmes)
            .set({ onlineImageUrl: imageUrl })
            .where(inArray(programmes.id, ids))
            .pipe(Effect.orDie);
        }
        for (const [imageUrl, ids] of changes(recordingRows)) {
          yield* write
            .update(recordings)
            .set({ onlineImageUrl: imageUrl })
            .where(inArray(recordings.id, ids))
            .pipe(Effect.orDie);
        }
      });

      return OnlineArtwork.of({ view, save, pass });
    }),
  );
}

/** Looks pictures up in the background for the server's lifetime. */
export const OnlineArtworkWorker = Layer.effectDiscard(
  Effect.gen(function* () {
    const online = yield* OnlineArtwork;
    yield* online.pass().pipe(
      Effect.catchCause((cause) => Effect.logError("Looking up online pictures failed", cause)),
      Effect.delay(Duration.seconds(15)),
      Effect.repeat(Schedule.spaced(PASS_INTERVAL)),
      Effect.forkScoped,
    );
  }),
);
