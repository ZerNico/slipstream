import { Player } from "../src/player/Player.tsx";

/** Player: `/player?kind=live|recording|range&...&from=start|live|resume`. */
export default function PlayerScreen() {
  return <Player />;
}
