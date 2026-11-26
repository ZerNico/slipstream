import type { Delivery, Encoder, TranscodeDecision } from "@slipstream/domain";
import { m } from "./runtime.ts";

/** Encoder names as their makers write them; not words to translate. */
const encoderNames: Readonly<Record<Encoder, string>> = {
  software: "x264",
  qsv: "Intel Quick Sync",
  vaapi: "VA-API",
  nvenc: "NVENC",
};

/**
 * How the server changes the stream on its way to the player: "Repackaged", "Sound converted",
 * "Converted". The player's details and its playback stats say it the same way.
 */
const decisionText = (decision: Exclude<TranscodeDecision, "direct">): string =>
  decision === "remux"
    ? m.player_decision_remux()
    : decision === "audio"
      ? m.player_decision_audio()
      : m.player_decision_video();

/**
 * The playback stats' Delivery row (`deliveryOf` a session's plan): "Direct", or how the stream
 * is changed, with the encoder when the picture is converted ("Converted · NVENC").
 */
export const deliveryText = (delivery: Pick<Delivery, "decision" | "encoder">): string => {
  if (delivery.decision === "direct") return m.player_stats_direct();
  const how = decisionText(delivery.decision);
  return delivery.encoder === undefined ? how : `${how} · ${encoderNames[delivery.encoder]}`;
};
