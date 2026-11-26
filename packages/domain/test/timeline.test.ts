import { DateTime } from "effect";
import { describe, expect, it } from "vitest";
import { ChannelId } from "../src/ids.ts";
import {
  bandsIn,
  bandTicks,
  bandTitle,
  bottomLabelClearance,
  hoverAt,
  layoutTimeline,
  placeLabels,
  positionOf,
  seekBy,
  seekForKey,
  seekTimeAt,
  type TimelineData,
  withOverrun,
} from "../src/timeline.ts";

const MIN = 60_000;
/** Minutes after 04:55, the example recording from the design language. */
const at = (minutes: number) => Date.UTC(2026, 10, 22, 4, 55) + minutes * MIN;

/** Rennen: 04:55 to 08:00 with padding, programme 05:00 to 07:00, live at 06:12. */
const race: TimelineData = {
  start: at(0),
  end: at(185),
  captured: { start: at(0), end: at(77) },
  gaps: [{ start: at(57), end: at(59) }],
  marks: [at(5), at(125)],
  playhead: at(45),
  live: at(77),
};

const pct = (minutes: number) => (minutes / 185) * 100;

describe("positionOf", () => {
  it("maps times linearly onto 0 to 100", () => {
    expect(positionOf(race, at(0))).toBe(0);
    expect(positionOf(race, at(185))).toBe(100);
    expect(positionOf(race, at(77))).toBeCloseTo(pct(77));
  });

  it("clamps times outside the bar", () => {
    expect(positionOf(race, at(-30))).toBe(0);
    expect(positionOf(race, at(400))).toBe(100);
  });

  it("puts everything at 0 on a bar without length", () => {
    expect(positionOf({ start: at(10), end: at(10) }, at(10))).toBe(0);
    expect(positionOf({ start: at(10), end: at(5) }, at(7))).toBe(0);
  });
});

describe("layoutTimeline", () => {
  it("lays out a running recording like the design example", () => {
    const layout = layoutTimeline(race);
    expect(layout.captured?.left).toBe(0);
    expect(layout.captured?.width).toBeCloseTo(pct(77));
    expect(layout.played?.width).toBeCloseTo(pct(45));
    expect(layout.playhead).toBeCloseTo(pct(45));
    expect(layout.live).toBeCloseTo(pct(77));
    expect(layout.upcoming?.left).toBeCloseTo(pct(77));
    expect(layout.upcoming?.width).toBeCloseTo(100 - pct(77));
    expect(layout.marks.map((mark) => mark.toFixed(2))).toEqual([
      pct(5).toFixed(2),
      pct(125).toFixed(2),
    ]);
    expect(layout.gaps).toHaveLength(1);
    expect(layout.gaps[0]?.left).toBeCloseTo(pct(57));
    expect(layout.gaps[0]?.width).toBeCloseTo(pct(2));
  });

  it("stops the watched fill at the end of what was captured", () => {
    const layout = layoutTimeline({ ...race, playhead: at(120) });
    expect(layout.played?.width).toBeCloseTo(pct(77));
    expect(layout.playhead).toBeCloseTo(pct(120));
  });

  it("draws no watched fill or playhead without a playhead", () => {
    const { playhead: _playhead, ...unwatched } = race;
    const layout = layoutTimeline(unwatched);
    expect(layout.played).toBeUndefined();
    expect(layout.playhead).toBeUndefined();
  });

  it("hatches nothing once a recording has finished", () => {
    const { live: _live, ...finished } = race;
    const layout = layoutTimeline({ ...finished, captured: { start: at(0), end: at(185) } });
    expect(layout.upcoming).toBeUndefined();
    expect(layout.live).toBeUndefined();
    expect(layout.captured?.width).toBe(100);
  });

  it("hatches the whole bar for a scheduled recording", () => {
    const layout = layoutTimeline({ start: at(0), end: at(185), marks: [at(5)] });
    expect(layout.upcoming).toEqual({ left: 0, width: 100 });
    expect(layout.captured).toBeUndefined();
    expect(layout.gaps).toEqual([]);
  });

  it("clips gaps to the captured range and merges overlapping ones", () => {
    const layout = layoutTimeline({
      ...race,
      gaps: [
        { start: at(70), end: at(90) },
        { start: at(10), end: at(14) },
        { start: at(12), end: at(20) },
        { start: at(100), end: at(110) },
      ],
    });
    expect(layout.gaps).toHaveLength(2);
    expect(layout.gaps[0]?.left).toBeCloseTo(pct(10));
    expect(layout.gaps[0]?.width).toBeCloseTo(pct(10));
    expect(layout.gaps[1]?.left).toBeCloseTo(pct(70));
    expect(layout.gaps[1]?.width).toBeCloseTo(pct(7));
  });

  it("drops marks outside the bar", () => {
    const layout = layoutTimeline({ ...race, marks: [at(-5), at(5), at(200)] });
    expect(layout.marks).toHaveLength(1);
  });
});

