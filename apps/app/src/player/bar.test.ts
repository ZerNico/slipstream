import type { ChannelId, RecordingId } from "@slipstream/domain";
import { readoutLine, setRegion, setTimeZone } from "@slipstream/i18n";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { programme, recording } from "../../tests/fixtures.ts";
import { barLabels, playerBar, readoutOf } from "./bar.ts";
import type { PlayTarget } from "./playback.ts";

const at = (hours: number, minutes: number) => Date.UTC(2026, 10, 22, hours, minutes);
const one = "one" as ChannelId;
const live: PlayTarget = { _tag: "Live", channelId: one, from: "live" };
const doc = programme("doc", one, at(16, 15), at(17, 0), "Tage, die die Welt erschütterten");
const nature = programme("nature", one, at(17, 0), at(18, 0), "Life Below Zero");
const other = programme("other", "two", at(16, 0), at(18, 0), "Elsewhere");
const programmes = [nature, other, doc];

beforeEach(() => {
  setTimeZone("UTC");
  setRegion("DE");
});
afterEach(() => {
  setTimeZone(undefined);
  setRegion(undefined);
});

describe("playerBar on live TV", () => {
  // An hour of pause buffer up to 17:30, the playhead ten minutes back.
  const now = at(17, 30);
  const bar = playerBar({
    target: live,
    progress: { currentTime: 3000, seekableDuration: 3600 },
    now,
    recording: undefined,
    running: true,
    programmes,
    at: 3000,
  });

  it("runs from the oldest buffered second to the end of what is on at the live edge", () => {
    expect(bar.data.start).toBe(at(16, 30));
    expect(bar.data.end).toBe(at(18, 0));
    expect(bar.data.live).toBe(now);
    expect(bar.data.playhead).toBe(at(17, 20));
    expect(bar.relative).toBe(false);
  });

  it("names the channel's programmes and ticks where one ends and the next begins", () => {
    expect(bar.layout.bands.map((band) => band.title)).toEqual([
      "Tage, die die Welt erschütterten",
      "Life Below Zero",
    ]);
    expect(bar.layout.bands.map((band) => band.current)).toEqual([false, true]);
    // 17:00 is a third of the way along 16:30 to 18:00; the outer ends are the bar's.
    expect(bar.layout.marks).toHaveLength(1);
    expect(bar.layout.marks[0]).toBeCloseTo(100 / 3);
  });

  it("maps playlist seconds onto the bar and back, never past live", () => {
    expect(bar.share(0)).toBe(0);
    expect(bar.share(3600)).toBeCloseTo(2 / 3);
    expect(bar.seekAt(1 / 3)).toBeCloseTo(1800);
    expect(bar.seekAt(1)).toBe(3600);
    expect(bar.seekAt(0)).toBe(0);
  });

  it("labels the bar's ends and your time on the wall clock, and the live edge while behind", () => {
    const labels = barLabels(bar, false, 900, 12);
    expect(labels.start.text).toBe("16:30");
    expect(labels.end.text).toBe("18:00");
    expect(labels.here?.text).toBe("17:20");
    expect(labels.live?.text).toBe("LIVE 17:30");
    expect(barLabels(bar, true, 900, 12).live).toBeUndefined();
  });

  it("keeps the band row empty until the guide answers", () => {
    const early = playerBar({
      target: live,
      progress: { currentTime: 3000, seekableDuration: 3600 },
      now,
      recording: undefined,
      running: true,
      programmes: [],
      at: 3000,
    });
    expect(early.layout.bands).toEqual([]);
    expect(early.data.end).toBe(now);
  });
});

