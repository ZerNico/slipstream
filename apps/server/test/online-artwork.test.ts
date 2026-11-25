import { describe, expect, it } from "vitest";
import {
  onlineQuery,
  pickImage,
  searchLanguage,
  tmdbAuth,
  tmdbSearchUrl,
} from "../src/artwork/online.ts";

describe("onlineQuery", () => {
  it("looks films up as films with their year, series as series", () => {
    expect(
      onlineQuery({
        title: "Der letzte Zug",
        categories: ["Spielfilm"],
        originalAirDate: { year: 1998 },
      }),
    ).toEqual({
      key: "movie:der letzte zug:1998",
      kind: "movie",
      query: "Der letzte Zug",
      year: 1998,
    });
    expect(onlineQuery({ title: "Tatort", categories: ["Krimi"] })).toEqual({
      key: "tv:tatort",
      kind: "tv",
      query: "Tatort",
    });
  });

  it("leaves sport and news alone", () => {
    expect(onlineQuery({ title: "Live F1: Rennen", categories: ["Sport"] })).toBeUndefined();
    expect(onlineQuery({ title: "Tagesschau", categories: ["Nachrichten"] })).toBeUndefined();
  });

  it("shares one key between airings that differ only in spacing and case", () => {
    expect(onlineQuery({ title: "Die  Waldbande", categories: [] })?.key).toBe(
      onlineQuery({ title: "die waldbande", categories: [] })?.key,
    );
  });
});

describe("pickImage", () => {
  const query = { key: "movie:der letzte zug", kind: "movie" as const, query: "Der letzte Zug" };

  it("takes the backdrop of a result with the same title or original title", () => {
    expect(
      pickImage(
        [
          { title: "Der letzte Zug nach Hause", backdrop_path: "/wrong.jpg" },
          { title: "Der letzte Zug", backdrop_path: "/right.jpg" },
        ],
        query,
      ),
    ).toBe("https://image.tmdb.org/t/p/w780/right.jpg");
    expect(
      pickImage(
        [{ title: "The Last Train", original_title: "Der letzte Zug", backdrop_path: "/o.jpg" }],
        query,
      ),
    ).toBe("https://image.tmdb.org/t/p/w780/o.jpg");
  });

  it("finds nothing for a near miss or a match without a backdrop", () => {
    expect(
      pickImage([{ title: "Der letzte Zug 2", backdrop_path: "/x.jpg" }], query),
    ).toBeUndefined();
    expect(pickImage([{ title: "Der letzte Zug", backdrop_path: null }], query)).toBeUndefined();
  });
});

describe("TMDB requests", () => {
  it("sends a v4 token as a bearer token and a v3 key as a parameter", () => {
    expect(tmdbAuth("eyJhbGciOi.token")).toEqual({
      headers: { authorization: "Bearer eyJhbGciOi.token" },
      params: {},
    });
    expect(tmdbAuth("abc123")).toEqual({ headers: {}, params: { api_key: "abc123" } });
  });

  it("searches in the guide's language, with the year for a film", () => {
    const url = new URL(
      tmdbSearchUrl(
        { key: "movie:x:1998", kind: "movie", query: "Der letzte Zug", year: 1998 },
        "abc",
        searchLanguage("Europe/Berlin"),
      ),
    );
    expect(url.pathname).toBe("/3/search/movie");
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      query: "Der letzte Zug",
      language: "de-DE",
      year: "1998",
      api_key: "abc",
    });
    expect(searchLanguage("America/New_York")).toBe("en-US");
  });
});
