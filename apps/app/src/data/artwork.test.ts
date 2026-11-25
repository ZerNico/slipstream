import { ChannelId, RecordingId } from "@slipstream/domain";
import { DateTime } from "effect";
import { describe, expect, it } from "vitest";
import { pictureFor } from "./artwork.ts";

const channelId = ChannelId.make("ard");
const frame = {
  _tag: "Frame" as const,
  recordingId: RecordingId.make("r1"),
  grabbedAt: DateTime.makeUnsafe(Date.UTC(2026, 10, 22, 20)),
};

describe("pictureFor", () => {
  it("prefers the guide's image, then TMDB, then a frame", () => {
    expect(
      pictureFor({ channelId, imageUrl: "https://g/1.jpg", onlineImageUrl: "https://t/1.jpg" }),
    ).toEqual({ kind: "outside", uri: "https://g/1.jpg" });
    expect(pictureFor({ channelId, onlineImageUrl: "https://t/1.jpg", artwork: frame })).toEqual({
      kind: "outside",
      uri: "https://t/1.jpg",
    });
    expect(pictureFor({ channelId, artwork: frame })).toEqual({
      kind: "server",
      path: expect.stringMatching(/^\/api\/artwork\/frames\/r1\?v=\d+$/u),
    });
  });

  it("shows no frame of a failed recording, and nothing without a picture", () => {
    expect(pictureFor({ channelId, artwork: frame, state: "failed" })).toBeUndefined();
    expect(pictureFor({ channelId })).toBeUndefined();
  });
});
