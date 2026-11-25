import type { PlaybackSession } from "@slipstream/api";
import { deviceQualityLabel, m, transcodeReasonText } from "@slipstream/i18n";
import type { DetailRow } from "./panel.tsx";
import type { PlayerMenuOption } from "./player-menu.tsx";
import {
  deliveryOf,
  qualityCapHeight,
  type QualityChoice,
  type TranscodeDecision,
} from "@slipstream/domain";
import { surroundAsStereo } from "./speed.ts";
import type { MediaTrack } from "./use-hls-playback.ts";

/*
 * The player's words that depend on data: track names, quality labels, the Details rows.
 */

/** "Stereo", "5.1 surround" or "Mono" for a track; surround reads Stereo while not at 1×. */
export const channelsLabel = (channels: number | undefined, speed: number): string | undefined => {
  if (channels === undefined) return undefined;
  if (surroundAsStereo(speed, channels)) return m.player_audio_stereo();
  if (channels > 2) return m.player_audio_surround();
  return channels === 1 ? m.player_audio_mono() : m.player_audio_stereo();
};

/** The audio menu's rows; a stream without declared tracks has the one it plays. */
export const audioOptions = (tracks: readonly MediaTrack[]): PlayerMenuOption[] =>
  tracks.length === 0
    ? [{ value: "0", label: m.player_audio_default() }]
    : tracks.map((track) => {
        const detail = channelsLabel(track.channels, 1);
        return {
          value: String(track.id),
          label: track.name || m.player_audio_default(),
          ...(detail ? { detail } : {}),
        };
      });

/** The short name of a quality choice, for the pill and the chip: "Default" for the household's. */
export const qualityShort = (choice: QualityChoice): string =>
  choice === "auto"
    ? m.player_quality_default_short()
    : choice === "original"
      ? m.quality_original()
      : m.player_quality_cap({ kbps: Number(choice) });

/**
 * A quality menu row with its second line: "Household default" says it follows the household's
 * default for this connection, a cap how tall the picture gets.
 */
export const qualityOption = (choice: QualityChoice): PlayerMenuOption => {
  if (choice === "auto") {
    return {
      value: choice,
      label: deviceQualityLabel(choice),
      detail: m.quality_server_default_detail(),
    };
  }
  const height = qualityCapHeight(choice);
  return {
    value: choice,
    label: qualityShort(choice),
    ...(height === undefined ? {} : { detail: m.player_quality_cap_detail({ height }) }),
  };
};

/**
 * How the server changes the stream on its way here: "Repackaged", "Converting the sound",
 * "Converting the picture". Details and the stats overlay say it the same way.
 */
export const decisionText = (decision: Exclude<TranscodeDecision, "direct">): string =>
  decision === "remux"
    ? m.player_decision_remux()
    : decision === "audio"
      ? m.player_decision_audio()
      : m.player_decision_video();

/**
 * The Info rows, as Infuse shows them: the picture and the sound, and only when the stream is
 * changed on its way to you, one line that says how and why.
 */
export const detailRows = (input: {
  readonly session: PlaybackSession | undefined;
  readonly audio: MediaTrack | undefined;
  readonly videoSize: { readonly width: number; readonly height: number } | undefined;
  readonly speed: number;
}): DetailRow[] => {
  const { session } = input;
  const { decision, reasons } = deliveryOf(session?.plan);
  const rows: DetailRow[] = [];
  if (input.videoSize) {
    rows.push({ label: m.player_details_video(), value: m.player_details_size(input.videoSize) });
  }
  const channels = channelsLabel(input.audio?.channels, input.speed);
  rows.push({
    label: m.player_details_audio(),
    value: [input.audio?.name || m.player_audio_default(), channels].filter(Boolean).join(" · "),
  });
  if (decision !== "direct") {
    const how = decisionText(decision);
    rows.push({
      label: m.player_details_playing(),
      value: reasons.length === 0 ? how : `${how} · ${transcodeReasonText(reasons)}`,
    });
  }
  return rows;
};
