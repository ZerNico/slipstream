import { describe, expect, it } from "vitest";
import type { RecordingEntry, SourceStreams } from "@slipstream/api";
import { makeMockData } from "~/api/mock/fixtures.ts";
import { ChannelId, PlaybackSessionId, SourceId } from "@slipstream/domain";
import { DateTime } from "effect";
import { playerPosition } from "./player-model.ts";
import { readoutFor } from "./readout.ts";
import { sourceWatchers, watcherName } from "./streams.ts";
import {
  bandTitle,
  bandsIn,
  channelItems,
  recordingStart,
  siblingItems,
  slotLine,
} from "./watch-data.ts";

const MIN = 60_000;
const now = Date.UTC(2026, 10, 22, 17, 42);
const data = makeMockData(now);
const entry = (id: string): RecordingEntry => {
  const found = data.recordings.find((candidate) => candidate.id === id);
  if (!found) throw new Error(id);
  return found;
};

describe("readout", () => {
  const snapshot = (behind: number) => ({
    currentTime: 2820 - behind,
    seekableStart: 0,
    seekableEnd: 2820,
    liveSync: 2820,
    epochOffset: now - 2820 * 1000,
  });
  const subject = {
    mode: "running" as const,
    window: { start: now - 47 * MIN, end: now + 60 * MIN },
  };

  it("says how far behind live, with the broadcast time under it", () => {
    const readout = readoutFor({
      position: playerPosition(snapshot(1890), subject),
      mode: "running",
      speed: 1,
      now,
    });
    expect(readout.kind).toBe("behind");
    expect(readout.delta).toBe("−31:30");
    expect(readout.label).toBe("behind live");
    expect(readout.sub.map((part) => part[0]?.text)).toEqual(["playing"]);
  });

  it("adds the speed and when you reach live above 1×, inside the window", () => {
    const readout = readoutFor({
      position: playerPosition(snapshot(300), subject),
      mode: "running",
      speed: 1.25,
      now,
      windowEnd: subject.window.end,
    });
    expect(readout.sub.map((part) => part[0]?.text)).toEqual(["playing", "1.25×", "live at"]);
  });

  it("leaves out an ETA that falls after the window", () => {
    const readout = readoutFor({
      position: playerPosition(snapshot(1890), subject),
      mode: "running",
      speed: 1.25,
      now,
      windowEnd: subject.window.end,
    });
    expect(readout.sub.at(-1)?.[0]?.text).toBe("1.25×");
  });

  it("at live shows the LIVE pill and nothing to catch", () => {
    const readout = readoutFor({
      position: playerPosition(snapshot(1), subject),
      mode: "running",
      speed: 1,
      now,
    });
    expect(readout.kind).toBe("live");
    expect(readout.label).toBe("");
    expect(readout.sub).toEqual([]);
  });

  it("for a finished recording counts what is left and when it ends", () => {
    const readout = readoutFor({
      position: playerPosition(
        { currentTime: 901, seekableStart: 0, seekableEnd: 4500, liveSync: null, epochOffset: 0 },
        { mode: "finished", window: { start: 0, end: 75 * MIN } },
      ),
      mode: "finished",
      speed: 1,
      now,
      gapMinutes: 2,
    });
    expect(readout.kind).toBe("left");
    expect(readout.delta).toBe("59:59");
    expect(readout.sub[0]?.[0]?.text).toMatch(/^ends /u);
    expect(readout.sub.at(-1)?.[0]?.text).toBe("contains a 2 min gap");
  });
});

describe("the choice dialog's header", () => {
  it("names the day as the pills do, apart from the time, and never breaks inside either", () => {
    // 00:30 on Monday 23 November in Berlin, 23:30 on Sunday in UTC.
    const start = Date.UTC(2026, 10, 22, 23, 30);
    const line = slotLine("Sky Sport F1", start, start + 90 * MIN, {
      now,
      timeZone: "Europe/Berlin",
    });
    const parts = line.split(" · ");
    expect(parts).toHaveLength(3);
    expect(parts[0]).toBe("Sky Sport F1");
    expect(parts[1]).toBe("Mon 23");
    expect(parts[2]).not.toContain(" ");
  });
});

