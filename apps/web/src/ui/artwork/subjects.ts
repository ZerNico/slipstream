import { frameUrl, type RecordingEntry } from "@slipstream/api";
import { type Channel, channelMark, epochMs, type Programme } from "@slipstream/domain";
import type { ArtworkSubject } from "./generate.ts";

/*
 * What the one artwork resolver needs about a recording or a programme (SPEC §7.4), built once
 * so an item looks the same in the guide, on Home, in the library and in the player.
 */

/** What a subject needs of a channel: its name for the mark, its logo for the corner. */
export type SubjectChannel = Pick<Channel, "name" | "logoUrl">;

/** What a subject needs of a recording. */
export type SubjectRecording = Pick<
  RecordingEntry,
  "title" | "categories" | "artwork" | "state" | "imageUrl" | "onlineImageUrl"
>;

/** The corner of generated art: the channel's logo when it has one, else its short mark. */
const channelPart = (channel: SubjectChannel | undefined): Pick<ArtworkSubject, "channel"> =>
  channel === undefined
    ? {}
    : {
        channel: {
          mark: channelMark(channel.name),
          ...(channel.logoUrl === undefined ? {} : { logoUrl: channel.logoUrl }),
        },
      };

/**
 * A recording's frame. The URL names the recording the frame was grabbed from, which the server
 * sends with the artwork; it may be another capture of the same programme than the entry's own.
 */
const framePart = (
  recording: Pick<RecordingEntry, "artwork" | "state"> | undefined,
): Pick<ArtworkSubject, "frameUrl" | "frameAt" | "failed"> => {
  const art = recording?.artwork;
  return {
    ...(art?._tag === "Frame"
      ? { frameUrl: frameUrl(art.recordingId, art.grabbedAt), frameAt: epochMs(art.grabbedAt) }
      : {}),
    ...(recording?.state === "failed" ? { failed: true } : {}),
  };
};

/** The design of generated art, when the server resolved the artwork to generated art. */
const stylePart = (
  recording: Pick<RecordingEntry, "artwork"> | undefined,
): Pick<ArtworkSubject, "style"> =>
  recording?.artwork?._tag === "Generated" ? { style: recording.artwork.style } : {};

/** The artwork subject of a recording. */
export const recordingSubject = (
  entry: SubjectRecording,
  channel: SubjectChannel | undefined,
): ArtworkSubject => {
  const art = entry.artwork;
  const guideImageUrl = art?._tag === "Guide" ? art.url : entry.imageUrl;
  const onlineImageUrl = art?._tag === "Online" ? art.url : entry.onlineImageUrl;
  return {
    title: entry.title,
    categories: entry.categories,
    ...channelPart(channel),
    ...(guideImageUrl === undefined ? {} : { guideImageUrl }),
    ...(onlineImageUrl === undefined ? {} : { onlineImageUrl }),
    ...framePart(entry),
    ...stylePart(entry),
  };
};

/**
 * The artwork subject of a guide programme. A programme with a recording of it shows that
 * recording's picture when the guide has none, so the cell, the sheet and the Home card agree.
 */
export const programmeSubject = (
  programme: Pick<Programme, "title" | "categories" | "imageUrl" | "onlineImageUrl">,
  channel: SubjectChannel | undefined,
  recording?: Pick<RecordingEntry, "artwork" | "state">,
): ArtworkSubject => {
  const art = recording?.artwork;
  const guideImageUrl = programme.imageUrl ?? (art?._tag === "Guide" ? art.url : undefined);
  const onlineImageUrl = programme.onlineImageUrl ?? (art?._tag === "Online" ? art.url : undefined);
  return {
    title: programme.title,
    categories: programme.categories,
    ...channelPart(channel),
    ...(guideImageUrl === undefined ? {} : { guideImageUrl }),
    ...(onlineImageUrl === undefined ? {} : { onlineImageUrl }),
    ...framePart(recording),
    ...stylePart(recording),
  };
};
