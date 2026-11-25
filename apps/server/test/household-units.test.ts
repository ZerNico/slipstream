/**
 * Pure pieces of the web v2 server work: the live-stream verdict, the stream overview, home
 * versus away addresses, invite validity, recording settings checks and frame-grab windows.
 */
import { DateTime } from "effect";
import { describe, expect, it } from "vitest";
import { frameGrabArgs, frameWindowStart } from "../src/artwork/frames.ts";
import { inviteProblem } from "../src/guests/service.ts";
import { isHomeAddress } from "../src/http/authentication.ts";
import { liveVerdict } from "../src/playback/service.ts";
import { recordingSettingsProblems } from "../src/settings/service.ts";
import { streamOverview } from "../src/streams/service.ts";
import type { ChannelId } from "@slipstream/domain";

const tvproxy = { id: "tvproxy", maxStreams: 4, keptForRecordings: 2 };
const stream = (
  channelId: string,
  kinds: ReadonlyArray<"recording" | "live">,
  sourceId: string | undefined = "tvproxy",
) => ({
  channelId: channelId as ChannelId,
  sourceId: sourceId as never,
  startedAtMs: 1000,
  consumers: kinds.map((kind, index) => ({ id: `${channelId}-${kind}-${index}`, kind })),
});

describe("liveVerdict", () => {
  const base = { sources: [tvproxy], profileLimit: undefined, profileWatching: 0 };

  it("lets a viewer join a channel that is already captured, even on a full source", () => {
    const streams = ["a", "b", "c", "d"].map((id) => stream(id, ["live"]));
    expect(liveVerdict({ ...base, channelId: "a", streams })._tag).toBe("ok");
    expect(liveVerdict({ ...base, channelId: "e", streams })).toEqual({
      _tag: "sourceFull",
      sourceId: "tvproxy",
    });
  });

  it("keeps streams for recordings: 4 allowed, 2 kept leaves 2 for watching", () => {
    const two = [stream("a", ["live"]), stream("b", ["live"])];
    expect(liveVerdict({ ...base, channelId: "c", streams: two })._tag).toBe("sourceFull");
    expect(liveVerdict({ ...base, channelId: "c", streams: two.slice(1) })._tag).toBe("ok");
    // Three recordings leave one stream, which one viewer takes.
    const recording = ["a", "b", "c"].map((id) => stream(id, ["recording"]));
    expect(liveVerdict({ ...base, channelId: "d", streams: recording })._tag).toBe("ok");
    expect(
      liveVerdict({
        ...base,
        channelId: "e",
        streams: [...recording, stream("d", ["live"])],
      })._tag,
    ).toBe("sourceFull");
  });

  it("falls back to another source with room, and stops at the profile's own limit first", () => {
    const full = ["a", "b"].map((id) => stream(id, ["live"]));
    const spare = { id: "backup", maxStreams: null, keptForRecordings: null };
    expect(
      liveVerdict({ ...base, sources: [tvproxy, spare], channelId: "c", streams: full })._tag,
    ).toBe("ok");
    expect(
      liveVerdict({ ...base, profileLimit: 1, profileWatching: 1, channelId: "a", streams: full }),
    ).toEqual({ _tag: "profileLimit" });
  });
});

