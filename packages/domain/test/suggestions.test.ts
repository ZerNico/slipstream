import { describe, expect, it } from "vitest";
import { layoutProblems } from "../src/collection.ts";
import { type GroupSubject, groupRecording, renderPath } from "../src/grouping.ts";
import { CollectionId, RecordingId } from "../src/ids.ts";
import { emptyMatcher } from "../src/matcher.ts";
import {
  extendMatcher,
  previewMatcherChange,
  inferLayout,
  titleStart,
} from "../src/suggestions.ts";
import {
  at,
  collection,
  eurosport,
  germanLabels,
  skyF1,
  subject,
  timeZone,
} from "./test-support.ts";

let counter = 0;
const recording = (
  channelId: GroupSubject["channelId"],
  title: string,
  day: number,
): GroupSubject & { readonly id: RecordingId } => {
  counter += 1;
  return {
    ...subject({
      channelId,
      title,
      start: at(`2026-11-${String(day).padStart(2, "0")}T13:00:00Z`),
      end: at(`2026-11-${String(day).padStart(2, "0")}T14:00:00Z`),
    }),
    id: RecordingId.make(`r${counter}`),
  };
};

describe("title starts", () => {
  it("splits at the first separator and keeps a colon", () => {
    expect(titleStart("Live F1: Rennen - GP Las Vegas")).toEqual({
      prefix: "Live F1:",
      name: "F1",
      key: "f1",
      rest: "Rennen - GP Las Vegas",
    });
    expect(titleStart("Snooker: UK Championship – Finale")?.prefix).toBe("Snooker:");
    expect(
      titleStart("Live: Bundesliga, 12. Spieltag: FC Bayern – Borussia Dortmund"),
    ).toMatchObject({
      prefix: "Live: Bundesliga",
      name: "Bundesliga",
    });
  });

  it("has no start without a separator", () => {
    expect(titleStart("Tagesschau")).toBeUndefined();
    expect(titleStart("Live")).toBeUndefined();
  });
});

const layoutOf = (recordings: ReadonlyArray<GroupSubject>) =>
  inferLayout(recordings.flatMap((one) => titleStart(one.title)?.rest ?? []));

describe("layouts for a group of titles", () => {
  const f1Weekend = [
    recording(skyF1, "Live F1: Qualifying - GP Las Vegas", 21),
    recording(skyF1, "Live F1: Rennen - GP Las Vegas", 22),
    recording(skyF1, "F1: Pressekonferenz Qualifying - GP Las Vegas", 21),
    recording(skyF1, "Live F1: Rennen - GP Katar", 30),
  ];
  const snooker = [
    recording(eurosport, "Snooker: UK Championship – Viertelfinale", 20),
    recording(eurosport, "Snooker: UK Championship – Halbfinale", 21),
    recording(eurosport, "Snooker: UK Championship – Finale", 22),
  ];

  it("lays F1 out the way the design doc groups it", () => {
    const layout = layoutOf(f1Weekend);
    expect(layout.path).toEqual(["{year}", "{event}", "{programme}"]);
    expect(layoutProblems(layout)).toEqual([]);
    const draft = collection("draft", "Formel 1", {
      matcher: { channels: [skyF1], title: [{ _tag: "StartsWith", values: ["F1:", "Live F1:"] }] },
      layout,
    });
    const paths = f1Weekend.map((one) =>
      renderPath(groupRecording(one, [draft], { timeZone }).path, germanLabels),
    );
    expect(paths).toEqual([
      ["Formel 1", "2026", "GP Las Vegas", "Qualifying"],
      ["Formel 1", "2026", "GP Las Vegas", "Rennen"],
      ["Formel 1", "2026", "GP Las Vegas", "Pressekonferenz Qualifying"],
      ["Formel 1", "2026", "GP Katar", "Rennen"],
    ]);
  });

  it("takes the side that repeats as the event, before or after the separator", () => {
    const draft = collection("draft", "Snooker", {
      matcher: { title: [{ _tag: "StartsWith", values: ["Snooker:"] }] },
      layout: layoutOf(snooker),
    });
    expect(
      renderPath(groupRecording(snooker[2]!, [draft], { timeZone }).path, germanLabels),
    ).toEqual(["Snooker", "2026", "UK Championship", "Finale"]);
  });
});

