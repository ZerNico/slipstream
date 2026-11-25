/**
 * Online pictures end to end, through the real HTTP server against the fake source's guide with
 * TMDB answered by a stub: the key is checked before it is stored and never sent back, a pass
 * puts a picture on films and series, and sport and news keep none.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { startFakeSource, type RunningFakeSource } from "@slipstream/fake-source";
import { Browser, startTestServer, type TestServer } from "./harness.ts";

const HOUR = 3_600_000;
const password = "correct horse battery staple";

interface Programme {
  readonly id: string;
  readonly title: string;
  readonly categories: ReadonlyArray<string>;
  readonly onlineImageUrl?: string;
}

let server: TestServer;
let fake: RunningFakeSource & { close(): Promise<void> };
let admin: Browser;
const searches: string[] = [];

/** TMDB as a stub: the key `good` works; a search finds exactly what it was asked for. */
const realFetch = globalThis.fetch;
const tmdb = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
  const url = new URL(input instanceof Request ? input.url : input.toString());
  if (url.hostname !== "api.themoviedb.org") return realFetch(input, init);
  if (url.searchParams.get("api_key") !== "good") return new Response("{}", { status: 401 });
  if (url.pathname === "/3/configuration") return Response.json({ images: {} });
  const query = url.searchParams.get("query") ?? "";
  searches.push(`${url.pathname}:${query}`);
  const slug = query.toLowerCase().replaceAll(/\W+/gu, "-");
  return Response.json({
    results: [{ title: query, name: query, backdrop_path: `/${slug}.jpg` }],
  });
};

beforeAll(async () => {
  vi.stubGlobal("fetch", tmdb);
  [server, fake] = await Promise.all([startTestServer(), startFakeSource({ guideHours: 48 })]);
  admin = new Browser(server.url);
  await admin.request("POST", "/api/auth/setup", { username: "admin", displayName: "A", password });
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
  const sourceId = (source.json as { id: string }).id;
  expect((await admin.request("POST", `/api/sources/${sourceId}/refresh`)).status).toBe(200);
});

afterAll(async () => {
  vi.unstubAllGlobals();
  await Promise.all([server?.close(), fake?.close()]);
});

/** The next day's guide entries (no pictures: those are in each programme's own answer). */
const guide = async (): Promise<ReadonlyArray<Programme>> => {
  const from = new Date(Date.now() - HOUR);
  const to = new Date(Date.now() + 24 * HOUR);
  return (
    await admin.request("GET", `/api/guide?from=${from.toISOString()}&to=${to.toISOString()}`)
  ).json as ReadonlyArray<Programme>;
};

/** Programmes in full, pictures included. */
const details = async (entries: ReadonlyArray<Programme>): Promise<ReadonlyArray<Programme>> =>
  Promise.all(
    entries.map(
      async (entry) =>
        (await admin.request("GET", `/api/guide/programmes/${entry.id}`)).json as Programme,
    ),
  );

describe("online pictures (TMDB)", () => {
  it("refuses a key TMDB refuses and stores one it takes, without sending it back", async () => {
    const refused = await admin.request("PUT", "/api/settings/artwork", { tmdbKey: "bad" });
    expect(refused.status).toBe(422);
    expect(JSON.stringify(refused.json)).toContain("invalidKey");
    expect((await admin.request("GET", "/api/settings/artwork")).json).toEqual({ tmdb: false });

    const saved = await admin.request("PUT", "/api/settings/artwork", { tmdbKey: "good" });
    expect(saved.status).toBe(200);
    expect(saved.json).toEqual({ tmdb: true });
    expect(
      JSON.stringify((await admin.request("GET", "/api/settings/artwork")).json),
    ).not.toContain("good");
  });

  it("puts a picture on films and series and leaves sport and news alone", async () => {
    await server.lookUpOnlineArtwork();
    const entries = await guide();
    const of = (categories: ReadonlyArray<string>) =>
      entries.filter((entry) => entry.categories.some((category) => categories.includes(category)));
    const programmes = await details([
      ...of(["Spielfilm"]).slice(0, 1),
      ...of(["Serie"]).slice(0, 1),
      ...of(["Sport", "Motorsport", "Nachrichten"]).slice(0, 12),
    ]);
    const film = programmes.find((programme) => programme.categories.includes("Spielfilm"));
    expect(film?.onlineImageUrl).toMatch(/^https:\/\/image\.tmdb\.org\/t\/p\/w780\/.+\.jpg$/u);
    const series = programmes.find((programme) => programme.categories.includes("Serie"));
    expect(series?.onlineImageUrl).toBeDefined();
    const others = programmes.filter((programme) =>
      programme.categories.some((category) =>
        ["Sport", "Motorsport", "Nachrichten"].includes(category),
      ),
    );
    expect(others.length).toBeGreaterThan(0);
    expect(others.every((programme) => programme.onlineImageUrl === undefined)).toBe(true);
  });

  it("asks once per title, however many airings it has", async () => {
    const before = searches.length;
    await server.lookUpOnlineArtwork();
    expect(searches.length).toBe(before);
    expect(new Set(searches).size).toBe(searches.length);
  });
});
