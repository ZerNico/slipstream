import {
  Forbidden,
  InvalidInput,
  NotFound,
  PlaybackSessionRequest,
  RangeNotCaptured,
  StreamLimitReached,
} from "@slipstream/api";
import { type ChannelId, HOUR, MINUTE } from "@slipstream/domain";
import { DateTime, Effect, Exit, Schema } from "effect";
import { describe, expect, it } from "vitest";
import { recording } from "../../tests/fixtures.ts";
import {
  channelPlayTarget,
  isAuthRefusal,
  networkKindFor,
  parsePlayerParams,
  playerParams,
  positionForInstant,
  programmePlayTarget,
  samePlaylist,
  sessionFailure,
  sessionRequest,
  type PickedProgramme,
  type PlayTarget,
} from "./playback.ts";

describe("player params", () => {
  it("round-trips every target through route params", () => {
    const targets: PlayTarget[] = [
      { _tag: "Live", channelId: "f1" as never, from: "start" },
      { _tag: "Recording", recordingId: "r1" as never, from: "resume" },
      { _tag: "Range", channelId: "f1" as never, start: 1000, end: 2000, from: "start" },
    ];
    for (const target of targets) expect(parsePlayerParams(playerParams(target))).toEqual(target);
  });

  it("defaults the start point per kind and rejects incomplete params", () => {
    expect(parsePlayerParams({ kind: "live", channelId: "c" })?.from).toBe("live");
    expect(parsePlayerParams({ kind: "recording", recordingId: "r", from: "nonsense" })?.from).toBe(
      "resume",
    );
    expect(parsePlayerParams({ kind: "live" })).toBeUndefined();
    expect(
      parsePlayerParams({ kind: "range", channelId: "c", start: "5", end: "1" }),
    ).toBeUndefined();
    expect(parsePlayerParams({})).toBeUndefined();
  });
});

describe("samePlaylist", () => {
  it("tells a renewed token from another conversion of the stream", () => {
    const live = "https://tv.example/hls/live/ch1.m3u8?session=s&token=a";
    expect(samePlaylist(live, "https://tv.example/hls/live/ch1.m3u8?session=s&token=b")).toBe(true);
    expect(
      samePlaylist(live, "https://tv.example/hls/live/ch1/copy_aac-0-2-192.m3u8?session=s&token=b"),
    ).toBe(false);
  });
});

describe("sessionRequest", () => {
  it("builds a request the API accepts for a start-over range", () => {
    const request = sessionRequest({
      _tag: "Range",
      channelId: "f1" as never,
      start: Date.UTC(2026, 10, 22, 5),
      end: Date.UTC(2026, 10, 22, 7),
      from: "start",
    });
    const wire = Schema.encodeSync(PlaybackSessionRequest)(request);
    expect(wire.source).toEqual({
      _tag: "Range",
      channelId: "f1",
      range: { start: "2026-11-22T05:00:00.000Z", end: "2026-11-22T07:00:00.000Z" },
    });
    expect(wire.quality).toEqual({ _tag: "Auto" });
  });

  it("tells the server a live session starts behind the live edge", () => {
    const channelId = "f1" as never;
    const behind = sessionRequest({ _tag: "Live", channelId, from: "start" });
    expect(Schema.encodeSync(PlaybackSessionRequest)(behind).startsBehindLive).toBe(true);
    const atLive = sessionRequest({ _tag: "Live", channelId, from: "live" });
    expect(atLive.startsBehindLive).toBeUndefined();
  });
});

describe("positionForInstant", () => {
  const progress = { currentTime: 600, seekableDuration: 1800 };

  it("maps a wall-clock instant onto the playlist from its start time", () => {
    expect(positionForInstant(progress, 1_000_000, 1_000_000 + 300_000)).toBe(300);
  });

  it("clamps to the playlist and needs a known start", () => {
    expect(positionForInstant(progress, 1_000_000, 0)).toBe(0);
    expect(positionForInstant(progress, 1_000_000, 1_000_000 + 9_000_000)).toBe(1800);
    expect(positionForInstant(progress, undefined, 5)).toBeUndefined();
  });
});

describe("networkKindFor", () => {
  it("reports mobile data as mobile and everything else as the home network", () => {
    expect(networkKindFor("CELLULAR")).toBe("mobile");
    expect(networkKindFor("WIFI")).toBe("lan");
    expect(networkKindFor("ETHERNET")).toBe("lan");
    expect(networkKindFor(undefined)).toBe("lan");
  });

  it("goes into the session request", () => {
    const request = sessionRequest(
      { _tag: "Recording", recordingId: "r1" as never, from: "resume" },
      networkKindFor("CELLULAR"),
    );
    expect(Schema.encodeSync(PlaybackSessionRequest)(request).network).toBe("mobile");
  });
});

