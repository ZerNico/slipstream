/**
 * Padding a person sets on a rule recording ("End early", extra time) survives the rule's
 * re-planning: the library entry and the stream-limit conflicts keep reflecting it.
 */
import { startFakeSource, type RunningFakeSource } from "@slipstream/fake-source";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Browser, startTestServer, type TestServer } from "./harness.ts";

let server: TestServer;
let fake: RunningFakeSource & { close(): Promise<void> };
let admin: Browser;

interface Channel {
  readonly id: string;
  readonly name: string;
}

interface Entry {
  readonly id: string;
  readonly state: string;
  readonly start: string;
  readonly end: string;
  readonly padding: { readonly beforeMinutes: number; readonly afterMinutes: number };
  readonly paddingSource?: string;
}

interface Conflict {
  readonly recordingIds: ReadonlyArray<string>;
}

const MINUTE = 60_000;

beforeAll(async () => {
  [server, fake] = await Promise.all([startTestServer(), startFakeSource()]);
  admin = new Browser(server.url);
  await admin.request("POST", "/api/auth/setup", {
    username: "admin",
    displayName: "Admin",
    password: "correct horse battery staple",
  });
});

afterAll(async () => {
  await Promise.all([server?.close(), fake?.close()]);
});

const conflictsAround = async (entry: Entry) => {
  const from = new Date(Date.parse(entry.start) - 60 * MINUTE).toISOString();
  const to = new Date(Date.parse(entry.end) + 120 * MINUTE).toISOString();
  return (await admin.request("GET", `/api/recordings/conflicts?from=${from}&to=${to}`))
    .json as Array<Conflict>;
};

describe("recording padding", () => {
  it("keeps 'End early' on a rule recording through re-planning", async () => {
    // One stream for the whole source, so two recordings at once are a conflict.
    const created = await admin.request("POST", "/api/sources", {
      name: "Fake",
      config: {
        _tag: "M3u",
        playlistUrl: `${fake.url}/playlist.m3u`,
        guideUrl: `${fake.url}/epg.xml`,
      },
      refreshIntervalMinutes: 60,
      maxStreams: 1,
      headers: {},
      guideCleanup: { removeDuplicates: true, rewrites: [] },
      enabled: true,
    });
    const sourceId = (created.json as { id: string }).id;
    expect((await admin.request("POST", `/api/sources/${sourceId}/refresh`)).status).toBe(200);
    const channels = (await admin.request("GET", "/api/channels")).json as Array<Channel>;
    const news = channels.find((channel) => channel.name === "Nachrichten 24")!;
    const other = channels.find((channel) => channel.id !== news.id)!;

    const rule = await admin.request("POST", "/api/rules", {
      name: "Weather",
      enabled: true,
      matcher: {
        channels: [news.id],
        title: [{ _tag: "IsExactly", values: ["Wetter"] }],
        categories: [],
        weekdays: [],
      },
      padding: { beforeMinutes: 1, afterMinutes: 30 },
      retention: { _tag: "KeepAll" },
    });
    expect(rule.status).toBe(200);
    const ruleId = (rule.json as { id: string }).id;
    const planned = (await admin.request("GET", `/api/recordings?ruleId=${ruleId}`))
      .json as Array<Entry>;
    const weather = planned
      .filter(
        (entry) =>
          entry.state === "scheduled" && Date.parse(entry.start) > Date.now() + 30 * MINUTE,
      )
      .toSorted((a, b) => Date.parse(a.start) - Date.parse(b.start))[0]!;
    expect(weather.padding).toEqual({ beforeMinutes: 1, afterMinutes: 30 });

    // Something else on another channel right after the weather, inside its extra time.
    const startMs = Date.parse(weather.end) + 10 * MINUTE;
    const manual = await admin.request("POST", "/api/recordings", {
      _tag: "Manual",
      channelId: other.id,
      title: "After the weather",
      range: {
        start: new Date(startMs).toISOString(),
        end: new Date(startMs + 10 * MINUTE).toISOString(),
      },
    });
    expect(manual.status).toBe(200);
    const before = await conflictsAround(weather);
    expect(before).toHaveLength(1);

    // "End early": no extra time after the programme.
    const shortened = await admin.request("PATCH", `/api/recordings/${weather.id}`, {
      padding: { beforeMinutes: 1, afterMinutes: 0 },
    });
    expect(shortened.status).toBe(200);
    expect(shortened.json).toMatchObject({
      padding: { beforeMinutes: 1, afterMinutes: 0 },
      paddingSource: "user",
    });
    expect(await conflictsAround(weather)).toEqual([]);

    // The guide refreshes and the rule changes: both re-plan, neither brings the 30 minutes back.
    expect((await admin.request("POST", `/api/sources/${sourceId}/refresh`)).status).toBe(200);
    expect(
      (await admin.request("PATCH", `/api/rules/${ruleId}`, { name: "Weather report" })).status,
    ).toBe(200);
    const after = (await admin.request("GET", `/api/recordings/${weather.id}`)).json as Entry;
    expect(after).toMatchObject({
      state: "scheduled",
      start: weather.start,
      end: weather.end,
      padding: { beforeMinutes: 1, afterMinutes: 0 },
      paddingSource: "user",
    });
    expect(await conflictsAround(weather)).toEqual([]);

    // Recordings the person did not touch still follow the rule.
    const untouched = (
      (await admin.request("GET", `/api/recordings?ruleId=${ruleId}`)).json as Array<Entry>
    ).find((entry) => entry.id !== weather.id && entry.state === "scheduled");
    expect(untouched?.padding).toEqual({ beforeMinutes: 1, afterMinutes: 30 });
    expect(untouched?.paddingSource).toBe("rule");
  });
});
