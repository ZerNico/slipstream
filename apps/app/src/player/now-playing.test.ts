import type { ChannelId, RecordingId } from "@slipstream/domain";
import { formatters } from "@slipstream/i18n";
import { describe, expect, it } from "vitest";
import { programme } from "../../tests/fixtures.ts";
import { nowPlaying, playingSubject } from "./now-playing.ts";
import type { PlayTarget } from "./playback.ts";

const at = (hours: number, minutes: number) => Date.UTC(2026, 10, 22, hours, minutes);
const one = "one" as ChannelId;
const two = "two" as ChannelId;
const live: PlayTarget = { _tag: "Live", channelId: one, from: "live" };
const news = programme("news", one, at(19, 0), at(19, 15), "News");
const film = {
  ...programme("film", one, at(19, 15), at(21, 0), "Tatort"),
  subtitle: "Der Fall",
  episode: { season: 3, episode: 4 },
};
const elsewhere = programme("other", two, at(19, 0), at(21, 0), "Elsewhere");
const programmes = [film, elsewhere, news];
const slot = (start: number, end: number) => formatters().timeRange(new Date(start), new Date(end));

describe("playingSubject", () => {
  it("takes the programme at the playhead, not the one on air now", () => {
    expect(
      playingSubject({ target: live, atMs: at(20, 0), programmes, recording: undefined }),
    ).toBe(film);
    // Behind live, back in the news.
    expect(
      playingSubject({ target: live, atMs: at(19, 5), programmes, recording: undefined }),
    ).toBe(news);
  });

  it("reads a captured range from its channel, and has nothing where the guide is empty", () => {
    const range: PlayTarget = {
      _tag: "Range",
      channelId: two,
      start: at(19, 0),
      end: at(21, 0),
      from: "start",
    };
    expect(
      playingSubject({ target: range, atMs: at(19, 30), programmes, recording: undefined }),
    ).toBe(elsewhere);
    expect(
      playingSubject({ target: live, atMs: at(22, 0), programmes, recording: undefined }),
    ).toBeUndefined();
  });

  it("names a recording by itself", () => {
    const target: PlayTarget = { _tag: "Recording", recordingId: "r" as RecordingId, from: "live" };
    expect(playingSubject({ target, atMs: at(19, 5), programmes, recording: film })).toBe(film);
  });
});

describe("nowPlaying", () => {
  it("says the episode, the channel and the slot under the title", () => {
    expect(nowPlaying(film, "Das Erste")).toEqual({
      title: "Tatort",
      line: `Episode 4 · Der Fall · Das Erste · ${slot(at(19, 15), at(21, 0))}`,
    });
  });

  it("leaves out what it does not know", () => {
    expect(nowPlaying(news, undefined)).toEqual({
      title: "News",
      line: slot(at(19, 0), at(19, 15)),
    });
    expect(nowPlaying({ ...news, subtitle: "Late edition" }, "ZDF").line).toBe(
      `Late edition · ZDF · ${slot(at(19, 0), at(19, 15))}`,
    );
  });

  it("names the channel when the guide has nothing at the playhead", () => {
    expect(nowPlaying(undefined, "Das Erste")).toEqual({ title: "Das Erste", line: "" });
    expect(nowPlaying(undefined, undefined)).toEqual({ title: "", line: "" });
  });
});
