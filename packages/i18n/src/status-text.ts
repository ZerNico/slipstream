/**
 * Typed lookups for reasons the server reports as codes (messages/reasons.ts). Every key is written
 * out in full, so the dead-key scan sees each one used and a missing key fails the type check;
 * clients never build a key from a template string.
 */
import type { MessageKey } from "./catalogue.ts";
import { m } from "./runtime.ts";

/** Why no stream was free for watching: the `reason` of `StreamLimitReached` in @slipstream/api. */
export type StreamLimitReason = "sourceFull" | "profileLimit";

const streamLimitKeys = {
  sourceFull: { title: "stream_limit_sourceFull", body: "stream_limit_sourceFull_hint" },
  profileLimit: { title: "stream_limit_profileLimit", body: "stream_limit_profileLimit_hint" },
} as const satisfies Record<StreamLimitReason, { title: MessageKey; body: MessageKey }>;

/**
 * What a player says when no stream is free for watching, in the language in effect: a title
 * ("No free stream for watching") and the hint under it. The web adds the source's story
 * (who watches what) to the source-full body where it has it.
 */
export const streamLimitText = (
  reason: StreamLimitReason,
): { readonly title: string; readonly body: string } => {
  const keys = streamLimitKeys[reason];
  return { title: m[keys.title](), body: m[keys.body]() };
};

/** Why playback is converted: the `TranscodeReason` literals in @slipstream/domain. */
export type TranscodeReasonCode =
  | "containerUnsupported"
  | "audioCodecUnsupported"
  | "videoCodecUnsupported"
  | "resolutionTooHigh"
  | "interlaced"
  | "bandwidth"
  | "requestedQuality"
  | "catchUpPassthrough"
  | "mobileData";

const transcodeReasonKeys = {
  containerUnsupported: "transcode_reason_containerUnsupported",
  audioCodecUnsupported: "transcode_reason_audioCodecUnsupported",
  videoCodecUnsupported: "transcode_reason_videoCodecUnsupported",
  resolutionTooHigh: "transcode_reason_resolutionTooHigh",
  interlaced: "transcode_reason_interlaced",
  bandwidth: "transcode_reason_bandwidth",
  requestedQuality: "transcode_reason_requestedQuality",
  catchUpPassthrough: "transcode_reason_catchUpPassthrough",
  mobileData: "transcode_reason_mobileData",
} as const satisfies Record<TranscodeReasonCode, MessageKey>;

/**
 * Why a playback session is converted, as one sentence in the language in effect: "Converted
 * because: the picture is interlaced and surround sound can't be sped up". Each reason reads
 * `transcode_reason_<reason>`, and `player_converted_because` joins them as a list. Pass one
 * reason or every reason the session reports.
 */
export const transcodeReasonText = (
  reason: TranscodeReasonCode | readonly TranscodeReasonCode[],
): string => {
  const reasons: readonly TranscodeReasonCode[] = typeof reason === "string" ? [reason] : reason;
  return m.player_converted_because({
    reasons: reasons.map((code) => m[transcodeReasonKeys[code]]()),
  });
};
