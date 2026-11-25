import { DateTime } from "effect";
import { describe, expect, it } from "vitest";
import { ChannelId, ProgrammeId, RecordingId } from "../src/ids.ts";
import { playTargetFor, renewalDelayMillis, renewalFloorMillis } from "../src/playback.ts";
import type { RecordingState } from "../src/recording.ts";
import { MINUTE } from "../src/time.ts";

const channelId = ChannelId.make("sky-sport-f1");
const otherChannel = ChannelId.make("sky-bundesliga");
const start = Date.UTC(2026, 10, 22, 17, 0);
const end = start + 90 * MINUTE;
const programme = {
  id: ProgrammeId.make("f1-race"),
  channelId,
  title: "Formel 1: Großer Preis von Las Vegas",
  start: DateTime.makeUnsafe(start),
  end: DateTime.makeUnsafe(end),
};
const during = start + 30 * MINUTE;
const after = start + 120 * MINUTE;

/** A recording of the programme by its guide id unless told otherwise. */
const recording = (
  id: string,
  state: RecordingState,
  fields: {
    readonly programmeId?: string | undefined;
    readonly channelId?: ChannelId;
    readonly title?: string;
    readonly start?: number;
    readonly end?: number;
  } = {},
) => {
  const programmeId = "programmeId" in fields ? fields.programmeId : programme.id;
  return {
    id: RecordingId.make(id),
    state,
    channelId: fields.channelId ?? channelId,
    title: fields.title ?? programme.title,
    start: DateTime.makeUnsafe(fields.start ?? start),
    end: DateTime.makeUnsafe(fields.end ?? end),
    ...(programmeId === undefined ? {} : { programmeId: ProgrammeId.make(programmeId) }),
  };
};

describe("playTargetFor, a programme picked", () => {
  it("prefers a running recording from its live edge", () => {
    expect(
      playTargetFor({
        channelId,
        programme,
        now: during,
        recordings: [recording("done", "completed"), recording("now", "recording")],
      }),
    ).toEqual({ _tag: "Recording", recordingId: "now", from: "live" });
  });

  it("resumes a finished or incomplete recording", () => {
    expect(
      playTargetFor({
        channelId,
        programme,
        now: after,
        recordings: [recording("x", "failed"), recording("part", "incomplete")],
      }),
    ).toEqual({ _tag: "Recording", recordingId: "part", from: "resume" });
  });

  it("still finds the recording when a guide refresh renamed the programme's id", () => {
    const renamed = recording("old-id", "completed", { programmeId: "f1-race-before-refresh" });
    expect(playTargetFor({ channelId, programme, now: after, recordings: [renamed] })).toEqual({
      _tag: "Recording",
      recordingId: "old-id",
      from: "resume",
    });
  });

  it("counts a manual recording on the channel that covers the programme", () => {
    const manual = recording("manual", "recording", {
      programmeId: undefined,
      title: "Sky Sport F1 HD",
      start: start - 10 * MINUTE,
      end: end + 10 * MINUTE,
    });
    expect(playTargetFor({ channelId, programme, now: during, recordings: [manual] })).toEqual({
      _tag: "Recording",
      recordingId: "manual",
      from: "live",
    });
  });

  it("ignores recordings of other airings", () => {
    const others = [
      recording("elsewhere", "completed", { channelId: otherChannel, programmeId: "other" }),
      recording("short", "recording", {
        programmeId: undefined,
        title: "Manual",
        start: start + MINUTE,
        end,
      }),
      recording("other-show", "completed", { programmeId: "news", title: "Nachrichten" }),
    ];
    expect(playTargetFor({ channelId, programme, now: during, recordings: others })).toEqual({
      _tag: "Live",
      channelId,
    });
  });

  it("plays live while the programme airs, the range once it ended, nothing before", () => {
    const none = [
      recording("x", "failed"),
      recording("y", "cancelled"),
      recording("z", "scheduled"),
    ];
    expect(playTargetFor({ channelId, programme, now: during, recordings: none })).toEqual({
      _tag: "Live",
      channelId,
    });
    expect(playTargetFor({ channelId, programme, now: after, recordings: none })).toEqual({
      _tag: "Range",
      channelId,
      range: { start: programme.start, end: programme.end },
    });
    expect(
      playTargetFor({ channelId, programme, now: start - MINUTE, recordings: [] }),
    ).toBeUndefined();
  });
});

describe("playTargetFor, a channel picked", () => {
  it("takes a recording running on that channel from its live edge", () => {
    expect(
      playTargetFor({
        channelId,
        now: during,
        recordings: [recording("done", "completed"), recording("now", "recording")],
      }),
    ).toEqual({ _tag: "Recording", recordingId: "now", from: "live" });
  });

  it("ignores other channels and finished recordings, and plays live", () => {
    const recordings = [
      recording("elsewhere", "recording", { channelId: otherChannel }),
      recording("done", "completed"),
    ];
    expect(playTargetFor({ channelId, now: during, recordings })).toEqual({
      _tag: "Live",
      channelId,
    });
  });
});

describe("renewalDelayMillis", () => {
  const now = Date.UTC(2026, 10, 23, 12, 0);

  it("waits until five minutes before the session expires", () => {
    expect(renewalDelayMillis(now + 60 * MINUTE, now)).toBe(55 * MINUTE);
  });

  it("renews after the floor when expiry is near, past or unknown", () => {
    expect(renewalDelayMillis(now + 5 * MINUTE, now)).toBe(renewalFloorMillis);
    expect(renewalDelayMillis(now + 5 * MINUTE + 1000, now)).toBe(renewalFloorMillis);
    expect(renewalDelayMillis(now - MINUTE, now)).toBe(renewalFloorMillis);
    expect(renewalDelayMillis(Number.NaN, now)).toBe(renewalFloorMillis);
  });
});
