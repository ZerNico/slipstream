import { describe, expect, it } from "vitest";
import { artworkFor, artworkTitle, artworkVars, mainLineStep } from "./generate.ts";

describe("artworkFor (SPEC §7.4)", () => {
  it("prefers the guide image, then a frame from the recording, then generated art", () => {
    const both = {
      title: "Tatort",
      guideImageUrl: "https://guide/i.jpg",
      frameUrl: "/frames/1.jpg",
    };
    expect(artworkFor(both)).toEqual({ kind: "guide", url: "https://guide/i.jpg" });
    expect(artworkFor({ title: "Tatort", frameUrl: "/frames/1.jpg", frameAt: 5 })).toEqual({
      kind: "frame",
      url: "/frames/1.jpg",
      grabbedAt: 5,
    });
    expect(artworkFor({ title: "Tatort" })).toEqual({ kind: "generated" });
  });

  it("never shows a frame for a failed recording", () => {
    expect(artworkFor({ title: "Tagesschau", frameUrl: "/f.jpg", failed: true })).toEqual({
      kind: "generated",
    });
  });
});

describe("artworkTitle", () => {
  it("sets F1 sessions like a poster: kicker, session, Grand Prix", () => {
    expect(artworkTitle("Live F1: Qualifying - GP Katar", "sport", "Film")).toEqual({
      kicker: "Live · F1",
      main: "Qualifying",
      sub: "GP Katar",
    });
    expect(artworkTitle("F1: Rennen (Wh.) - GP Katar (Wh.)", "sport", "Film")).toEqual({
      kicker: "F1",
      main: "Rennen",
      sub: "GP Katar",
    });
  });

  it("puts a series name over the episode and gives films their kicker", () => {
    expect(artworkTitle("Tatort: Borowski", "crime", "Film")).toEqual({
      kicker: "Tatort",
      main: "Borowski",
      sub: "",
    });
    expect(artworkTitle("Der Pate", "film", "Spielfilm")).toEqual({
      kicker: "Spielfilm",
      main: "Der Pate",
      sub: "",
    });
  });

  it("steps long main lines down", () => {
    expect(mainLineStep("Rennen")).toBe(0);
    expect(mainLineStep("Faszination Erde")).toBe(1);
    expect(mainLineStep("Borowski und der Schatten")).toBe(2);
  });
});

describe("artworkVars", () => {
  it("is stable per title", () => {
    const subject = { title: "Tatort: Borowski" };
    expect(artworkVars(subject, "crime")).toEqual(artworkVars(subject, "crime"));
  });

  it("varies the speed stripes across a row of F1 sessions, so no two look the same", () => {
    const sessions = [
      "Qualifying",
      "Rennen",
      "Sprint",
      "1. Freies Training",
      "Sprint-Qualifying",
    ].map((session) =>
      artworkVars({ title: `Live F1: ${session} - GP Katar`, channel: { mark: "F1" } }, "sport"),
    );
    const looks = new Set(sessions.map((vars) => `${vars["--ang"]}|${vars["--off"]}`));
    expect(looks.size).toBe(sessions.length);
    for (const vars of sessions) {
      const angle = Math.abs(Number.parseInt(vars["--ang"] ?? "0", 10));
      const offset = Number.parseInt(vars["--off"] ?? "0", 10);
      expect(angle).toBeGreaterThanOrEqual(30);
      expect(angle).toBeLessThanOrEqual(76);
      expect(offset).toBeGreaterThanOrEqual(18);
      expect(offset).toBeLessThanOrEqual(70);
    }
  });

  it("keeps kids colours moderately saturated, never fluorescent", () => {
    const vars = artworkVars({ title: "Die Sendung mit der Maus" }, "kids");
    expect(vars["--a1"]).toMatch(/58%/);
    expect(vars["--a2"]).toMatch(/50%/);
  });
});
