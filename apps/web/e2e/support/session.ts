/**
 * The e2e session every journey shares (`pnpm e2e` starts a fresh server and the fake source):
 * the admin is created on first use and signed in through the API, and `seed` gives the server
 * the data the screens need: the fake source with its guide, the "Formel 1" collection and the
 * "F1 live sessions" rule from the dev seed, and one recording that is running now. Journeys that
 * need more (a second running recording) seed it here through the API, never skip without it.
 *
 * ```ts
 * import { seed, settle, signIn } from "./support/session.ts";
 * test.beforeEach(async ({ page }) => seed(page));
 * ```
 */
import { expect, type APIResponse, type Page, test } from "@playwright/test";
import { CollectionInput, csrfCookie, csrfHeader, RuleInput } from "@slipstream/api";
import { ChannelId, CollectionId, SourceInput } from "@slipstream/domain";
import { Schema } from "effect";
import { f1Collection, F1_CHANNEL, f1Rule } from "../../../../scripts/dev-seed.ts";
import { settledForMeasure, trackRequests } from "./layout.ts";

/** The server under test and its fake source, from `pnpm e2e`. */
export const serverUrl = process.env.SLIPSTREAM_E2E_URL;
export const sourceUrl = process.env.SLIPSTREAM_E2E_SOURCE_URL;
const username = process.env.SLIPSTREAM_E2E_USERNAME ?? "admin";
const password = process.env.SLIPSTREAM_E2E_PASSWORD ?? "e2e-password-1234";

/** The admin the journeys sign in as. */
export const admin = { username, password } as const;

/**
 * Skips the file without a server (and a source, when the journey needs the guide), so
 * `playwright test` is safe anywhere. CI sets `SLIPSTREAM_E2E_REQUIRED`, and the config then
 * refuses to run without them instead (see playwright.config.ts).
 */
export const requireServer = (options: { readonly source?: boolean } = {}): void => {
  test.skip(
    serverUrl === undefined || (options.source === true && sourceUrl === undefined),
    "Set SLIPSTREAM_E2E_URL and SLIPSTREAM_E2E_SOURCE_URL (pnpm e2e does).",
  );
};

/**
 * Creates the admin on a fresh server, else signs in; the page's context keeps the cookie. The
 * page counts its API reads from here on, so `settle` can wait for the last answer.
 */
export const signIn = async (page: Page): Promise<void> => {
  await trackRequests(page);
  const setup = await page.request.post("/api/auth/setup", {
    data: { username, password, displayName: "E2E Admin" },
  });
  if (setup.ok()) return;
  const login = await page.request.post("/api/auth/login", { data: { username, password } });
  expect(login.ok()).toBe(true);
};

/** The CSRF header writes signed in by cookie must echo, as the web client does. */
const csrf = async (page: Page): Promise<Record<string, string>> => {
  const cookies = await page.context().cookies();
  return { [csrfHeader]: cookies.find((cookie) => cookie.name === csrfCookie)?.value ?? "" };
};

const json = async <A>(response: APIResponse): Promise<A> => {
  expect(response.ok(), `${response.url()} answered ${response.status()}`).toBe(true);
  return (await response.json()) as A;
};

/** A signed-in API for the test itself: reads and CSRF-protected writes. */
export const api = (page: Page) => ({
  get: async <A>(path: string): Promise<A> => json<A>(await page.request.get(path)),
  post: async <A>(path: string, data?: unknown): Promise<A> =>
    json<A>(await page.request.post(path, { headers: await csrf(page), data })),
  patch: async <A>(path: string, data: unknown): Promise<A> =>
    json<A>(await page.request.patch(path, { headers: await csrf(page), data })),
  delete: async (path: string): Promise<void> => {
    const response = await page.request.delete(path, { headers: await csrf(page) });
    expect(response.ok()).toBe(true);
  },
});

interface Named {
  readonly id: string;
  readonly name: string;
}
/** What the seed made, for journeys that need ids. */
export interface Seeded {
  readonly channels: readonly Named[];
  readonly f1: Named;
  readonly collection: Named;
  readonly rule: Named;
  /** A recording running now on a channel other than F1; running while the test runs. */
  readonly running: Running;
}

/** A recording that runs now. */
export interface Running {
  readonly id: string;
  readonly title: string;
  readonly channelId: string;
}

interface Listed extends Running {
  readonly state: string;
}

/**
 * Starts a manual range recording on `channelId` from now for `minutes`: a recording that is
 * running whatever the guide has on air, so no journey depends on the schedule.
 */
