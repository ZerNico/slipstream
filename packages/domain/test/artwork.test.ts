import { DateTime, Schema } from "effect";
import { describe, expect, it } from "vitest";
import {
  Artwork,
  artworkStyle,
  frameDue,
  frameMoment,
  resolveArtwork,
  titleSeed,
} from "../src/artwork.ts";
import { RecordingId } from "../src/ids.ts";
import { at, skyF1 } from "./test-support.ts";

const qualifying = {
  channelId: skyF1,
  title: "Live F1: Qualifying - GP Katar",
  categories: ["Sport"],
  start: at("2026-11-22T17:00:00Z"),
  end: at("2026-11-22T18:30:00Z"),
};
const frame = { recordingId: RecordingId.make("r-q"), grabbedAt: at("2026-11-22T17:10:00Z") };
const guideImage = "https://images.example.com/qualifying.jpg";

describe("artwork resolver", () => {
  it("prefers the guide image, then the frame, then generated artwork", () => {
    expect(resolveArtwork({ ...qualifying, imageUrl: guideImage, frame })).toEqual({
      _tag: "Guide",
      url: guideImage,
    });
    expect(resolveArtwork({ ...qualifying, frame })).toEqual({ _tag: "Frame", ...frame });
    const generated = resolveArtwork(qualifying);
    expect(generated).toEqual({
      _tag: "Generated",
      style: "sport",
      seed: titleSeed(qualifying.title),
      channelId: skyF1,
    });
  });

  it("follows the household's order when frames come first", () => {
    expect(
      resolveArtwork({ ...qualifying, imageUrl: guideImage, frame }, ["frame", "guide"])._tag,
    ).toBe("Frame");
    expect(resolveArtwork({ ...qualifying, imageUrl: guideImage }, ["frame", "guide"])._tag).toBe(
      "Guide",
    );
    expect(resolveArtwork({ ...qualifying, imageUrl: guideImage, frame }, [])._tag).toBe(
      "Generated",
    );
  });

  it("encodes every variant for the wire", () => {
    for (const artwork of [
      resolveArtwork({ ...qualifying, imageUrl: guideImage }),
      resolveArtwork({ ...qualifying, frame }),
      resolveArtwork(qualifying),
    ]) {
      const encoded = Schema.encodeSync(Artwork)(artwork);
      expect(Schema.decodeUnknownSync(Artwork)(encoded)).toEqual(artwork);
    }
  });
});

describe("generated artwork", () => {
  it("picks the style from guide categories, strongest first", () => {
    expect(artworkStyle(["Sport"])).toBe("sport");
    expect(artworkStyle(["Spielfilm", "Krimi"])).toBe("crime");
    expect(artworkStyle(["Spielfilm"])).toBe("film");
    expect(artworkStyle(["Kinder", "Zeichentrick"])).toBe("kids");
    expect(artworkStyle(["Nachrichten"])).toBe("news");
    expect(artworkStyle(["Dokumentation"])).toBe("docs");
    expect(artworkStyle(["Show"])).toBe("show");
    expect(artworkStyle([])).toBe("show");
    expect(artworkStyle([], "Live F1: Rennen - GP Katar")).toBe("sport");
    expect(artworkStyle([], "Tatort: Borowski")).toBe("crime");
    expect(artworkStyle(["Spielfilm"], "Tatort: Borowski")).toBe("film");
    expect(artworkStyle([], "Wer weiß denn sowas?")).toBe("show");
  });

  it("seeds from the title so one title always looks the same and sessions differ", () => {
    expect(titleSeed("Live F1: Rennen")).toBe(titleSeed("  live f1:  Rennen "));
    expect(titleSeed("Live F1: Rennen")).not.toBe(titleSeed("Live F1: Qualifying"));
    expect(Number.isInteger(titleSeed("x"))).toBe(true);
    expect(titleSeed("x")).toBeGreaterThanOrEqual(0);
  });
});

describe("frames", () => {
  it("grabs 10 minutes after the programme start, or the middle of short programmes", () => {
    expect(DateTime.formatIso(frameMoment(qualifying))).toBe("2026-11-22T17:10:00.000Z");
    const short = { start: at("2026-11-22T19:00:00Z"), end: at("2026-11-22T19:15:00Z") };
    expect(DateTime.formatIso(frameMoment(short))).toBe("2026-11-22T19:07:30.000Z");
  });

  it("is due once the capture passed the frame moment, running recordings included", () => {
    const running = { ...qualifying, state: "recording" as const };
    expect(frameDue(running, at("2026-11-22T17:09:00Z"))).toBe(false);
    expect(frameDue(running, at("2026-11-22T17:11:00Z"))).toBe(true);
    expect(frameDue(running, undefined)).toBe(false);
    expect(frameDue({ ...qualifying, state: "failed" }, at("2026-11-22T18:00:00Z"))).toBe(false);
    expect(frameDue({ ...qualifying, state: "scheduled" }, at("2026-11-22T18:00:00Z"))).toBe(false);
  });
});
