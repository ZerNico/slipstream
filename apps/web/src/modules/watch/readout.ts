import { m } from "@slipstream/i18n";
import { formatBehind, formatClock, formatPosition } from "~/i18n/formats.ts";
import type { PlayerPosition } from "./player-model.ts";
import { endsAt } from "./speed.ts";
import { liveEta } from "@slipstream/domain";

/*
 * The read-out under the picture (SPEC §4 BehindReadout, §7.1): "−31:30 behind live" in amber,
 * "● LIVE" in red, or "47:10 left" for a finished recording, and the
 * quiet line under it. Pure text, so the component only lays it out.
 */

/** One piece of the quiet line; `strong` pieces are the facts that change. */
export interface SubPart {
  readonly text: string;
  readonly strong?: boolean;
  /** The speed, in amber. */
  readonly speed?: boolean;
}

/** What the read-out says. */
export interface Readout {
  /** "behind" (amber delta), "live" (red LIVE pill) or "left" (finished, neutral delta). */
  readonly kind: "behind" | "live" | "left";
  /** "−31:30" or "47:10"; empty at live (the LIVE pill draws itself). */
  readonly delta: string;
  /** "behind live" or "left"; empty at live. */
  readonly label: string;
  /** The quiet line, piece by piece, joined with " · ". */
  readonly sub: readonly (readonly SubPart[])[];
}

/** Builds the read-out for a position, the speed and the clock. */
export const readoutFor = (input: {
  readonly position: PlayerPosition;
  readonly mode: "running" | "finished";
  readonly speed: number;
  readonly now: number;
  /** The end of the recording window (running recordings); live TV has none. */
  readonly windowEnd?: number;
  /** Minutes missing from a finished recording, for "contains a 2 min gap". */
  readonly gapMinutes?: number;
}): Readout => {
  const { position, speed } = input;
  const speedPart: SubPart[] | undefined =
    speed === 1 ? undefined : [{ text: m.player_speed_value({ speed }), speed: true }];
  if (input.mode === "finished") {
    const end = endsAt({ now: input.now, leftMs: position.leftMs, speed });
    return {
      kind: "left",
      delta: formatPosition(position.leftMs),
      label: m.player_left_label(),
      sub: [
        ...(speedPart ? [speedPart] : []),
        [{ text: m.player_sub_ends({ clock: formatClock(end) }) }],
        ...(input.gapMinutes && input.gapMinutes > 0
          ? [[{ text: m.player_sub_gap({ minutes: input.gapMinutes }) }]]
          : []),
      ],
    };
  }
  const eta = position.atLive
    ? undefined
    : liveEta({
        now: input.now,
        behindMs: position.behindMs,
        speed,
        ...(input.windowEnd === undefined ? {} : { windowEnd: input.windowEnd }),
      });
  return {
    kind: position.atLive ? "live" : "behind",
    delta: position.atLive ? "" : formatBehind(position.behindMs),
    label: position.atLive ? "" : m.player_behind_live_label(),
    // At live nothing more to say; behind, the broadcast time you are at, and the speed.
    sub: position.atLive
      ? []
      : [
          [
            { text: m.player_sub_playing() },
            { text: formatClock(position.position), strong: true },
          ],
          ...(speedPart ? [speedPart] : []),
          ...(eta === undefined
            ? []
            : [[{ text: m.player_sub_live_at() }, { text: formatClock(eta), strong: true }]]),
        ],
  };
};
