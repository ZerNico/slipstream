import { describe, expect, it } from "@effect/vitest";
import { Effect, Exit, Fiber, Stream } from "effect";
import { TestClock } from "effect/testing";
import { QueryClient } from "@tanstack/react-query";
import {
  applyCacheUpdate,
  cacheUpdateFor,
  eventStreamOnce,
  invalidationsFor,
  liveCacheUpdates,
  parseServerEvent,
  serverEvents,
  TokenRevoked,
  type SseHandlers,
  type SseTransport,
} from "./events.ts";
import { queryKeys } from "./keys.ts";

/** A transport whose requests the test drives by hand. */
const fakeTransport = () => {
  const opened: {
    url: string;
    headers: Readonly<Record<string, string>>;
    handlers: SseHandlers;
  }[] = [];
  let aborted = 0;
  const transport: SseTransport = {
    open: (request, handlers) => {
      opened.push({ ...request, handlers });
      return () => {
        aborted += 1;
      };
    },
  };
  return { transport, opened, aborts: () => aborted };
};

const connection = { baseUrl: "http://tv.local", token: "t0k3n" };
const connected = '{"_tag":"Connected","at":"2026-11-21T20:00:00.000Z"}';
const recordingChanged = '{"_tag":"RecordingChanged","recordingId":"r1","state":"recording"}';

describe("parseServerEvent", () => {
  it("decodes known events and skips unknown ones", () => {
    expect(parseServerEvent(recordingChanged)).toEqual({
      _tag: "RecordingChanged",
      recordingId: "r1",
      state: "recording",
    });
    expect(parseServerEvent('{"_tag":"SomethingNew"}')).toBeUndefined();
    expect(parseServerEvent("not json")).toBeUndefined();
  });
});

describe("invalidationsFor", () => {
  it("marks the queries an event changes as stale", () => {
    expect(invalidationsFor({ _tag: "GuideRefreshed", sourceId: "s" as never }, false)).toEqual([
      queryKeys.guideAll,
    ]);
    const changed = invalidationsFor(
      { _tag: "RecordingChanged", recordingId: "r" as never, state: "completed" },
      false,
    );
    expect(changed).toContain(queryKeys.recordingsAll);
    expect(changed).toContain(queryKeys.recordOptionsAll);
  });

  it("refreshes the library and the guide's repeat marks when a repeat replaced a recording", () => {
    const event = parseServerEvent(
      '{"_tag":"RecordingReplaced","id":"tatort-one","replacedId":"tatort-erste"}',
    );
    expect(event?._tag).toBe("RecordingReplaced");
    if (event === undefined) return;
    const update = cacheUpdateFor(event, false);
    expect(update?.replaced).toBe("tatort-one");
    expect(update?.removed).toBeUndefined();
    for (const key of [
      queryKeys.recordingsAll,
      queryKeys.recordOptionsAll,
      queryKeys.continueWatching,
      queryKeys.guideRepeatsAll,
    ]) {
      expect(update?.invalidate).toContain(key);
    }
  });

  it("marks everything live as stale after a reconnect, nothing on the first connection", () => {
    const event = parseServerEvent(connected);
    expect(event?._tag).toBe("Connected");
    if (event === undefined) return;
    expect(invalidationsFor(event, false)).toEqual([]);
    const keys = invalidationsFor(event, true);
    for (const key of [
      queryKeys.recordingsAll,
      queryKeys.conflictsAll,
      queryKeys.continueWatching,
      queryKeys.guideAll,
    ]) {
      expect(keys).toContain(key);
    }
  });
});

