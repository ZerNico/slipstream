import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { RecordingId, SourceId, UserId } from "@slipstream/domain";
import { applyServerEvent } from "./events.ts";
import { makeMockData } from "./mock/fixtures.ts";
import { keys } from "./queries.ts";

const data = makeMockData(Date.UTC(2026, 10, 22, 5));
const race = RecordingId.make("rennen-las-vegas");

const seeded = () => {
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
  client.setQueryData(keys.recordingList, data.recordings);
  client.setQueryData(keys.recording(race), data.recordings[0]);
  client.setQueryData(keys.sources, data.sources);
  client.setQueryData(keys.system, data.system);
  client.setQueryData(keys.guideWindow(0, 1), []);
  return client;
};

const stale = (client: QueryClient, key: readonly unknown[]) =>
  client.getQueryState(key)?.isInvalidated ?? false;

describe("applyServerEvent", () => {
  it("patches a recording's state at once and refetches what depends on it", () => {
    const client = seeded();
    applyServerEvent(client, { _tag: "RecordingChanged", recordingId: race, state: "completed" });
    const list = client.getQueryData<typeof data.recordings>(keys.recordingList);
    expect(list?.find((entry) => entry.id === race)?.state).toBe("completed");
    expect(list?.find((entry) => entry.id === "weekend-1")?.state).toBe("completed");
    expect(client.getQueryData<(typeof data.recordings)[number]>(keys.recording(race))?.state).toBe(
      "completed",
    );
    expect(stale(client, keys.recordingList)).toBe(true);
    expect(stale(client, keys.system)).toBe(true);
    expect(stale(client, keys.sources)).toBe(false);
  });

  it("drops a removed recording from the list and detail and refetches library and home", () => {
    const client = seeded();
    client.setQueryData(keys.continueWatching, []);
    client.setQueryData(keys.playbackState(race), null);
    client.setQueryData(keys.collections, []);
    applyServerEvent(client, {
      _tag: "RecordingRemoved",
      recordingId: race,
      ownerIds: [UserId.make("alex")],
    });
    const list = client.getQueryData<typeof data.recordings>(keys.recordingList);
    expect(list?.some((entry) => entry.id === race)).toBe(false);
    expect(list).toHaveLength(data.recordings.length - 1);
    expect(client.getQueryState(keys.recording(race))).toBeUndefined();
    expect(client.getQueryState(keys.playbackState(race))).toBeUndefined();
    expect(stale(client, keys.recordingList)).toBe(true);
    expect(stale(client, keys.collections)).toBe(true);
    expect(stale(client, keys.continueWatching)).toBe(true);
    expect(stale(client, keys.system)).toBe(true);
    expect(stale(client, keys.sources)).toBe(false);
  });

  it("drops a replaced recording and refetches series, collections and the guide's repeats", () => {
    const client = seeded();
    client.setQueryData(keys.ruleList, []);
    client.setQueryData(keys.collections, []);
    client.setQueryData(keys.guideRepeats(0, 1), []);
    applyServerEvent(client, {
      _tag: "RecordingReplaced",
      id: RecordingId.make("weekend-1"),
      replacedId: race,
    });
    const list = client.getQueryData<typeof data.recordings>(keys.recordingList);
    expect(list?.some((entry) => entry.id === race)).toBe(false);
    expect(stale(client, keys.recordingList)).toBe(true);
    expect(stale(client, keys.ruleList)).toBe(true);
    expect(stale(client, keys.collections)).toBe(true);
    expect(stale(client, keys.guideRepeats(0, 1))).toBe(true);
    expect(stale(client, keys.sources)).toBe(false);
  });

  it("patches source health", () => {
    const client = seeded();
    applyServerEvent(client, {
      _tag: "SourceHealthChanged",
      sourceId: SourceId.make("tvproxy"),
      health: "limitReached",
    });
    const sources = client.getQueryData<typeof data.sources>(keys.sources);
    expect(sources?.map((source) => source.health)).toEqual(["limitReached", "unreachable"]);
    expect(stale(client, keys.system)).toBe(true);
  });

  it("refetches the guide, rules and recordings when new guide data arrives", () => {
    const client = seeded();
    applyServerEvent(client, { _tag: "GuideRefreshed", sourceId: SourceId.make("tvproxy") });
    expect(stale(client, keys.guideWindow(0, 1))).toBe(true);
    expect(stale(client, keys.recordingList)).toBe(true);
    expect(stale(client, keys.sources)).toBe(false);
  });
});