export const startRangeRecording = async (
  page: Page,
  channelId: string,
  title: string,
  minutes = 30,
): Promise<Running> => {
  const start = Date.now();
  const created = await api(page).post<Running>("/api/recordings", {
    _tag: "Manual",
    channelId,
    title,
    range: {
      start: new Date(start).toISOString(),
      end: new Date(start + minutes * 60_000).toISOString(),
    },
  });
  await expect
    .poll(async () => {
      const list = await api(page).get<Listed[]>("/api/recordings");
      return list.find((entry) => entry.id === created.id)?.state;
    })
    .toBe("recording");
  return created;
};

/**
 * A finished recording: the first completed one, else a one-minute range recording started now
 * on a free channel, awaited until the server has finished it.
 */
export const completedRecording = async (page: Page): Promise<Running> => {
  const call = api(page);
  const done = (await call.get<Listed[]>("/api/recordings")).find(
    (entry) => entry.state === "completed",
  );
  if (done !== undefined) return done;
  const running = (await call.get<Listed[]>("/api/recordings")).filter(
    (entry) => entry.state === "recording",
  );
  const busy = new Set(running.map((entry) => entry.channelId));
  const channel = (await call.get<Named[]>("/api/channels")).find((c) => !busy.has(c.id));
  if (channel === undefined) throw new Error("no channel free for a short recording");
  const short = await startRangeRecording(page, channel.id, `E2E short on ${channel.name}`, 1);
  await expect
    .poll(
      async () =>
        (await call.get<Listed[]>("/api/recordings")).find((entry) => entry.id === short.id)?.state,
      { timeout: 120_000, intervals: [2_000] },
    )
    .toBe("completed");
  return short;
};

/** Running recordings, at least `count` of them on distinct channels (seeding the rest). */
export const runningRecordings = async (
  page: Page,
  count: number,
  avoid: readonly string[] = [],
): Promise<readonly Running[]> => {
  const call = api(page);
  const running = (await call.get<Listed[]>("/api/recordings")).filter(
    (entry) => entry.state === "recording",
  );
  const channels = await call.get<Named[]>("/api/channels");
  const busy = new Set([...avoid, ...running.map((entry) => entry.channelId)]);
  const free = channels.filter((channel) => !busy.has(channel.id));
  const added: Running[] = [];
  for (const channel of free.slice(0, Math.max(0, count - running.length))) {
    added.push(await startRangeRecording(page, channel.id, `E2E live on ${channel.name}`));
  }
  const all = [...running, ...added];
  expect(all.length, "channels free for a running recording").toBeGreaterThanOrEqual(count);
  return all;
};

/**
 * Signs in and makes sure the server has data: the fake source refreshed, the F1 collection and
 * rule, and a running recording of something on air now. Idempotent, so every test can call it.
 */
export const seed = async (page: Page): Promise<Seeded> => {
  if (sourceUrl === undefined) throw new Error("seed needs SLIPSTREAM_E2E_SOURCE_URL");
  await signIn(page);
  const call = api(page);
  const sources = await call.get<Named[]>("/api/sources");
  if (sources.length === 0) {
    const created = await call.post<Named>(
      "/api/sources",
      Schema.encodeSync(SourceInput)({
        name: "E2E source",
        config: {
          _tag: "M3u",
          playlistUrl: `${sourceUrl}/playlist.m3u`,
          guideUrl: `${sourceUrl}/epg.xml`,
        },
        refreshIntervalMinutes: 60,
        headers: {},
        guideCleanup: { removeDuplicates: true, rewrites: [] },
        enabled: true,
      }),
    );
    await call.post(`/api/sources/${created.id}/refresh`);
  }
  const channels = await call.get<Named[]>("/api/channels");
  const f1 = channels.find((channel) => channel.name === F1_CHANNEL);
  if (f1 === undefined) throw new Error(`no ${F1_CHANNEL} channel after the refresh`);
  const collection =
    (await call.get<Named[]>("/api/collections")).find((c) => c.name === f1Collection.name) ??
    (await call.post<Named>("/api/collections", Schema.encodeSync(CollectionInput)(f1Collection)));
  const draft = f1Rule(ChannelId.make(f1.id), CollectionId.make(collection.id));
  const rule =
    (await call.get<Named[]>("/api/rules")).find((r) => r.name === draft.name) ??
    (await call.post<Named>("/api/rules", Schema.encodeSync(RuleInput)(draft)));

  const [running] = await runningRecordings(page, 1, [f1.id]);
  if (running === undefined) throw new Error("no running recording after seeding one");
  return { channels, f1, collection, rule, running };
};

/**
 * Waits until the route has mounted, its reads have answered, fonts and on-screen images have
 * loaded and the page has painted, so a check sees the real screen (`settledForMeasure`).
 */
export const settle = (page: Page, scope = "main"): Promise<void> => settledForMeasure(page, scope);