describe("streamOverview", () => {
  it("counts streams with a recording as recording and hides other people from guests", () => {
    const [source] = streamOverview({
      sources: [{ id: "tvproxy", name: "tvproxy", maxStreams: 4, keptForRecordings: 2 }],
      streams: [
        stream("a", ["recording", "live"]),
        stream("b", ["live"]),
        stream("c", ["live"], "other"),
      ],
      live: new Map([
        [
          "a-live-1",
          {
            id: "a-live-1",
            userId: "me",
            channelId: "a",
            createdAt: 5000,
            deviceName: "Kitchen Shield",
          },
        ],
        [
          "b-live-0",
          {
            id: "b-live-0",
            userId: "jonas",
            channelId: "b",
            createdAt: 6000,
            deviceName: undefined,
          },
        ],
      ]),
      recordings: new Map([["a-recording-0", { channelId: "a", startMs: 500 }]]),
      showUser: (userId) => userId === "me",
      showChannel: () => true,
    });
    expect(source?.counts).toEqual({
      maxStreams: 4,
      keptForRecordings: 2,
      recording: 1,
      watching: 1,
    });
    expect(source?.uses).toEqual([
      {
        _tag: "Recording",
        channelId: "a",
        recordingId: "a-recording-0",
        since: DateTime.makeUnsafe(1000),
      },
      {
        _tag: "Watching",
        channelId: "a",
        playbackSessionId: "a-live-1",
        since: DateTime.makeUnsafe(5000),
        userId: "me",
        deviceName: "Kitchen Shield",
      },
      {
        _tag: "Watching",
        channelId: "b",
        playbackSessionId: "b-live-0",
        since: DateTime.makeUnsafe(6000),
      },
    ]);
  });
});

describe("isHomeAddress", () => {
  it("treats loopback, private, link-local and unique-local addresses as home", () => {
    for (const address of [
      "127.0.0.1",
      "10.1.2.3",
      "172.20.0.5",
      "192.168.12.50",
      "::ffff:192.168.1.2",
      "::1",
      "fd12:3456::1",
      "fe80::1",
      "100.101.102.103",
    ]) {
      expect([address, isHomeAddress(address)]).toEqual([address, true]);
    }
    for (const address of ["8.8.8.8", "172.32.0.1", "2a00:1450::1", "unknown"]) {
      expect([address, isHomeAddress(address)]).toEqual([address, false]);
    }
  });
});

describe("inviteProblem", () => {
  const open = { usedAt: null, revokedAt: null, expiresAt: null };
  it("says why an invite can no longer be used", () => {
    expect(inviteProblem(open, 10)).toBeUndefined();
    expect(inviteProblem({ ...open, expiresAt: 10 }, 10)).toBe("expired");
    expect(inviteProblem({ ...open, expiresAt: 10, revokedAt: 5 }, 10)).toBe("revoked");
    expect(inviteProblem({ ...open, usedAt: 3, revokedAt: 5 }, 1)).toBe("used");
  });
});

describe("recordingSettingsProblems", () => {
  it("points at duplicate overrides and artwork sources", () => {
    const padding = { beforeMinutes: 1, afterMinutes: 1 };
    expect(
      recordingSettingsProblems({
        extraTime: {
          padding,
          overrides: [
            { _tag: "Category", category: "Sport", padding },
            { _tag: "Category", category: " sport ", padding },
          ],
        },
        artworkOrder: ["guide", "guide"],
      }),
    ).toEqual([
      { path: "extraTime.overrides.1", code: "duplicateCategory" },
      { path: "artworkOrder", code: "duplicateSource" },
    ]);
  });
});

describe("frame grab windows", () => {
  const programme = {
    start: DateTime.makeUnsafe(Date.UTC(2026, 10, 21, 16, 0)),
    end: DateTime.makeUnsafe(Date.UTC(2026, 10, 21, 17, 0)),
  };

  it("starts 10 minutes in and looks two minutes later after each black window", () => {
    expect(frameWindowStart(programme, 0)).toBe(Date.UTC(2026, 10, 21, 16, 10));
    expect(frameWindowStart(programme, 2)).toBe(Date.UTC(2026, 10, 21, 16, 14));
  });

  it("seeks into the first segment and joins the window's segments", () => {
    const from = Date.UTC(2026, 10, 21, 16, 10);
    const args = frameGrabArgs(
      [
        { startMs: from - 2500, durationMs: 6000, file: "/c/1.ts" },
        { startMs: from + 3500, durationMs: 6000, file: "/c/2.ts" },
      ],
      from,
      "/frames/r.jpg",
    );
    expect(args.slice(args.indexOf("-ss"), args.indexOf("-ss") + 2)).toEqual(["-ss", "2.500"]);
    expect(args).toContain("concat:/c/1.ts|/c/2.ts");
    expect(args.at(-1)).toBe("/frames/r.jpg");
  });
});