describe("playerBar for a recording", () => {
  const entry = recording({
    id: "rec",
    channelId: one,
    start: at(16, 15),
    end: at(17, 0),
    title: "Doku: Tage, die die Welt erschütterten - Folge 3",
    beforeMinutes: 5,
    afterMinutes: 10,
    state: "completed",
  });
  const target: PlayTarget = {
    _tag: "Recording",
    recordingId: "rec" as RecordingId,
    from: "resume",
  };

  it("is its own band, counted from 0:00, with the guide's neighbours in the extra time", () => {
    const bar = playerBar({
      target,
      progress: { currentTime: 600, seekableDuration: 3600 },
      now: at(20, 0),
      recording: entry,
      running: false,
      programmes,
      at: 600,
    });
    expect(bar.relative).toBe(true);
    expect(bar.data.start).toBe(at(16, 10));
    expect(bar.data.end).toBe(at(17, 10));
    expect(bar.data.live).toBeUndefined();
    expect(bar.layout.bands.map((band) => band.title)).toEqual([
      "Tage, die die Welt erschütterten",
      "Life Below Zero",
    ]);
    const labels = barLabels(bar, false, 900, 12);
    expect(labels.start.text).toBe("0:00");
    expect(labels.end.text).toBe("1:00:00");
    expect(labels.here?.text).toBe("10:00");
    expect(labels.live).toBeUndefined();
  });

  it("shows its own title when the guide no longer has it", () => {
    const bar = playerBar({
      target,
      progress: { currentTime: 0, seekableDuration: 3600 },
      now: at(20, 0),
      recording: entry,
      running: false,
      programmes: [],
      at: 0,
    });
    expect(bar.layout.bands).toHaveLength(1);
    expect(bar.layout.bands[0]?.title).toBe("Tage, die die Welt erschütterten");
    // The programme's start and end inside the extra time.
    expect(bar.layout.marks).toHaveLength(2);
  });

  it("spans the whole window while it records, captured up to live", () => {
    const running = recording({
      id: "rec",
      channelId: one,
      start: at(17, 0),
      end: at(18, 0),
      title: "Life Below Zero",
      state: "recording",
    });
    const bar = playerBar({
      target,
      progress: { currentTime: 1200, seekableDuration: 1800 },
      now: at(17, 30),
      recording: running,
      running: true,
      programmes,
      at: 1200,
    });
    expect(bar.data.start).toBe(at(17, 0));
    expect(bar.data.end).toBe(at(18, 0));
    expect(bar.data.live).toBe(at(17, 30));
    expect(bar.share(1800)).toBeCloseTo(0.5);
    expect(bar.seekAt(0.9)).toBe(1800);
  });
});

describe("readoutOf", () => {
  it("says what is left of a finished recording, when it ends and the gap it has", () => {
    const incomplete = recording({
      id: "rec",
      channelId: one,
      start: at(16, 0),
      end: at(17, 0),
      state: "incomplete",
      gaps: [[at(16, 20), at(16, 35)]],
    });
    const readout = readoutOf({
      finished: true,
      progress: { currentTime: 115, seekableDuration: 3600 },
      atLive: false,
      speed: 1,
      now: at(16, 28),
      playhead: at(16, 2),
      windowEnd: undefined,
      recording: incomplete,
    });
    expect(readout?.delta).toBe("58:05");
    expect(readout === undefined ? "" : readoutLine(readout)).toBe(
      "ends 17:26 · contains a 15 min gap",
    );
  });

  it("says how far behind live, and nothing before playback reports", () => {
    const readout = readoutOf({
      finished: false,
      progress: { currentTime: 1710, seekableDuration: 3600 },
      atLive: false,
      speed: 1,
      now: at(17, 30),
      playhead: at(16, 58) + 30_000,
      windowEnd: undefined,
      recording: undefined,
    });
    expect(readout?.kind).toBe("behind");
    expect(readout?.delta).toBe("−31:30");
    expect(
      readoutOf({
        finished: false,
        progress: undefined,
        atLive: true,
        speed: 1,
        now: 0,
        playhead: 0,
        windowEnd: undefined,
        recording: undefined,
      }),
    ).toBeUndefined();
  });
});
