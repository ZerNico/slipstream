/**
 * Messages for reasons the server reports as keys, never prose. English is the source; German
 * follows each key:
 *
 * - `source_failed_too_large`: the `tooLarge` reason of the `SourceFailed` error.
 * - `transcode_reason_<reason>`: one per `TranscodeReason` in @slipstream/domain. Short phrases
 *   that complete `player_converted_because`; clients read them through `transcodeReasonText`.
 * - `artwork_source_<source>`, `account_kind_<kind>`, `invite_expiry_<expiry>`: one per
 *   `ArtworkSource`, `AccountKind` and `InviteExpiry` literal in @slipstream/domain.
 * - `profile_locked_<requires>`, `invite_invalid_<reason>`, `stream_limit_<reason>`: one per
 *   literal of the `ProfileLocked`, `InviteInvalid` and `StreamLimitReached` errors in
 *   @slipstream/api. `stream_limit_<reason>` is a title with `stream_limit_<reason>_hint` under
 *   it; clients read both through `streamLimitText`.
 * - `playback_not_captured`: the `RangeNotCaptured` error of @slipstream/api.
 */
import type { Formatters } from "../src/format.ts";
import { defineArea } from "./area.ts";

type F = Formatters;

/** The reasons area of the catalogue. */
export const reasons = defineArea({
  en: {
    // Why a source refresh failed
    source_failed_too_large: "The playlist or guide is larger than Slipstream accepts.",

    // Why playback is converted
    player_converted_because: (p: { reasons: readonly string[] }, f: F) =>
      `Converted because: ${f.list(p.reasons)}`,
    transcode_reason_containerUnsupported: "this device can't open the file format",
    transcode_reason_audioCodecUnsupported: "this device can't play the sound format",
    transcode_reason_videoCodecUnsupported: "this device can't play the video format",
    transcode_reason_resolutionTooHigh: "the picture is too large for this device",
    transcode_reason_interlaced: "the picture is interlaced",
    transcode_reason_bandwidth: "the connection is too slow",
    transcode_reason_requestedQuality: "you picked a lower quality",
    transcode_reason_catchUpPassthrough: "surround sound can't be sped up",
    transcode_reason_mobileData: "mobile data",

    // Where a picture comes from: the artwork's source badge
    artwork_source_guide: "Image from the guide",
    artwork_source_online: "Image from TMDB",
    artwork_source_frame: "Frame from the recording",
    artwork_source_generated: "Generated artwork",

    // Profiles and guests
    account_kind_household: "Member",
    account_kind_guest: "Guest",
    profile_locked_pin: "Enter the PIN for this profile.",
    profile_locked_password: "Enter the password for this profile.",
    invite_expiry_oneDay: "In 24 hours",
    invite_expiry_sevenDays: "In 7 days",
    invite_expiry_untilUsed: "After first use",
    invite_invalid_expired: "This invite has expired. Ask for a new link.",
    invite_invalid_used: "This invite was already used. Ask for a new link.",
    invite_invalid_revoked: "This invite was withdrawn. Ask for a new link.",

    // No free stream for watching: a title and the hint under it
    stream_limit_sourceFull: "No free stream for watching",
    stream_limit_sourceFull_hint:
      "Every stream the source allows is in use. Try again when one is free.",
    stream_limit_profileLimit: "Your profile's streams are all in use",
    stream_limit_profileLimit_hint:
      "Your profile may watch only so many streams at once. Stop one on another device, then try again.",

    // A range session the timeshift buffer no longer holds (`RangeNotCaptured`)
    playback_not_captured: "This programme is no longer in pause & rewind.",
  },
  de: {
    // Why a source refresh failed
    source_failed_too_large:
      "Die Playlist oder die Programmdaten sind größer, als Slipstream annimmt.",

    // Why playback is converted
    player_converted_because: (p, f) => `Umgewandelt, weil: ${f.list(p.reasons)}`,
    transcode_reason_containerUnsupported: "dieses Gerät das Dateiformat nicht öffnen kann",
    transcode_reason_audioCodecUnsupported: "dieses Gerät das Tonformat nicht abspielen kann",
    transcode_reason_videoCodecUnsupported: "dieses Gerät das Videoformat nicht abspielen kann",
    transcode_reason_resolutionTooHigh: "das Bild für dieses Gerät zu groß ist",
    transcode_reason_interlaced: "das Bild im Zeilensprungverfahren kommt",
    transcode_reason_bandwidth: "die Verbindung zu langsam ist",
    transcode_reason_requestedQuality: "du eine niedrigere Qualität gewählt hast",
    transcode_reason_catchUpPassthrough: "Surround-Ton sich nicht beschleunigen lässt",
    transcode_reason_mobileData: "mobile Daten genutzt werden",

    // Where a picture comes from: the artwork's source badge
    artwork_source_guide: "Bild aus den Programmdaten",
    artwork_source_online: "Bild von TMDB",
    artwork_source_frame: "Standbild aus der Aufnahme",
    artwork_source_generated: "Erzeugtes Bild",

    // Profiles and guests
    account_kind_household: "Mitglied",
    account_kind_guest: "Gast",
    profile_locked_pin: "Gib die PIN für dieses Profil ein.",
    profile_locked_password: "Gib das Passwort für dieses Profil ein.",
    invite_expiry_oneDay: "In 24 Stunden",
    invite_expiry_sevenDays: "In 7 Tagen",
    invite_expiry_untilUsed: "Nach der ersten Nutzung",
    invite_invalid_expired: "Diese Einladung ist abgelaufen. Bitte um einen neuen Link.",
    invite_invalid_used: "Diese Einladung wurde schon genutzt. Bitte um einen neuen Link.",
    invite_invalid_revoked: "Diese Einladung wurde widerrufen. Bitte um einen neuen Link.",

    // No free stream for watching: a title and the hint under it
    stream_limit_sourceFull: "Kein Stream zum Schauen frei",
    stream_limit_sourceFull_hint:
      "Alle Streams, die die Quelle erlaubt, sind belegt. Versuch es noch einmal, wenn einer frei ist.",
    stream_limit_profileLimit: "Alle Streams deines Profils sind belegt",
    stream_limit_profileLimit_hint:
      "Dein Profil darf nur begrenzt viele Streams gleichzeitig schauen. Beende einen auf einem anderen Gerät und versuch es noch einmal.",

    // A range session the timeshift buffer no longer holds (`RangeNotCaptured`)
    playback_not_captured:
      "Diese Sendung ist nicht mehr im Speicher zum Pausieren und Zurückspulen.",
  },
  samples: {
    player_converted_because: { reasons: ["mobile data"] },
  },
  sameInGerman: [],
});
