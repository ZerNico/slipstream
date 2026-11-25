import { assert, describe, it } from "@effect/vitest";
import { FfmpegRunner } from "@slipstream/recorder";
import { Effect } from "effect";
import { detectHardware } from "../src/system/hardware.ts";

describe("hardware detection with real ffmpeg", () => {
  it.effect("asks the real ffmpeg and keeps only encoders that test-encode", () =>
    Effect.map(detectHardware.pipe(Effect.provide(FfmpegRunner.layer)), (caps) => {
      for (const found of caps.encoders) {
        assert.isAbove(found.codecs.length, 0);
        assert.isAbove(found.rateControl.length, 0);
      }
    }),
  );
});
