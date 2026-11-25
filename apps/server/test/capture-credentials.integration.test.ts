/**
 * Provider credentials stay out of what the server keeps about a capture: a stream URL with a
 * user name and password in it (and in its path, Xtream style) that ffmpeg fails to open leaves
 * capture log lines that name the host, never the credentials.
 */
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { captureLogs, sourceStreams } from "../src/db/schema.ts";
import { Browser, startTestServer, type TestServer } from "./harness.ts";

/** Nothing listens on the discard port, so every connection is refused at once. */
const STREAM_URL = "http://u:p@127.0.0.1:9/live/u/p/1.ts";

let server: TestServer;
let provider: Server;
let providerUrl: string;
let admin: Browser;

beforeAll(async () => {
  provider = createServer((request, response) => {
    if (request.url?.startsWith("/playlist.m3u") === true) {
      response.end(`#EXTM3U\n#EXTINF:-1 tvg-id="secret.tv",Secret TV\n${STREAM_URL}\n`);
    } else {
      response.end(
        `<?xml version="1.0"?><tv><channel id="secret.tv"><display-name>Secret TV</display-name></channel></tv>`,
      );
    }
  });
  await new Promise<void>((resolve) => provider.listen(0, "127.0.0.1", resolve));
  providerUrl = `http://127.0.0.1:${(provider.address() as AddressInfo).port}`;
  server = await startTestServer();
  admin = new Browser(server.url);
  await admin.request("POST", "/api/auth/setup", {
    username: "admin",
    displayName: "Admin",
    password: "correct horse battery staple",
  });
});

afterAll(async () => {
  await server?.close();
  provider?.closeAllConnections();
  await new Promise((resolve) => provider?.close(resolve));
});

const until = async <A>(read: () => Promise<A>, done: (value: A) => boolean, ms = 30_000) => {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = await read();
    if (done(value) || Date.now() > deadline) return value;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
};

describe("capture credentials", () => {
  it("keeps stream credentials out of the database and the capture log", async () => {
    const created = await admin.request("POST", "/api/sources", {
      name: "Provider",
      config: {
        _tag: "M3u",
        playlistUrl: `${providerUrl}/playlist.m3u`,
        guideUrl: `${providerUrl}/epg.xml`,
      },
      refreshIntervalMinutes: 60,
      headers: {},
      guideCleanup: { removeDuplicates: true, rewrites: [] },
      enabled: true,
    });
    const sourceId = (created.json as { id: string }).id;
    expect((await admin.request("POST", `/api/sources/${sourceId}/refresh`)).status).toBe(200);
    const [stream] = await server.run(server.db.read.select().from(sourceStreams));
    expect(stream?.url).toMatch(/^v1:/);

    const [channel] = (await admin.request("GET", "/api/channels")).json as Array<{ id: string }>;
    const now = Date.now();
    const recording = await admin.request("POST", "/api/recordings", {
      _tag: "Manual",
      channelId: channel!.id,
      title: "Secret show",
      range: {
        start: new Date(now).toISOString(),
        end: new Date(now + 3 * 60_000).toISOString(),
      },
    });
    expect(recording.status).toBe(200);

    // ffmpeg's own complaint about the URL it could not open.
    const lines = await until(
      () => server.run(server.db.read.select().from(captureLogs)),
      (rows) => rows.some((row) => row.message.includes("127.0.0.1:9")),
    );
    const messages = lines.map((row) => row.message);
    expect(messages.some((message) => message.includes("127.0.0.1:9/live/***/***/1.ts"))).toBe(
      true,
    );
    for (const message of messages) {
      expect(message).not.toContain("u:p@");
      expect(message).not.toContain("/u/p/");
      expect(message).not.toMatch(/\/p\//);
    }
    await admin.request("POST", `/api/recordings/${(recording.json as { id: string }).id}/stop`);
  }, 60_000);
});
