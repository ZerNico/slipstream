import type { ChoiceInput, ChoiceOption } from "@slipstream/domain";
import { formatters, m } from "./runtime.ts";

/** One watch-choice option in words: what it is called and the line under it. */
export interface WatchOptionText {
  readonly title: string;
  readonly detail: string;
}

/** Milliseconds as the seconds the formatters take, never negative. */
const seconds = (ms: number) => Math.max(0, ms) / 1000;

/**
 * The words of one option of the watch choice (SPEC §7.6), for every client. Running recordings
 * use the wall clock and finished ones the position with its length (SPEC §7.9): "Resume at
 * 18:11" with "Where you stopped · −31:30 behind live" while recording, "Resume from 46:30"
 * with "46:30 of 1:15:00 · 28 min left" once finished. Clock times are written in the zone set
 * with `setTimeZone` (the household's); pass the input with the `now` the screen shows.
 */
export const watchOptionText = (option: ChoiceOption, input: ChoiceInput): WatchOptionText => {
  const f = formatters();
  const clock = (epochMs: number) => f.time(new Date(epochMs));
  const edge = Math.min(input.now, input.windowEnd);
  const length = f.clock(seconds(input.windowEnd - input.windowStart));
  switch (option.kind) {
    case "resume": {
      if (input.live) {
        return {
          title: m.choice_resume_at({ clock: clock(option.at) }),
          detail: m.choice_resume_detail_live({ behind: f.behind(seconds(edge - option.at)) }),
        };
      }
      const position = f.clock(seconds(option.at - input.windowStart));
      return {
        title: m.choice_resume_from({ position }),
        detail: m.choice_resume_detail_finished({
          position,
          length,
          left: f.duration(seconds(input.windowEnd - option.at)),
        }),
      };
    }
    case "start":
      return input.live
        ? {
            title: m.player_watch_from_start(),
            detail: m.choice_start_detail_live({
              clock: clock(option.at),
              behind: f.behind(seconds(edge - option.at)),
            }),
          }
        : {
            title: m.choice_play_from_beginning(),
            detail: m.choice_start_detail_finished({ length }),
          };
    case "live":
      return {
        title: m.player_watch_live(),
        detail: m.choice_live_detail({ clock: clock(option.at) }),
      };
  }
};
