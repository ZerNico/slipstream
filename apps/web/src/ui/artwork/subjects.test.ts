import { DateTime } from "effect";
import { describe, expect, it } from "vitest";
import { frameUrl } from "@slipstream/api";
import { ChannelId, RecordingId } from "@slipstream/domain";
import { artworkFor } from "./generate.ts";
import { programmeSubject, recordingSubject } from "./subjects.ts";

const grabbedAt = DateTime.makeUnsafe(Date.UTC(2026, 10, 22, 17, 10));
const sibling = RecordingId.make("rennen-other-capture");
const frame = { _tag: "Frame" as const, recordingId: sibling, grabbedAt };
const skyF1 = { name: "Sky Sport F1 HD", logoUrl: "https://logos.example/skyf1.png" };
const arte = { name: "arte" };

describe("artwork subjects (SPEC §7.4)", () => {
  it("points a recording's frame at the capture the frame came from, with its moment", () => {
    const subject = recordingSubject(
      { title: "Rennen", categories: ["Sport"], artwork: frame, state: "completed" },
      skyF1,
    );
    expect(subject.frameUrl).toBe(frameUrl(sibling, grabbedAt));
    expect(subject.frameAt).toBe(Date.UTC(2026, 10, 22, 17, 10));
    expect(artworkFor(subject)).toMatchObject({ kind: "frame" });
  });

  it("puts the channel's logo in the corner when it has one, else its mark", () => {
    expect(
      recordingSubject(
        { title: "Rennen", categories: [], artwork: frame, state: "recording" },
        skyF1,
      ).channel,
    ).toEqual({ mark: "F1", logoUrl: skyF1.logoUrl });
    expect(programmeSubject({ title: "Terra X", categories: [] }, arte).channel).toEqual({
      mark: "arte",
    });
  });

  it("gives a programme the picture of its recording when the guide has none", () => {
    const withFrame = programmeSubject({ title: "Rennen", categories: [] }, skyF1, {
      artwork: frame,
      state: "recording",
    });
    expect(withFrame.title).toBe("Rennen");
    expect(artworkFor(withFrame)).toMatchObject({ kind: "frame" });
    const guide = programmeSubject(
      { title: "Rennen", categories: [], imageUrl: "https://guide.example/rennen.jpg" },
      skyF1,
      { artwork: frame, state: "recording" },
    );
    expect(artworkFor(guide)).toEqual({ kind: "guide", url: "https://guide.example/rennen.jpg" });
  });

  it("never shows a failed recording's frame", () => {
    const failed = recordingSubject(
      { title: "Tagesschau", categories: [], artwork: frame, state: "failed" },
      arte,
    );
    expect(artworkFor(failed)).toEqual({ kind: "generated" });
  });

  it("draws generated art in the style the server resolved", () => {
    const generated = {
      _tag: "Generated" as const,
      style: "film" as const,
      seed: 7,
      channelId: ChannelId.make("arte"),
    };
    const subject = recordingSubject(
      { title: "Tagesschau", categories: ["Nachrichten"], artwork: generated, state: "completed" },
      arte,
    );
    expect(subject.style).toBe("film");
    expect(
      recordingSubject({ title: "Tagesschau", categories: [], state: "completed" }, arte),
    ).not.toHaveProperty("style");
  });
});
