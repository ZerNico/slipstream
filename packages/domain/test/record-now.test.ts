import { DateTime } from "effect";
import { describe, expect, it } from "vitest";
import { ChannelId, ProgrammeId } from "../src/ids.ts";
import { recordNowNote, recordNowState } from "../src/record-now.ts";
import type { RecordingState } from "../src/recording.ts";
import { MINUTE } from "../src/time.ts";

const at = (hours: number, minutes: number) => Date.UTC(2026, 10, 22, hours, minutes);
const instant = (ms: number) => DateTime.makeUnsafe(ms);
const one = ChannelId.make("one");
const two = ChannelId.make("two");

const programme = (id: string, channelId: ChannelId, from: number, to: number) => ({
  id: ProgrammeId.make(id),
  channelId,
  title: id,
  start: instant(from),
  end: instant(to),
});

const news = programme("News", one, at(19, 0), at(19, 15));
const film = programme("Film", one, at(19, 15), at(21, 0));
const other = programme("Other", two, at(19, 0), at(21, 0));

const recordingOf = (of: typeof film, state: RecordingState) => ({
  channelId: of.channelId,
  programmeId: of.id,
  title: of.title,
  start: of.start,
  end: of.end,
  state,
});

describe("recordNowState", () => {
  const base = {
    programmes: [other, news, film],
    channelId: one,
    nowMs: at(20, 0),
    recordings: [] as ReturnType<typeof recordingOf>[],
  };

  it("records the programme on air at the playhead, also behind live", () => {
    expect(recordNowState({ ...base, atMs: at(20, 0) })).toEqual({
      _tag: "Record",
      programme: film,
    });
    expect(recordNowState({ ...base, atMs: at(19, 20) })).toEqual({
      _tag: "Record",
      programme: film,
    });
  });

  it("has nothing to record in an ended programme or where the guide is empty", () => {
    expect(recordNowState({ ...base, atMs: at(19, 5) })._tag).toBe("Unavailable");
    expect(recordNowState({ ...base, atMs: at(22, 0) })._tag).toBe("Unavailable");
  });

  it("says Recording when a scheduled or running recording of the airing exists", () => {
    const running = recordingOf(film, "recording");
    expect(recordNowState({ ...base, atMs: at(20, 0), recordings: [running] })).toEqual({
      _tag: "Recording",
      programme: film,
      recording: running,
    });
    // A finished or failed one is no reason not to record it again.
    for (const state of ["failed", "completed"] as const) {
      expect(
        recordNowState({ ...base, atMs: at(20, 0), recordings: [recordingOf(film, state)] })._tag,
      ).toBe("Record");
    }
  });
});

describe("recordNowNote", () => {
  const recording = {
    start: instant(at(20, 15)),
    padding: { beforeMinutes: 2, afterMinutes: 10 },
  };

  it("starts at the programme less its extra time when the capture reaches back that far", () => {
    expect(
      recordNowNote({ recording, capturedFromMs: at(19, 0), pressedAtMs: at(20, 27) + 30_000 }),
    ).toEqual({ fromMs: at(20, 13), earlierMinutes: 14 });
  });

  it("starts where the capture starts when it began later", () => {
    expect(
      recordNowNote({ recording, capturedFromMs: at(20, 21), pressedAtMs: at(20, 33) }),
    ).toEqual({ fromMs: at(20, 21), earlierMinutes: 12 });
  });

  it("never starts after the press", () => {
    const note = recordNowNote({
      recording,
      capturedFromMs: at(20, 40),
      pressedAtMs: at(20, 40) - MINUTE / 2,
    });
    expect(note).toEqual({ fromMs: at(20, 40) - MINUTE / 2, earlierMinutes: 0 });
  });
});