describe("layoutTimeline, SPEC §5 layers", () => {
  it("draws the flat aired track up to live and dashes only after it", () => {
    const layout = layoutTimeline(race);
    expect(layout.aired?.left).toBe(0);
    expect(layout.aired?.width).toBeCloseTo(pct(77));
    expect(layout.upcoming?.left).toBeCloseTo(pct(77));
  });

  it("draws the amber behind-live band from your knob to the live edge", () => {
    const layout = layoutTimeline(race);
    expect(layout.behind?.left).toBeCloseTo(pct(45));
    expect(layout.behind?.width).toBeCloseTo(pct(32));
    // No position of yours, no band and no knob (a live programme you are not watching).
    const { playhead: _playhead, ...notWatching } = race;
    expect(layoutTimeline(notWatching).behind).toBeUndefined();
    expect(layoutTimeline(notWatching).playhead).toBeUndefined();
  });

  it("draws a still now marker with dashes after it when nothing records yet", () => {
    const soon = layoutTimeline({ start: at(0), end: at(120), now: at(30) });
    expect(soon.now).toBeCloseTo(25);
    expect(soon.live).toBeUndefined();
    expect(soon.aired?.width).toBeCloseTo(25);
    expect(soon.upcoming?.left).toBeCloseTo(25);
  });

  it("has no dashes at all for a finished recording", () => {
    const { live: _live, ...finished } = race;
    const layout = layoutTimeline({ ...finished, captured: { start: at(0), end: at(185) } });
    expect(layout.aired).toEqual({ left: 0, width: 100 });
    expect(layout.upcoming).toBeUndefined();
    expect(layout.behind).toBeUndefined();
  });

  it("lays out programme bands and marks the one you are in", () => {
    const layout = layoutTimeline({
      ...race,
      bands: [
        { start: at(0), end: at(5), title: "Vorberichte" },
        { start: at(5), end: at(125), title: "Rennen" },
        { start: at(125), end: at(185), title: "Analyse" },
        { start: at(300), end: at(400), title: "outside" },
      ],
    });
    expect(layout.bands.map((band) => band.title)).toEqual(["Vorberichte", "Rennen", "Analyse"]);
    expect(layout.bands.map((band) => band.current)).toEqual([false, true, false]);
    expect(layout.bands[1]?.left).toBeCloseTo(pct(5));
  });
});