describe("watch data", () => {
  it("names bands without the series prefix and the event", () => {
    expect(bandTitle("Live F1: Qualifying - GP Katar")).toBe("Qualifying");
    expect(bandTitle("F1: Pressekonferenz Qualifying - GP Katar")).toBe(
      "Pressekonferenz Qualifying",
    );
    expect(bandTitle("Tagesschau")).toBe("Tagesschau");
  });

  it("starts where the search says, else at your position", () => {
    const race = entry("rennen-las-vegas");
    expect(recordingStart(race, { at: "live" }, true)).toEqual({ kind: "live" });
    expect(recordingStart(race, { at: "start" }, true)).toEqual({ kind: "start" });
    expect(recordingStart(race, { at: "pos", t: now - 10 * MIN }, true)).toEqual({
      kind: "clock",
      at: now - 10 * MIN,
    });
    const finished = { ...entry("weekend-3"), positionMillis: 41 * MIN };
    expect(recordingStart(finished, {}, false)).toEqual({ kind: "offset", seconds: 41 * 60 });
    expect(recordingStart(finished, { at: "pos", t: 46 * MIN }, false)).toEqual({
      kind: "offset",
      seconds: 46 * 60,
    });
    expect(recordingStart({ ...finished, positionMillis: 0 }, {}, false)).toEqual({
      kind: "start",
    });
  });

  it("lists the sessions of the weekend with the scheduled ones quieter", () => {
    const items = siblingItems(entry("weekend-3"), data.recordings, data.channels, () => {});
    expect(items.length).toBeGreaterThan(2);
    expect(items.find((item) => item.current)?.key).toBe("weekend-3");
    expect(items.some((item) => item.badge === "rec")).toBe(true);
  });

  it("has no siblings for a lone recording", () => {
    expect(siblingItems(entry("der-pate"), data.recordings, data.channels, () => {})).toEqual([]);
  });

  it("lists visible channels by number, the current one marked", () => {
    const items = channelItems(data.channels, [], ChannelId.make("zdf"), now);
    expect(items.map((item) => item.key)).not.toContain("teleshop-24");
    expect(items[0]?.key).toBe("sky-sport-f1");
    expect(items.find((item) => item.current)?.key).toBe("zdf");
  });

  it("draws bands for the channel's programmes inside the window only", () => {
    const bands = bandsIn(data.programmes, ChannelId.make("sky-sport-f1"), now - 60 * MIN, now);
    expect(bands.length).toBeGreaterThan(0);
    expect(bands.every((band) => band.end > now - 60 * MIN && band.start < now)).toBe(true);
  });
});

const at = (ms: number) => DateTime.makeUnsafe(ms);

describe("streams", () => {
  const sources: SourceStreams[] = [
    {
      sourceId: SourceId.make("tvproxy"),
      name: "tvproxy",
      counts: { maxStreams: 4, keptForRecordings: 2, recording: 1, watching: 2 },
      uses: [
        {
          _tag: "Watching",
          channelId: ChannelId.make("zdf"),
          playbackSessionId: PlaybackSessionId.make("a"),
          since: at(1),
          deviceName: "Pixel 9",
        },
        {
          _tag: "Watching",
          channelId: ChannelId.make("arte"),
          playbackSessionId: PlaybackSessionId.make("b"),
          since: at(2),
          deviceName: "Kitchen Shield",
        },
        {
          _tag: "Recording",
          channelId: ChannelId.make("sky-sport-f1"),
          recordingId: entry("rennen-las-vegas").id,
          since: at(0),
        },
      ],
    },
  ];

  it("names the viewers on the full source, newest first", () => {
    const watchers = sourceWatchers(sources, SourceId.make("tvproxy"));
    const names = watchers?.map((watcher) => watcherName(watcher, data.channels));
    expect(names).toEqual(["arte on Kitchen Shield", "ZDF on Pixel 9"]);
  });

  it("names nobody for an unknown or unlimited source", () => {
    expect(sourceWatchers(sources, SourceId.make("other"))).toBeUndefined();
  });
});