describe("what a pick plays", () => {
  const T = Date.UTC(2026, 10, 22, 20);
  const show: PickedProgramme = {
    programmeId: "p1" as never,
    channelId: "f1" as never,
    title: "Rennen",
    start: T,
    end: T + 2 * HOUR,
  };
  const of = (state: string, extra: { programmeId?: string; title?: string } = {}) =>
    recording({ id: `r-${state}`, channelId: "f1", start: T, end: T + 2 * HOUR, state, ...extra });

  it("opens a channel being recorded at the recording's live edge, else live", () => {
    const running = of("recording");
    expect(channelPlayTarget("f1" as never, [running], T + HOUR)).toEqual({
      _tag: "Recording",
      recordingId: "r-recording",
      from: "live",
    });
    expect(channelPlayTarget("f1" as never, [of("completed"), of("scheduled")], T)).toEqual({
      _tag: "Live",
      channelId: "f1",
      from: "live",
    });
    expect(channelPlayTarget("other" as never, [running], T)?._tag).toBe("Live");
  });

  it("plays an airing programme's running recording from its live edge", () => {
    expect(programmePlayTarget(show, [of("recording", { programmeId: "p1" })], T + HOUR)).toEqual({
      _tag: "Recording",
      recordingId: "r-recording",
      from: "live",
    });
  });

  it("resumes the recording of an ended programme, matched by airing too", () => {
    const done = of("completed", { title: "Rennen" });
    expect(programmePlayTarget(show, [done], T + 3 * HOUR)).toEqual({
      _tag: "Recording",
      recordingId: "r-completed",
      from: "resume",
    });
  });

  it("plays live, then the captured range, without a recording; nothing before it starts", () => {
    const other = of("completed", { programmeId: "p2", title: "Quali" });
    expect(programmePlayTarget(show, [other], T + MINUTE)).toEqual({
      _tag: "Live",
      channelId: "f1",
      from: "live",
    });
    expect(programmePlayTarget(show, [], T + 3 * HOUR)).toEqual({
      _tag: "Range",
      channelId: "f1",
      start: T,
      end: T + 2 * HOUR,
      from: "start",
    });
    expect(programmePlayTarget(show, [], T - MINUTE)).toBeUndefined();
  });

  it("counts a manual recording on the channel that covers the programme", () => {
    const manual = recording({
      id: "manual",
      channelId: "f1",
      start: T - HOUR,
      end: T + 3 * HOUR,
      state: "recording",
      title: "Sky Sport F1",
    });
    expect(programmePlayTarget(show, [manual], T + HOUR)?._tag).toBe("Recording");
  });
});

/** Runs `sessionFailure` over a failed session request. */
const refusal = (error: Parameters<typeof sessionFailure<never>>[0]) =>
  Effect.runSync(sessionFailure(error));

/** A Media3 bad-HTTP-status error as react-native-video reports it. */
const badStatus = (code: number) => ({
  errorCode: "22004",
  errorString: "ExoPlaybackException: ERROR_CODE_IO_BAD_HTTP_STATUS",
  errorException: "androidx.media3.exoplayer.ExoPlaybackException: Source error",
  errorStackTrace: `Caused by: androidx.media3.datasource.HttpDataSource$InvalidResponseCodeException: Response code: ${code}\n\tat ...`,
});

describe("sessionFailure", () => {
  it("keeps the reason of a stream limit and names the other refusals", () => {
    expect(refusal(Effect.fail(new StreamLimitReached({ reason: "profileLimit" })))).toEqual({
      _tag: "Refused",
      failure: { _tag: "StreamLimitReached", reason: "profileLimit" },
    });
    expect(refusal(Effect.fail(new StreamLimitReached({ reason: "sourceFull" })))).toEqual({
      _tag: "Refused",
      failure: { _tag: "StreamLimitReached", reason: "sourceFull" },
    });
    const range = {
      start: DateTime.makeUnsafe(Date.UTC(2026, 10, 22, 5)),
      end: DateTime.makeUnsafe(Date.UTC(2026, 10, 22, 7)),
    };
    expect(
      refusal(Effect.fail(new RangeNotCaptured({ channelId: "f1" as ChannelId, range }))),
    ).toEqual({ _tag: "Refused", failure: { _tag: "RangeNotCaptured" } });
    expect(refusal(Effect.fail(new Forbidden()))).toEqual({
      _tag: "Refused",
      failure: { _tag: "Forbidden" },
    });
    expect(refusal(Effect.fail(new NotFound({ entity: "channel", id: "f1" })))).toEqual({
      _tag: "Refused",
      failure: { _tag: "NotFound" },
    });
  });

  it("leaves every other error in the error channel", () => {
    const exit = Effect.runSyncExit(
      sessionFailure(Effect.fail(new InvalidInput({ problems: [] }))),
    );
    expect(Exit.isFailure(exit)).toBe(true);
  });
});

describe("isAuthRefusal", () => {
  it("recognises a 401 or 403 for the playlist or a segment", () => {
    expect(isAuthRefusal(badStatus(401))).toBe(true);
    expect(isAuthRefusal(badStatus(403))).toBe(true);
  });

  it("leaves other HTTP statuses and other errors alone", () => {
    expect(isAuthRefusal(badStatus(404))).toBe(false);
    expect(isAuthRefusal(badStatus(4030))).toBe(false);
    expect(isAuthRefusal({ errorCode: "24001", errorStackTrace: "Response code: 403" })).toBe(
      false,
    );
    expect(isAuthRefusal({})).toBe(false);
  });
});
