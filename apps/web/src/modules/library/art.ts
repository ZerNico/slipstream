import { DateTime } from "effect";
import { frameUrl } from "@slipstream/api";
import { type Channel, channelMark, displayChannelName } from "@slipstream/domain";
import type { ArtworkSubject } from "~/ui/artwork/generate.ts";
import type { Entry } from "./library.ts";

/** A channel's name as cards and rows show it (`displayChannelName`), or `fallback`. */
export const channelLabel = (channel: Pick<Channel, "name"> | undefined, fallback = ""): string =>
  channel ? displayChannelName(channel.name) : fallback;

/**
 * What the one artwork resolver needs about a recording (SPEC §7.4): the server's pick when it
 * sent one (guide image, a frame 10 minutes in), otherwise title, categories and channel for the
 * generated art. A failed recording never shows a frame.
 */
export const entrySubject = (entry: Entry, channel: Channel | undefined): ArtworkSubject => {
  const art = entry.artwork;
  return {
    title: entry.title,
    categories: entry.categories,
    ...(channel
      ? {
          channel: {
            mark: channelMark(channel.name),
            ...(channel.logoUrl === undefined ? {} : { logoUrl: channel.logoUrl }),
          },
        }
      : {}),
    ...(art?._tag === "Guide" ? { guideImageUrl: art.url } : {}),
    ...(art?._tag === "Online" ? { onlineImageUrl: art.url } : {}),
    ...(art?._tag === "Frame"
      ? {
          frameUrl: frameUrl(art.recordingId, art.grabbedAt),
          frameAt: DateTime.toEpochMillis(art.grabbedAt),
        }
      : {}),
    ...(entry.state === "failed" ? { failed: true } : {}),
  };
};