describe("placeLabels", () => {
  it("shows the live label and your time, each hanging inwards near an edge", () => {
    const labels = placeLabels(layoutTimeline(race));
    expect(labels.live?.visible).toBe(true);
    expect(labels.live?.align).toBe("center");
    expect(labels.here?.visible).toBe(true);
    const edge = placeLabels(
      layoutTimeline({ ...race, live: at(184), captured: { start: at(0), end: at(184) } }),
    );
    expect(edge.live?.align).toBe("end");
  });

  it("hides your time when it is closer than 14 % to the live label (SPEC §5)", () => {
    const close = placeLabels(layoutTimeline({ ...race, playhead: at(70) }));
    expect(close.here?.visible).toBe(false);
    expect(close.here).toBeDefined();
    const far = placeLabels(layoutTimeline({ ...race, playhead: at(40) }));
    expect(far.here?.visible).toBe(true);
  });

  it("on a measured bar, hides your time once it would touch the live label", () => {
    // Live at 06:12 (77 min in); 20 % behind is 37 min, clear of 14 % but not on a phone.
    const behind = layoutTimeline({ ...race, playhead: at(40) });
    expect(placeLabels(behind, 1200).here?.visible).toBe(true);
    expect(placeLabels(behind, 300).here?.visible).toBe(false);
  });

  it("hides a bottom label when the knob sits within 28 px of it (open issue #32)", () => {
    // The choice dialog: knob at 18:11, start label 17:55 on a 340 px bar.
    const choice = layoutTimeline({ ...race, playhead: at(4) });
    const narrow = placeLabels(choice, 340);
    expect((pct(4) / 100) * 340).toBeLessThan(bottomLabelClearance);
    expect(narrow.start.visible).toBe(false);
    expect(narrow.end.visible).toBe(true);
    // The same timeline on a wide bar keeps both.
    expect(placeLabels(choice, 1400).start.visible).toBe(true);
    // Before the bar is measured nothing hides.
    expect(placeLabels(choice).start.visible).toBe(true);
  });

  it("hides the end label when the live dot reaches it", () => {
    const nearEnd = layoutTimeline({
      ...race,
      live: at(183),
      captured: { start: at(0), end: at(183) },
    });
    expect(placeLabels(nearEnd, 390).end.visible).toBe(false);
  });

  it("places the now label for a channel on air with nothing recording", () => {
    const labels = placeLabels(layoutTimeline({ start: at(0), end: at(120), now: at(30) }));
    expect(labels.now?.left).toBeCloseTo(25);
    expect(labels.live).toBeUndefined();
    expect(labels.here).toBeUndefined();
  });
});

describe("hoverAt", () => {
  const withBands: TimelineData = {
    ...race,
    bands: [{ start: at(5), end: at(125), title: "Rennen" }],
  };

  it("names the time, how far behind live and the programme under the pointer", () => {
    const info = hoverAt(withBands, 30 / 185);
    expect(info.kind).toBe("past");
    expect(info.time).toBeCloseTo(at(30));
    expect(info.behindMs).toBeCloseTo(47 * MIN);
    expect(info.band).toBe("Rennen");
  });

  it("says live within a minute of the live edge and not aired past it", () => {
    expect(hoverAt(withBands, 76.5 / 185).kind).toBe("live");
    const future = hoverAt(withBands, 100 / 185);
    expect(future.kind).toBe("future");
    expect(future.behindMs).toBeUndefined();
  });
});

describe("seekForKey", () => {
  it("steps 10 s with arrows, 60 s with Shift or the Page keys", () => {
    expect(seekForKey(race, at(45), "ArrowRight", false)).toBe(at(45) + 10_000);
    expect(seekForKey(race, at(45), "ArrowLeft", false)).toBe(at(45) - 10_000);
    expect(seekForKey(race, at(45), "ArrowRight", true)).toBe(at(46));
    expect(seekForKey(race, at(45), "PageDown", false)).toBe(at(44));
    expect(seekForKey(race, at(45), "PageUp", false)).toBe(at(46));
  });

  it("jumps Home to the programme start and End to live", () => {
    expect(seekForKey(race, at(45), "Home", false, at(5))).toBe(at(5));
    expect(seekForKey(race, at(45), "Home", false)).toBe(at(0));
    expect(seekForKey(race, at(45), "End", false)).toBe(at(77));
  });

  it("never seeks past live and ignores other keys", () => {
    expect(seekForKey(race, at(76.9), "ArrowRight", true)).toBe(at(77));
    expect(seekForKey(race, at(45), "a", false)).toBeUndefined();
    expect(seekForKey({ start: at(0), end: at(10) }, at(0), "End", false)).toBeUndefined();
  });
});

