/** Small presentation helpers Home shares between the hero and the rows. */
import type { Channel } from "@slipstream/domain";

/** A channel by id. */
export const channelOf = (channels: readonly Channel[], id: string): Channel | undefined =>
  channels.find((channel) => channel.id === id);
