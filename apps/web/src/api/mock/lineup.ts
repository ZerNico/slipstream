import type { GuideChannelView } from "@slipstream/api";
import {
  type ChannelId,
  type ChannelStream,
  ChannelStreamId,
  SourceId,
  SourceStreamId,
} from "@slipstream/domain";
import type { MockData } from "./fixtures.ts";

/*
 * The mock's lineup state beyond the fixtures: which streams make up each channel (in fallback
 * order), a second source's copies of two channels, and the guide channels to map from. Kept per
 * data object, so every mock server starts from the fixtures.
 */

/** The mock's lineup state. */
export interface MockLineup {
  /** Channel to its stream ids, first tried first. */
  readonly links: Map<ChannelId, SourceStreamId[]>;
  readonly guideChannels: readonly GuideChannelView[];
}

const states = new WeakMap<MockData, MockLineup>();

/** The lineup state of a mock's data, made from the fixtures on first use. */
export const lineupOf = (data: MockData): MockLineup => {
  const known = states.get(data);
  if (known !== undefined) return known;
  const links = new Map<ChannelId, SourceStreamId[]>(
    data.channels.map((channel) => [
      channel.id,
      data.streams.filter((stream) => stream.upstreamId === channel.id).map((stream) => stream.id),
    ]),
  );
  const guideChannels = data.channels.map((channel): GuideChannelView => ({
    sourceId: SourceId.make("tvproxy"),
    xmltvId: `${channel.id}.de`,
    displayName: channel.name,
    channels: 0,
  }));
  const state = { links, guideChannels };
  states.set(data, state);
  return state;
};

/** A channel's stream links in fallback order. */
export const linksOf = (lineup: MockLineup, channelId: ChannelId): ChannelStream[] =>
  (lineup.links.get(channelId) ?? []).map((sourceStreamId, priority) => ({
    id: ChannelStreamId.make(`${channelId}:${sourceStreamId}`),
    channelId,
    sourceStreamId,
    priority,
  }));

/** The channel a stream is added to, if any. */
export const channelOfStream = (lineup: MockLineup, streamId: string): ChannelId | undefined => {
  for (const [channelId, ids] of lineup.links)
    if (ids.some((id) => id === streamId)) return channelId;
  return undefined;
};

/** Adds a stream to a channel as its last fallback. */
export const linkStream = (lineup: MockLineup, channelId: ChannelId, streamId: SourceStreamId) => {
  lineup.links.set(channelId, [...(lineup.links.get(channelId) ?? []), streamId]);
};
