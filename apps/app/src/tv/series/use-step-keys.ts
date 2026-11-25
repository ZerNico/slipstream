import { type TVRemoteEvent, useTVEventHandler } from "react-native";
import { readPress } from "../guide/remote.ts";

/**
 * Left and right on the remote step the stepper whose row has focus (`active`), as in the record
 * sheet; native focus stays on the row, since the side sheet keeps it from leaving sideways.
 */
export const useStepKeys = <S extends string>(
  active: S | undefined,
  step: (which: S, direction: 1 | -1) => void,
): void => {
  useTVEventHandler((event: TVRemoteEvent) => {
    const press = readPress(event);
    if (active === undefined || press?.phase !== "down") return;
    if (press.key === "left") step(active, -1);
    if (press.key === "right") step(active, 1);
  });
};
