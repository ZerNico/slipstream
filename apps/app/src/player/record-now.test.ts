import { type ChannelId, MINUTE, type RecordingId } from "@slipstream/domain";
import { describe, expect, it } from "vitest";
import { programme, recording } from "../../tests/fixtures.ts";
import type { PlayTarget } from "./playback.ts";
import {
  guideWindowAt,
  playerRecord,
  playheadAt,
  recordedText,
  recordingShown,
} from "./record-now.ts";

const at = (hours: number, minutes: number) => Date.UTC(2026, 10, 22, hours, minutes);
const one = "one" as ChannelId;
const live: PlayTarget = { _tag: "Live", channelId: one, from: "live" };
const news = programme("news", one, at(19, 0), at(19, 15), "News");
const film = programme("film", one, at(19, 15), at(21, 0), "Film");
const now = at(20, 0);

describe("guideWindowAt", () => {
  it("reaches back over the pause buffer and ahead, on the five minutes", () => {
    expect(guideWindowAt(at(20, 3))).toEqual({ from: at(16, 0), to: at(28, 0) });
    expect(guideWindowAt(at(20, 4) + 59_000)).toEqual(guideWindowAt(at(20, 0)));
  });

  it("moves on with the clock, so a long session still knows what airs now", () => {
    const later = at(20, 0) + 9 * 3_600_000;
    const window = guideWindowAt(later);
    expect(window.from).toBeLessThanOrEqual(later);
    expect(window.to).toBeGreaterThan(later + 3_600_000);
  });
});

describe("playheadAt", () => {
  it("counts live back from now, the buffer from its length", () => {
    const progress = { currentTime: 3000, seekableDuration: 3600 };
    expect(playheadAt(live, progress, now, undefined)).toEqual({
      atMs: now - 600_000,
      capturedFromMs: now - 3_600_000,
    });
  });

  it("counts a recording on from its padded start", () => {
    const target: PlayTarget = { _tag: "Recording", recordingId: "r" as RecordingId, from: "live" };
    const progress = { currentTime: 600, seekableDuration: 1200 };
    expect(playheadAt(target, progress, now, at(19, 13))).toEqual({
      atMs: at(19, 23),
      capturedFromMs: at(19, 13),
    });
  });

  it("is now until the stream reports a position", () => {
    expect(playheadAt(live, undefined, now, undefined)).toEqual({
      atMs: now,
      capturedFromMs: undefined,
    });
  });
});

describe("playerRecord", () => {
  const base = {
    target: live,
    mayRecord: true,
    playhead: { atMs: now, capturedFromMs: at(19, 0) },
    now,
    programmes: [news, film],
    recordings: [],
    playing: undefined,
  };

  it("records the programme at the playhead on a live channel", () => {
    expect(playerRecord(base)).toEqual({ kind: "record", programme: film });
  });

  it("shows nothing to a profile that may not record, or in an ended programme", () => {
    expect(playerRecord({ ...base, mayRecord: false })).toBeUndefined();
    expect(
      playerRecord({ ...base, playhead: { atMs: at(19, 5), capturedFromMs: undefined } }),
    ).toBeUndefined();
  });

  it("is recording once a running recording of the airing exists, and shows the chip", () => {
    const running = recording({
      id: "r1",
      channelId: one,
      programmeId: "film",
      title: "Film",
      start: at(19, 15),
      end: at(21, 0),
      state: "recording",
    });
    const record = playerRecord({ ...base, recordings: [running] });
    expect(record).toEqual({ kind: "recording", recording: running, programme: film });
    expect(recordingShown(record)).toBe(true);
  });

  it("offers Extend and Stop for the recording being played only while it runs", () => {
    const target: PlayTarget = {
      _tag: "Recording",
      recordingId: "r1" as RecordingId,
      from: "live",
    };
    const playing = recording({
      id: "r1",
      channelId: one,
      programmeId: "film",
      start: at(19, 15),
      end: at(21, 0),
      state: "recording",
    });
    expect(playerRecord({ ...base, target, playing })?.kind).toBe("recording");
    const done = { ...playing, state: "completed" as const };
    expect(playerRecord({ ...base, target, playing: done })).toBeUndefined();
  });
});

describe("recordedText", () => {
  it("says where the recording starts and how much came before the press", () => {
    const text = recordedText(
      "Film",
      { start: film.start, padding: { beforeMinutes: 2, afterMinutes: 10 } },
      { atMs: now, capturedFromMs: at(19, 0) },
      at(19, 27),
    );
    expect(text).toContain("Film");
    expect(text).toContain("14");
  });

  it("is only the start when the press came within a minute of it", () => {
    const text = recordedText(
      "Film",
      { start: film.start, padding: { beforeMinutes: 0, afterMinutes: 0 } },
      { atMs: now, capturedFromMs: at(19, 15) },
      at(19, 15) + MINUTE / 2,
    );
    expect(text).not.toContain("min");
  });
});
