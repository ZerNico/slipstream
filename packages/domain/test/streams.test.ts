import { describe, expect, it } from "vitest";
import { streamHeadroom, watchingVerdict } from "../src/streams.ts";

/** tvproxy of SPEC 7.9: 4 streams, 2 kept for recordings. */
const tvproxy = { maxStreams: 4, keptForRecordings: 2 };

describe("stream headroom", () => {
  it("leaves two streams for watching while recordings use the kept ones", () => {
    expect(streamHeadroom({ ...tvproxy, recording: 2, watching: 1 })).toEqual({
      watchingCapacity: 2,
      freeForWatching: 1,
      freeForRecording: 2,
      atLimit: false,
    });
  });

  it("reports the limit when both halves are in use", () => {
    const full = streamHeadroom({ ...tvproxy, recording: 2, watching: 2 });
    expect(full.freeForWatching).toBe(0);
    expect(full.atLimit).toBe(true);
  });

  it("keeps streams for recordings even when none runs", () => {
    expect(streamHeadroom({ ...tvproxy, recording: 0, watching: 2 }).freeForWatching).toBe(0);
  });

  it("shrinks the watching half when more recordings run than are kept", () => {
    const headroom = streamHeadroom({ ...tvproxy, recording: 3, watching: 1 });
    expect(headroom.watchingCapacity).toBe(1);
    expect(headroom.freeForWatching).toBe(0);
    expect(headroom.freeForRecording).toBe(1);
  });

  it("never goes negative when more streams are kept than allowed", () => {
    expect(
      streamHeadroom({ maxStreams: 2, keptForRecordings: 5, recording: 0, watching: 0 }),
    ).toEqual({ watchingCapacity: 0, freeForWatching: 0, freeForRecording: 2, atLimit: false });
  });

  it("is unlimited without a limit", () => {
    expect(streamHeadroom({ keptForRecordings: 0, recording: 9, watching: 9 })).toEqual({
      watchingCapacity: undefined,
      freeForWatching: undefined,
      freeForRecording: undefined,
      atLimit: false,
    });
  });
});

describe("watching verdict", () => {
  it("lets a viewer in while a watching stream is free", () => {
    expect(watchingVerdict({ ...tvproxy, recording: 2, watching: 1 }, { watching: 0 })).toBe("ok");
  });

  it("names the full source", () => {
    expect(watchingVerdict({ ...tvproxy, recording: 2, watching: 2 }, { watching: 0 })).toBe(
      "sourceFull",
    );
  });

  it("names the profile's own limit first", () => {
    expect(
      watchingVerdict({ ...tvproxy, recording: 0, watching: 1 }, { limit: 1, watching: 1 }),
    ).toBe("profileLimit");
  });
});