describe("also move similar ones", () => {
  const press = subject({
    channelId: skyF1,
    title: "F1: Pressekonferenz Qualifying - GP Las Vegas",
    start: at("2026-11-21T05:30:00Z"),
    end: at("2026-11-21T06:00:00Z"),
  });
  const liveOnly = collection("f1", "Formel 1", {
    matcher: { channels: [skyF1], title: [{ _tag: "StartsWith", values: ["Live F1:"] }] },
  });

  it("adds the title start to a failing starts-with condition", () => {
    const extension = extendMatcher(liveOnly.matcher, press, timeZone);
    expect(extension).toEqual({
      _tag: "Extended",
      matcher: {
        ...liveOnly.matcher,
        title: [{ _tag: "StartsWith", values: ["Live F1:", "F1:"] }],
      },
      changes: [{ _tag: "AddTitleValue", index: 0, value: "F1:" }],
    });
  });

  it("adds the channel, weekday and duration it needs, and nothing else", () => {
    const matcher = {
      ...emptyMatcher,
      channels: [eurosport],
      title: [{ _tag: "Contains" as const, values: ["Rennen"] as const }],
      weekdays: ["sun" as const],
      minDurationMinutes: 60,
    };
    const extension = extendMatcher(matcher, press, timeZone);
    expect(extension._tag).toBe("Extended");
    if (extension._tag !== "Extended") return;
    expect(extension.changes).toEqual([
      { _tag: "AddChannel", channelId: skyF1 },
      { _tag: "AddTitleValue", index: 0, value: "Pressekonferenz Qualifying" },
      { _tag: "AddWeekday", weekday: "sat" },
      { _tag: "WidenDuration", minDurationMinutes: 30 },
    ]);
  });

  it("reports a matcher that already matches, and refuses to touch a regex", () => {
    expect(extendMatcher({ ...emptyMatcher, channels: [skyF1] }, press, timeZone)).toEqual({
      _tag: "AlreadyMatches",
    });
    expect(
      extendMatcher(
        { ...emptyMatcher, title: [{ _tag: "Regex", pattern: "^Live F1:" }] },
        press,
        timeZone,
      ),
    ).toEqual({ _tag: "CannotExtend", reason: "regex" });
    expect(
      extendMatcher(
        { ...emptyMatcher, title: [{ _tag: "IsExactly", values: ["x"], field: "subtitle" }] },
        press,
        timeZone,
      ),
    ).toEqual({ _tag: "CannotExtend", reason: "noSubtitle" });
  });

  it("previews the past and future recordings that would move", () => {
    const extension = extendMatcher(liveOnly.matcher, press, timeZone);
    if (extension._tag !== "Extended") throw new Error("expected an extension");
    const pressRoom = collection("press", "Pressekonferenzen", {
      matcher: { title: [{ _tag: "Contains", values: ["Pressekonferenz"] }] },
    });
    const pastPress = {
      ...press,
      title: "F1: Pressekonferenz - GP Katar",
      start: at("2026-11-29T12:00:00Z"),
    };
    const futureHighlights = {
      ...press,
      title: "F1: Highlights - GP Abu Dhabi",
      start: at("2026-12-07T12:00:00Z"),
      end: at("2026-12-07T13:00:00Z"),
    };
    const alreadyIn = { ...press, title: "Live F1: Rennen - GP Las Vegas" };
    const otherChannel = { ...futureHighlights, channelId: eurosport };
    const preview = previewMatcherChange(
      [liveOnly, pressRoom],
      CollectionId.make("f1"),
      extension.matcher,
      [press, pastPress, futureHighlights, alreadyIn, otherChannel],
      { timeZone, now: Date.UTC(2026, 11, 1) },
    );
    // The press conferences are more specific in F1 now (channel + title beats title only).
    expect(preview.past).toEqual([
      { subject: press, from: pressRoom.id },
      { subject: pastPress, from: pressRoom.id },
    ]);
    expect(preview.future).toEqual([{ subject: futureHighlights }]);
  });
});
