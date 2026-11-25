import { DateTime } from "effect";
import { describe, expect, it } from "vitest";
import { type EpisodeSubject, episodeIdentity, sameEpisode } from "../src/episode.ts";
import { DAY, HOUR, MINUTE } from "../src/time.ts";
import { context } from "./episode-fixtures.ts";
import { daserste, skyF1 } from "./test-support.ts";

/*
 * Properties of `sameEpisode` over generated airings. fast-check is not in the catalogue, so a
 * seeded generator (mulberry32) makes the same cases on every run.
 */

const runs = 300;

const generator = (seed: number) => {
  let state = seed >>> 0;
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
  const int = (min: number, max: number) => min + Math.floor(next() * (max - min + 1));
  const pick = <A>(values: ReadonlyArray<A>): A => values[int(0, values.length - 1)] as A;
  return { next, int, pick };
};

type Gen = ReturnType<typeof generator>;

const base = Date.UTC(2026, 10, 1, 12);
const shows = ["Tatort", "Polizeiruf 110", "Der Alte", "SOKO Leipzig", "Babylon Berlin"];
const subtitles = ["Unter Wölfen", "Schattenmann", "Der letzte Zeuge", "Nachtschicht", "Kalt"];
const descriptions = [
  undefined,
  "Ein Mord im Hafen führt die Kommissarinnen in die eigene Vergangenheit, und nichts ist, wie es scheint.",
  "Eine Entführung in der Vorstadt stellt das Team vor ein Rätsel, das nur ein alter Fall lösen kann.",
];
const films = ["Der Pate", "Casablanca", "Metropolis", "Das Boot"];
const events = ["Live F1: Rennen - GP Katar", "Darts: Grand Slam - Finale", "Live: Bundesliga"];
const broadcasts = ["Tagesschau", "Markus Lanz", "heute journal", "Brisant"];

const airing = (
  gen: Gen,
  startMs: number,
  fields: Partial<EpisodeSubject> & Pick<EpisodeSubject, "title">,
): EpisodeSubject => ({
  channelId: gen.pick([daserste, skyF1]),
  start: DateTime.makeUnsafe(startMs),
  end: DateTime.makeUnsafe(startMs + gen.int(15, 180) * MINUTE),
  categories: [],
  repeat: false,
  live: false,
  ...fields,
});

const episodeAiring = (gen: Gen): EpisodeSubject => {
  const numbered = gen.next() < 0.6;
  const description = gen.pick(descriptions);
  return airing(gen, base + gen.int(0, 30) * DAY + gen.int(0, 23) * HOUR, {
    title: gen.pick(shows),
    subtitle: numbered && gen.next() < 0.3 ? undefined : gen.pick(subtitles),
    ...(numbered ? { episode: { season: gen.int(1, 3), episode: gen.int(1, 12) } } : {}),
    ...(description === undefined ? {} : { description }),
    repeat: gen.next() < 0.3,
    categories: gen.next() < 0.3 ? ["Krimi"] : [],
  });
};

const filmAiring = (gen: Gen): EpisodeSubject =>
  airing(gen, base + gen.int(0, 30) * DAY, {
    title: gen.pick(films),
    categories: ["Spielfilm"],
    originalAirDate: { year: gen.int(1970, 1975) },
    repeat: gen.next() < 0.5,
  });

const forEachCase = (seed: number, check: (gen: Gen) => void) => {
  const gen = generator(seed);
  for (let run = 0; run < runs; run += 1) check(gen);
};

describe("same episode, properties", () => {
  it("is reflexive for Episodes and Films", () => {
    forEachCase(1, (gen) => {
      const episode = episodeAiring(gen);
      expect(episodeIdentity(episode, context)._tag).toBe("Episode");
      expect(sameEpisode(episode, episode, context)).toBe(true);
      const film = filmAiring(gen);
      expect(episodeIdentity(film, context)._tag).toBe("Film");
      expect(sameEpisode(film, film, context)).toBe(true);
    });
  });

  it("is symmetric for Episodes and Films", () => {
    forEachCase(2, (gen) => {
      const [a, b] =
        gen.next() < 0.5
          ? [episodeAiring(gen), episodeAiring(gen)]
          : [filmAiring(gen), filmAiring(gen)];
      expect(sameEpisode(a, b, context)).toBe(sameEpisode(b, a, context));
    });
  });

  it("never matches Events on local days that are not the same or next", () => {
    forEachCase(3, (gen) => {
      const startMs = base + gen.int(0, 20) * DAY + gen.int(8, 20) * HOUR;
      const title = gen.pick(events);
      const earlier = airing(gen, startMs, { title, live: true, categories: ["Sport"] });
      const later = airing(gen, startMs + gen.int(2, 40) * DAY, {
        title: gen.next() < 0.5 ? `${title} (Wh.)` : title,
        repeat: gen.next() < 0.5,
        live: gen.next() < 0.5,
        categories: ["Sport"],
      });
      expect(episodeIdentity(earlier, context)._tag).toBe("Event");
      expect(sameEpisode(earlier, later, context)).toBe(false);
    });
  });

  it("never matches Broadcasts without an explicit repeat marker", () => {
    forEachCase(4, (gen) => {
      const title = gen.pick(broadcasts);
      const startMs = base + gen.int(0, 20) * DAY + gen.int(0, 23) * HOUR;
      const earlier = airing(gen, startMs, { title, live: gen.next() < 0.5 });
      const later = airing(gen, startMs + gen.int(1, 30) * HOUR, { title });
      expect(episodeIdentity(later, context)._tag).toBe("Broadcast");
      expect(sameEpisode(earlier, later, context)).toBe(false);
    });
  });
});
