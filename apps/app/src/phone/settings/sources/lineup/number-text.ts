import { type Channel, type ChannelId, previewNumberMove } from "@slipstream/domain";
import { m } from "@slipstream/i18n";

/**
 * The sentence under a typed number: where the channels go and who makes room ("Move to 6 ·
 * VOX HD moves to 8"), as the server will number them.
 */
export const numberMoveText = (
  lineup: readonly Channel[],
  ids: readonly ChannelId[],
  number: number,
): string => {
  const move = previewNumberMove(lineup, ids, number);
  const target =
    move.first === move.last
      ? m.lineup_move_to({ number: move.first })
      : m.lineup_move_to_range({ first: move.first, last: move.last });
  const [only] = move.displaced;
  const room =
    move.displaced.length === 0
      ? m.lineup_nothing_moves()
      : move.displaced.length === 1 && only !== undefined
        ? m.lineup_holder_moves({ name: only.name, number: only.number })
        : m.lineup_holders_move({ count: move.displaced.length });
  return `${target} · ${room}`;
};
