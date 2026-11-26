import { formatters, m } from "./runtime.ts";

/*
 * The player's read-out (SPEC §4 BehindReadout, §7.1) for every client: "−31:30 behind live",
 * the LIVE pill, or "47:10 left", and the quiet line under it. The caller works out the times
 * (`liveEta`, `playbackEndsAt`); this only words them.
 */

/** One piece of the quiet line; `strong` pieces are the facts that change. */
export interface ReadoutPiece {
  readonly text: string;
  readonly strong?: boolean;
  /** The speed, in amber. */
  readonly speed?: boolean;
}

/** What the read-out says. */
export interface PlayerReadout {
  /** "behind" (amber delta), "live" (red LIVE pill) or "left" (finished, neutral delta). */
  readonly kind: "behind" | "live" | "left";
  /** "−31:30" or "47:10"; empty at live (the LIVE pill draws itself). */
  readonly delta: string;
  /** "behind live" or "left"; empty at live. */
  readonly label: string;
  /** The quiet line, part by part: pieces join with a space, parts with " · ". */
  readonly sub: readonly (readonly ReadoutPiece[])[];
}

/** What is playing, for the read-out. Times are epoch ms, lengths ms. */
export type ReadoutInput =
  | {
      /** A finished recording or a captured range: it has a length and an end. */
      readonly mode: "finished";
      readonly leftMs: number;
      readonly speed: number;
      /** When it ends at this speed (`playbackEndsAt`). */
      readonly endsAt: number;
      /** What is missing from it; a gap line shows when there is any. */
      readonly missingMs?: number | undefined;
    }
  | {
      /** Live TV or a recording still running: it has a live edge. */
      readonly mode: "running";
      readonly atLive: boolean;
      readonly behindMs: number;
      /** The broadcast time at the playhead. */
      readonly position: number;
      readonly speed: number;
      /** When playing faster reaches live (`liveEta`), if it does. */
      readonly liveAt?: number | undefined;
    };

/** Builds the read-out. */
export const playerReadout = (input: ReadoutInput): PlayerReadout => {
  const f = formatters();
  const clock = (time: number) => f.time(new Date(time));
  const speedPart: readonly ReadoutPiece[] | undefined =
    input.speed === 1
      ? undefined
      : [{ text: m.player_speed_value({ speed: input.speed }), speed: true }];
  if (input.mode === "finished") {
    const missing = input.missingMs ?? 0;
    return {
      kind: "left",
      delta: f.clock(Math.max(0, input.leftMs) / 1000),
      label: m.player_left_label(),
      sub: [
        ...(speedPart ? [speedPart] : []),
        [{ text: m.player_sub_ends({ clock: clock(input.endsAt) }) }],
        ...(missing > 0
          ? [[{ text: m.player_sub_gap({ minutes: Math.max(1, Math.round(missing / 60_000)) }) }]]
          : []),
      ],
    };
  }
  if (input.atLive) return { kind: "live", delta: "", label: "", sub: [] };
  return {
    kind: "behind",
    delta: f.behind(Math.max(0, input.behindMs) / 1000),
    label: m.player_behind_live_label(),
    // Behind: the broadcast time you are at, the speed, and when faster reaches live.
    sub: [
      [{ text: m.player_sub_playing() }, { text: clock(input.position), strong: true }],
      ...(speedPart ? [speedPart] : []),
      ...(input.liveAt === undefined
        ? []
        : [[{ text: m.player_sub_live_at() }, { text: clock(input.liveAt), strong: true }]]),
    ],
  };
};

/** The quiet line as plain text, for screen readers and tests. */
export const readoutLine = (readout: PlayerReadout): string =>
  readout.sub.map((part) => part.map((piece) => piece.text).join(" ")).join(" · ");
