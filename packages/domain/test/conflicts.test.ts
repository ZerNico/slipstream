import { DateTime } from "effect";
import { describe, expect, it } from "vitest";
import { detectConflicts, type ChannelSources, type StreamDemand } from "../src/conflicts.ts";
import { SourceId } from "../src/ids.ts";
import { arte, at, daserste, prosieben, skyF1 } from "./test-support.ts";

const tvproxy = SourceId.make("tvproxy");
const backup = SourceId.make("backup");

const demand = (
  id: string,
  channelId: StreamDemand["channelId"],
  start: string,
  end: string,
  kind: StreamDemand["kind"] = "recording",
): StreamDemand => ({
  id,
  channelId,
  kind,
  range: { start: at(`2026-11-22T${start}:00Z`), end: at(`2026-11-22T${end}:00Z`) },
});

const window = (conflict: { range: { start: DateTime.Utc; end: DateTime.Utc } }) =>
  [conflict.range.start, conflict.range.end].map((instant) =>
    DateTime.formatIso(instant).slice(11, 16),
  );

describe("conflict detection", () => {
  const onlyTvproxy: ReadonlyArray<ChannelSources> = [skyF1, daserste, prosieben, arte].map(
    (channelId) => ({ channelId, sourceIds: [tvproxy] }),
  );

  it("is quiet when the source has no limit", () => {
    const demands = [demand("a", skyF1, "04:00", "06:00"), demand("b", daserste, "04:00", "06:00")];
    expect(detectConflicts(demands, onlyTvproxy, [{ id: tvproxy }])).toEqual([]);
  });

  it("counts recordings on the same channel once, since they share a capture", () => {
    const demands = [
      demand("race", skyF1, "04:00", "06:00"),
      demand("interviews", skyF1, "05:30", "07:00"),
      demand("watching", skyF1, "04:00", "07:00", "live"),
    ];
    expect(detectConflicts(demands, onlyTvproxy, [{ id: tvproxy, maxStreams: 1 }])).toEqual([]);
  });

  it("reports the overlap when a source runs out of streams", () => {
    const demands = [
      demand("race", skyF1, "04:00", "06:00"),
      demand("tatort", daserste, "05:00", "07:00"),
    ];
    const conflicts = detectConflicts(demands, onlyTvproxy, [{ id: tvproxy, maxStreams: 1 }]);
    expect(conflicts).toHaveLength(1);
    expect(window(conflicts[0]!)).toEqual(["05:00", "06:00"]);
    expect(conflicts[0]).toMatchObject({
      channelIds: [daserste],
      demandIds: ["tatort"],
      sourceIds: [tvproxy],
      capacity: 1,
    });
  });

  it("says how many recordings the full sources carry at once, net of live viewers kept", () => {
    const demands = [
      demand("race", skyF1, "04:00", "06:00"),
      demand("tatort", daserste, "04:00", "06:00"),
      demand("arte", arte, "04:00", "06:00"),
    ];
    const channels = [skyF1, daserste, arte].map((channelId) => ({
      channelId,
      sourceIds: [tvproxy],
    }));
    const [twoOfThree] = detectConflicts(demands, channels, [{ id: tvproxy, maxStreams: 2 }]);
    expect(twoOfThree).toMatchObject({ channelIds: [arte], capacity: 2 });
    // Channels with no stream at all have nowhere to record.
    expect(detectConflicts([demand("a", arte, "04:00", "05:00")], [], [])[0]?.capacity).toBe(0);
  });

  it("gives recordings priority over live viewing", () => {
    const demands = [
      demand("watching", prosieben, "03:00", "08:00", "live"),
      demand("race", skyF1, "04:00", "06:00"),
    ];
    const conflicts = detectConflicts(demands, onlyTvproxy, [{ id: tvproxy, maxStreams: 1 }]);
    expect(conflicts.map((conflict) => conflict.demandIds)).toEqual([["watching"]]);
    expect(window(conflicts[0]!)).toEqual(["04:00", "06:00"]);
  });

  it("moves a channel to its fallback source to make room", () => {
    // Sky F1 is on both sources, Das Erste only on tvproxy. A greedy pick would put Sky F1 on
    // tvproxy and strand Das Erste.
    const channels: ReadonlyArray<ChannelSources> = [
      { channelId: skyF1, sourceIds: [tvproxy, backup] },
      { channelId: daserste, sourceIds: [tvproxy] },
    ];
    const demands = [
      demand("race", skyF1, "04:00", "06:00"),
      demand("tatort", daserste, "05:00", "07:00"),
    ];
    const limits = [
      { id: tvproxy, maxStreams: 1 },
      { id: backup, maxStreams: 1 },
    ];
    expect(detectConflicts(demands, channels, limits)).toEqual([]);
    const third = [...demands, demand("arte", arte, "05:30", "05:45")];
    const conflicts = detectConflicts(
      third,
      [...channels, { channelId: arte, sourceIds: [backup] }],
      limits,
    );
    expect(conflicts.map((conflict) => [window(conflict), conflict.channelIds])).toEqual([
      [["05:30", "05:45"], [arte]],
    ]);
  });

  it("flags channels without any stream and merges adjacent ranges", () => {
    const demands = [demand("a", arte, "04:00", "05:00"), demand("b", arte, "05:00", "06:00")];
    const conflicts = detectConflicts(demands, [], []);
    expect(conflicts).toHaveLength(1);
    expect(window(conflicts[0]!)).toEqual(["04:00", "06:00"]);
    expect(conflicts[0]).toMatchObject({ demandIds: ["a", "b"], sourceIds: [], capacity: 0 });
  });
});
