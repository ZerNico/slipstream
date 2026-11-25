import { frameUrl } from "@slipstream/api";
import type { Artwork, ChannelId, RecordingState } from "@slipstream/domain";

/*
 * Which picture a card, a backdrop or a detail page shows, the web's order (SPEC §7.4): the
 * guide's image, else the one the server found online (TMDB), else a frame from the recording
 * (never for a failed one), else nothing, and the channel stands in.
 */

/** What the picture is chosen from: a library entry or a guide programme. */
export interface ArtworkSubject {
  readonly channelId: ChannelId;
  readonly imageUrl?: string | undefined;
  readonly onlineImageUrl?: string | undefined;
  /** A recording's own pick from the server; a frame lives here. */
  readonly artwork?: Artwork | undefined;
  readonly state?: RecordingState | undefined;
}

/** A picture to load: an outside address, or one on our server that needs the device token. */
export type Picture =
  | { readonly kind: "outside"; readonly uri: string }
  | { readonly kind: "server"; readonly path: string };

/** The picture for a subject, or undefined when the channel should stand in. */
export const pictureFor = (subject: ArtworkSubject): Picture | undefined => {
  const art = subject.artwork;
  const guide = art?._tag === "Guide" ? art.url : subject.imageUrl;
  if (guide !== undefined) return { kind: "outside", uri: guide };
  const online = art?._tag === "Online" ? art.url : subject.onlineImageUrl;
  if (online !== undefined) return { kind: "outside", uri: online };
  if (art?._tag === "Frame" && subject.state !== "failed") {
    return { kind: "server", path: frameUrl(art.recordingId, art.grabbedAt) };
  }
  return undefined;
};
