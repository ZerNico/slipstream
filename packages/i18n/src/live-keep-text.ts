import type { KeepRunning } from "@slipstream/domain";
import { m } from "./runtime.ts";

/**
 * The words for how long a channel keeps running after its last viewer left (Settings ›
 * Recording › Live TV): "10 min", "1 h", "Until the programme ends".
 */
export const keepRunningLabel = (keep: KeepRunning): string =>
  keep === "programmeEnd" ? m.rec_keep_programme_end() : m.rec_keep_duration({ minutes: keep });

/** The words for how long the rewind buffer stays after a channel stopped: "1 h", "Don’t keep". */
export const keepBufferLabel = (minutes: number): string =>
  minutes === 0 ? m.rec_keep_buffer_off() : m.rec_keep_duration({ minutes });