describe("seeking", () => {
  it("maps a point on the bar to a time inside what was captured", () => {
    expect(seekTimeAt(race, 0)).toBe(at(0));
    expect(seekTimeAt(race, 20 / 185)).toBeCloseTo(at(20));
  });

  it("never seeks past live or before the captured start", () => {
    expect(seekTimeAt(race, 0.9)).toBe(at(77));
    expect(seekTimeAt({ ...race, captured: { start: at(10), end: at(77) } }, 0)).toBe(at(10));
    expect(seekBy(race, at(70), 30 * MIN)).toBe(at(77));
    expect(seekBy(race, at(5), -10 * MIN)).toBe(at(0));
    expect(seekBy(race, at(30), 10 * MIN)).toBe(at(40));
  });

  it("can't seek when nothing is captured", () => {
    const scheduled = { start: at(0), end: at(185) };
    expect(seekTimeAt(scheduled, 0.5)).toBeUndefined();
    expect(seekBy(scheduled, at(0), MIN)).toBeUndefined();
  });
});

describe("overrun", () => {
  it("grows the bar to a live edge past the planned end, and leaves it alone otherwise", () => {
    const data = { start: 0, end: 100, live: 130, captured: { start: 0, end: 130 } };
    expect(withOverrun(data).end).toBe(130);
    expect(positionOf(withOverrun(data), 100)).toBeCloseTo(76.92, 1);
    const inside = { start: 0, end: 100, live: 50 };
    expect(withOverrun(inside)).toBe(inside);
  });
});

const programme = (channelId: ChannelId, from: number, to: number, title: string) => ({
  channelId,
  start: DateTime.makeUnsafe(at(from)),
  end: DateTime.makeUnsafe(at(to)),
  title,
});

describe("bands", () => {
  const f1 = ChannelId.make("sky-sport-f1");
  const zdf = ChannelId.make("zdf");
  it("names bands without the series prefix and the event", () => {
    expect(bandTitle("Live F1: Qualifying - GP Katar")).toBe("Qualifying");
    expect(bandTitle("F1: Pressekonferenz Qualifying - GP Katar")).toBe(
      "Pressekonferenz Qualifying",
    );
    expect(bandTitle("Tagesschau")).toBe("Tagesschau");
  });

  it("takes the channel's programmes that touch the window, in order", () => {
    const programmes = [
      programme(f1, 125, 185, "Live F1: Pressekonferenz - GP Katar"),
      programme(f1, -60, 5, "Vorbericht"),
      programme(zdf, 0, 60, "heute"),
      programme(f1, 5, 125, "Live F1: Qualifying - GP Katar"),
      programme(f1, 185, 245, "Danach"),
      programme(f1, -120, -60, "Davor"),
    ];
    expect(bandsIn(programmes, f1, at(0), at(185))).toEqual([
      { start: at(-60), end: at(5), title: "Vorbericht" },
      { start: at(5), end: at(125), title: "Qualifying" },
      { start: at(125), end: at(185), title: "Pressekonferenz" },
    ]);
    expect(bandsIn(programmes, zdf, at(100), at(185))).toEqual([]);
  });

  it("ticks where one band ends and the next begins, with the marks, once each", () => {
    const bands = [
      { start: at(-60), end: at(5), title: "Vorbericht" },
      { start: at(5), end: at(125), title: "Qualifying" },
    ];
    expect(bandTicks(bands, [at(125), at(130)])).toEqual([at(-60), at(5), at(125), at(130)]);
    // The bar keeps only the ones inside it.
    const layout = layoutTimeline({ start: at(0), end: at(185), marks: bandTicks(bands) });
    expect(layout.marks).toEqual([pct(5), pct(125)]);
  });
});