describe("eventStreamOnce", () => {
  it.effect("opens /api/events with the token and emits decoded events", () =>
    Effect.gen(function* () {
      const fake = fakeTransport();
      const fiber = yield* eventStreamOnce(fake.transport, connection).pipe(
        Stream.take(2),
        Stream.runCollect,
        Effect.forkChild,
      );
      yield* Effect.yieldNow;
      const request = fake.opened[0];
      expect(request?.url).toBe("http://tv.local/api/events");
      expect(request?.headers.authorization).toBe("Bearer t0k3n");
      request?.handlers.onChunk(`: hi\n\ndata: ${recordingChanged}\n\ndata: {"_tag":"Gu`);
      request?.handlers.onChunk('ideRefreshed","sourceId":"s1"}\n\n');
      const events = yield* Fiber.join(fiber);
      expect(events.map((event) => event._tag)).toEqual(["RecordingChanged", "GuideRefreshed"]);
      expect(fake.aborts()).toBe(1);
    }),
  );

  it.effect("fails with TokenRevoked on 401 and does not reconnect", () =>
    Effect.gen(function* () {
      const fake = fakeTransport();
      const fiber = yield* serverEvents(fake.transport, connection).pipe(
        Stream.runCollect,
        Effect.forkChild,
      );
      yield* Effect.yieldNow;
      fake.opened[0]?.handlers.onError(401);
      const exit = yield* Fiber.await(fiber);
      expect(exit).toEqual(Exit.fail(new TokenRevoked()));
      yield* TestClock.adjust("1 minute");
      expect(fake.opened).toHaveLength(1);
    }),
  );
});

describe("serverEvents", () => {
  it.effect("reconnects with backoff after a drop", () =>
    Effect.gen(function* () {
      const fake = fakeTransport();
      const fiber = yield* serverEvents(fake.transport, connection).pipe(
        Stream.take(1),
        Stream.runCollect,
        Effect.forkChild,
      );
      yield* Effect.yieldNow;
      fake.opened[0]?.handlers.onError(503);
      yield* Effect.yieldNow;
      expect(fake.opened).toHaveLength(1);
      // The first retry waits about a second (jittered between 0.8 and 1.2 s).
      yield* TestClock.adjust("1500 millis");
      expect(fake.opened).toHaveLength(2);
      fake.opened[1]?.handlers.onChunk(`data: ${connected}\n\n`);
      const events = yield* Fiber.join(fiber);
      expect(events.map((event) => event._tag)).toEqual(["Connected"]);
    }),
  );
});

describe("liveCacheUpdates", () => {
  it.effect("refreshes everything on a reconnect but not on the first connection", () =>
    Effect.gen(function* () {
      const fake = fakeTransport();
      const fiber = yield* liveCacheUpdates(fake.transport, connection).pipe(
        Stream.take(2),
        Stream.runCollect,
        Effect.forkChild,
      );
      yield* Effect.yieldNow;
      fake.opened[0]?.handlers.onChunk(`data: ${connected}\n\ndata: ${recordingChanged}\n\n`);
      fake.opened[0]?.handlers.onError(503);
      yield* TestClock.adjust("1500 millis");
      fake.opened[1]?.handlers.onChunk(`data: ${connected}\n\n`);
      const [first, second] = yield* Fiber.join(fiber);
      expect(first?.invalidate).toContain(queryKeys.recordingsAll);
      expect(first?.invalidate).not.toContain(queryKeys.guideAll);
      expect(second?.invalidate).toContain(queryKeys.guideAll);
      expect(second?.invalidate).toContain(queryKeys.channels);
    }),
  );
});

describe("RecordingRemoved", () => {
  const removed = parseServerEvent(
    '{"_tag":"RecordingRemoved","recordingId":"r1","ownerIds":["u1"]}',
  );

  it("names the recording to drop and refreshes the library and Home", () => {
    expect(removed?._tag).toBe("RecordingRemoved");
    if (removed === undefined) return;
    const update = cacheUpdateFor(removed, false);
    expect(update?.removed).toBe("r1");
    expect(update?.invalidate).toContain(queryKeys.recordingsAll);
    expect(update?.invalidate).toContain(queryKeys.continueWatching);
  });

  it("drops the recording from every cached list and its own entry", async () => {
    if (removed === undefined) return;
    const update = cacheUpdateFor(removed, false);
    if (update === undefined) return;
    const client = new QueryClient();
    const entries = [{ id: "r1" }, { id: "r2" }];
    client.setQueryData(queryKeys.recordings, entries);
    client.setQueryData(queryKeys.recording("r1"), entries[0]);
    client.setQueryData(queryKeys.recording("r2"), entries[1]);
    await applyCacheUpdate(client, update);
    expect(client.getQueryData(queryKeys.recordings)).toEqual([{ id: "r2" }]);
    expect(client.getQueryData(queryKeys.recording("r1"))).toBeUndefined();
    expect(client.getQueryData(queryKeys.recording("r2"))).toEqual({ id: "r2" });
    expect(client.getQueryState(queryKeys.recordings)?.isInvalidated).toBe(true);
    client.clear();
  });
});
