import { DateTime } from "effect";
import { describe, expect, it } from "vitest";
import { CollectionId, ProgrammeId } from "../src/ids.ts";
import { emptyMatcher, matcherProblems } from "../src/matcher.ts";
import { findDuplicate } from "../src/airing.ts";
import { type PlanExisting, type PlanningContext, planRecordings } from "../src/planner.ts";
import { exportTemplateProblems, matchRule, type Rule } from "../src/rule.ts";
import { seriesPrefix, seriesRule } from "../src/series-rule.ts";
import { sameEpisode } from "../src/episode.ts";
import type { UserId } from "../src/ids.ts";
import type { Programme } from "../src/programme.ts";
import { at, daserste, programme, rule, skyF1, timeZone } from "./test-support.ts";
import {
  context,
  jonas,
  kim,
  raceLive,
  raceReplay,
  recorded,
  tatortOnOne,
  tatortSunday,
  tatortWdr,
  wdr,
} from "./episode-fixtures.ts";

/** The first rule from PLAN 6.6. */
const f1 = rule(
  "f1",
  {
    channels: [skyF1],
    title: [
      { _tag: "StartsWith", values: ["Live F1:"] },
      {
        _tag: "Contains",
        values: [
          "1. Freies Training",
          "2. Freies Training",
          "3. Freies Training",
          "Qualifying",
          "Sprint Qualifying",
          "Sprint",
          "Rennen",
        ],
      },
    ],
  },
  { padding: { beforeMinutes: 5, afterMinutes: 60 } },
);

const race = programme({
  channelId: skyF1,
  title: "Live F1: Rennen - GP Las Vegas",
  start: at("2026-11-22T04:00:00Z"),
  end: at("2026-11-22T06:00:00Z"),
  live: true,
});

describe("rule matching", () => {
  it("matches the F1 race and pads the range", () => {
    const match = matchRule(f1, race, timeZone);
    expect(match).toBeDefined();
    expect(DateTime.formatIso(match!.range.start)).toBe("2026-11-22T03:55:00.000Z");
    expect(DateTime.formatIso(match!.range.end)).toBe("2026-11-22T07:00:00.000Z");
    expect(match!.match.titleHits.map((hit) => hit.text)).toEqual(["Live F1:", "Rennen"]);
  });

  it("matches every session of the weekend", () => {
    for (const session of ["1. Freies Training", "Sprint Qualifying", "Qualifying", "Sprint"]) {
      const entry = programme({ ...race, title: `Live F1: ${session} - GP Katar` });
      expect(matchRule(f1, entry, timeZone)?.match.titleHits[1]?.text).toBe(session);
    }
  });

  it("ignores replays, other shows and other channels", () => {
    expect(
      matchRule(f1, { ...race, title: "F1: Rennen - GP Las Vegas" }, timeZone),
    ).toBeUndefined();
    expect(
      matchRule(f1, { ...race, title: "Live F1: Countdown - GP Las Vegas" }, timeZone),
    ).toBeUndefined();
    expect(matchRule(f1, { ...race, channelId: daserste }, timeZone)).toBeUndefined();
  });

  it("never matches when disabled", () => {
    expect(matchRule({ ...f1, enabled: false }, race, timeZone)).toBeUndefined();
  });

  it("checks weekdays in the household time zone", () => {
    const saturdayOnly = rule("sat", { ...f1.matcher, weekdays: ["sat"] });
    // 04:00Z on 2026-11-22 is Sunday 05:00 in Berlin.
    expect(matchRule(saturdayOnly, race, timeZone)).toBeUndefined();
    expect(matchRule(saturdayOnly, race, "America/Los_Angeles")).toBeDefined();
    expect(
      matchRule(rule("sun", { ...f1.matcher, weekdays: ["sun"] }), race, timeZone),
    ).toBeDefined();
  });

  it("filters by duration and category", () => {
    const long = rule("long", { categories: ["sport"], minDurationMinutes: 90 });
    expect(matchRule(long, { ...race, categories: ["Sport"] }, timeZone)).toBeDefined();
    expect(
      matchRule(
        long,
        { ...race, categories: ["Sport"], end: at("2026-11-22T05:00:00Z") },
        timeZone,
      ),
    ).toBeUndefined();
    expect(matchRule(long, race, timeZone)).toBeUndefined();
  });

  it("refuses matchers that would record everything or cannot compile", () => {
    expect(matcherProblems(emptyMatcher)).toEqual([{ _tag: "MatchesEverything" }]);
    expect(
      matcherProblems({
        ...emptyMatcher,
        title: [{ _tag: "Regex", pattern: "([" }],
        minDurationMinutes: 60,
        maxDurationMinutes: 30,
      }),
    ).toEqual([{ _tag: "InvalidRegex", pattern: "([" }, { _tag: "InvertedDuration" }]);
    expect(matcherProblems(f1.matcher)).toEqual([]);
  });

  it("refuses regexes that could backtrack without end", () => {
    const evil = { ...emptyMatcher, title: [{ _tag: "Regex" as const, pattern: "^(.+)+X$" }] };
    expect(matcherProblems(evil)).toEqual([
      { _tag: "UnsafeRegex", pattern: "^(.+)+X$", hazard: "nestedQuantifier" },
    ]);
  });
});

describe("unsafe regexes", () => {
  const evil = rule("evil", { channels: [skyF1], title: [{ _tag: "Regex", pattern: "^(.+)+X$" }] });

  it("never run: a rule with one matches nothing, quickly", () => {
    const longTitle = programme({ ...race, title: `Live F1: ${"a".repeat(5_000)}` });
    const started = performance.now();
    const { planned } = planRecordings([evil], [race, longTitle], [], { timeZone, now: 0 });
    expect(planned).toEqual([]);
    expect(performance.now() - started).toBeLessThan(500);
  });
});

describe("export templates", () => {
  const named = {
    ...emptyMatcher,
    title: [{ _tag: "Regex" as const, pattern: "^(?<series>.+?): (?<episode>.+)$" }],
  };

  it("accepts relative paths with built-in variables and regex group names", () => {
    expect(exportTemplateProblems("Sport/{title}/{series} - {episode}", named)).toEqual([]);
  });

  it("refuses paths that leave the export folder and unknown variables", () => {
    expect(exportTemplateProblems("/etc/{title}", named)).toEqual([{ _tag: "AbsolutePath" }]);
    expect(exportTemplateProblems("C:\\exports", named)).toEqual([{ _tag: "AbsolutePath" }]);
    expect(exportTemplateProblems("Sport/../../{title}", named)).toEqual([
      { _tag: "ParentFolder" },
    ]);
    expect(exportTemplateProblems("{nope}", emptyMatcher)).toEqual([
      { _tag: "UnknownVariable", name: "nope" },
    ]);
  });
});

describe("planning recordings", () => {
  const qualifying = programme({
    channelId: skyF1,
    title: "Live F1: Qualifying - GP Las Vegas",
    start: at("2026-11-21T04:00:00Z"),
    end: at("2026-11-21T05:30:00Z"),
  });

  it("plans each matched programme once, in time order, with the widest padding", () => {
    const wider = rule(
      "everything-on-sky",
      { channels: [skyF1] },
      { padding: { beforeMinutes: 10, afterMinutes: 0 } },
    );
    const { planned, skipped } = planRecordings([f1, wider], [race, qualifying], [], {
      timeZone,
      now: 0,
    });
    expect(skipped).toEqual([]);
    expect(planned.map((plan) => plan.programme.title)).toEqual([
      "Live F1: Qualifying - GP Las Vegas",
      "Live F1: Rennen - GP Las Vegas",
    ]);
    expect(planned[1]?.ruleIds).toEqual(["f1", "everything-on-sky"]);
    expect(DateTime.formatIso(planned[1]!.range.start)).toBe("2026-11-22T03:50:00.000Z");
    expect(DateTime.formatIso(planned[1]!.range.end)).toBe("2026-11-22T07:00:00.000Z");
  });

  it("skips programmes already scheduled and duplicate guide entries", () => {
    const duplicateEntry = programme({
      ...race,
      id: ProgrammeId.make("race-duplicate"),
      start: at("2026-11-22T04:05:00Z"),
    });
    const { planned, skipped } = planRecordings(
      [f1],
      [race, duplicateEntry, qualifying],
      [{ ...qualifying, programmeId: qualifying.id }],
      { timeZone, now: 0 },
    );
    expect(planned.map((plan) => plan.programme.id)).toEqual([race.id]);
    expect(skipped.map((skip) => [skip.programme.id, skip.reason._tag])).toEqual([
      [qualifying.id, "SameAiring"],
      [duplicateEntry.id, "DuplicateEntry"],
    ]);
  });

  it("does not treat the same title at another time as a duplicate", () => {
    const nextYear = {
      ...race,
      programmeId: undefined,
      start: at("2027-11-21T04:00:00Z"),
      end: at("2027-11-21T06:00:00Z"),
    };
    expect(findDuplicate(nextYear, [{ ...race, programmeId: race.id }])).toBeUndefined();
    // Nor as the same episode: next year's race is recorded even with "Only episodes you don't
    // have yet" (§4.3).
    expect(sameEpisode(race, { ...race, ...nextYear }, { timeZone })).toBe(false);
  });
});

describe("Record every", () => {
  it("keys on the title start, else the whole title", () => {
    expect(seriesPrefix("Live F1: Rennen - GP Las Vegas")).toEqual({
      prefix: "Live F1:",
      partial: true,
      name: "Live F1",
    });
    expect(seriesPrefix("Tatort")).toEqual({ prefix: "Tatort", partial: false, name: "Tatort" });
    expect(seriesPrefix("Der Pate").name).toBe("Der Pate");
  });

  it("creates a rule on this channel for titles starting with the prefix", () => {
    const created = seriesRule(
      { channelId: skyF1, title: "Live F1: Rennen - GP Katar" },
      { beforeMinutes: 5, afterMinutes: 45 },
      CollectionId.make("formel-1"),
    );
    expect(created).toMatchObject({
      name: "Live F1",
      enabled: true,
      matcher: { channels: [skyF1], title: [{ _tag: "StartsWith", values: ["Live F1:"] }] },
      padding: { beforeMinutes: 5, afterMinutes: 45 },
      skipRepeats: true,
      collectionId: CollectionId.make("formel-1"),
    });
    expect(
      seriesRule(
        { channelId: daserste, title: "Tatort" },
        { beforeMinutes: 0, afterMinutes: 0 },
        undefined,
      ),
    ).not.toHaveProperty("collectionId");
  });
});

/** A series recording of Tatort on every channel, leaving out repeats. */
const tatortFor = (owner: UserId) =>
  rule(
    `tatort-${owner}`,
    { title: [{ _tag: "IsExactly", values: ["Tatort"] }] },
    { ownerId: owner, skipRepeats: true },
  );

describe("planning with repeats (§5.2)", () => {
  const noPad = { beforeMinutes: 0, afterMinutes: 0 };
  const now = DateTime.toEpochMillis(at("2026-11-21T12:00:00Z"));
  const plan = (
    rules: ReadonlyArray<Rule>,
    programmes: ReadonlyArray<Programme>,
    existing: ReadonlyArray<PlanExisting>,
    extra: Partial<PlanningContext> = {},
  ) => planRecordings(rules, programmes, existing, { ...context, now, ...extra });
  /** Kim's Das Erste series recording, as "Record series" makes it. */
  const erste = rule("tatort-erste", seriesRule(tatortSunday, noPad).matcher, {
    ownerId: kim,
    skipRepeats: true,
  });
  const failedSunday = {
    ...recorded(tatortSunday, { state: "failed", ruleId: erste.id }),
    rerunUntil: at("2026-12-06T20:45:00Z"),
  };

  it("decides per rule: Kim has the episode, Jonas cannot see it and records his own", () => {
    const kims = tatortFor(kim);
    const jonass = tatortFor(jonas);
    const sunday = recorded(tatortSunday);
    const { planned, skipped } = plan([kims, jonass], [tatortOnOne], [sunday], {
      sees: (owner, copy) => copy.ownerIds.includes(owner),
    });
    expect(planned.map((item) => item.ruleIds)).toEqual([[jonass.id]]);
    expect(skipped).toEqual([
      {
        programme: tatortOnOne,
        ruleId: kims.id,
        reason: {
          _tag: "Repeat",
          of: {
            recordingId: sunday.id,
            start: sunday.start,
            channelId: daserste,
            state: "completed",
          },
        },
      },
    ]);
  });

  it("records every airing for a rule set to Every airing", () => {
    const everyAiring = rule("tatort-all", { title: [{ _tag: "IsExactly", values: ["Tatort"] }] });
    const { planned } = plan([everyAiring], [tatortOnOne], [recorded(tatortSunday)]);
    expect(planned.map((item) => item.programme.id)).toEqual([tatortOnOne.id]);
  });

  it("plans an episode twice in the window once, at its earliest airing", () => {
    const kims = tatortFor(kim);
    const { planned, skipped } = plan([kims], [tatortOnOne, tatortSunday], []);
    expect(planned.map((item) => item.programme.id)).toEqual([tatortSunday.id]);
    expect(skipped).toEqual([
      {
        programme: tatortOnOne,
        ruleId: kims.id,
        reason: {
          _tag: "Repeat",
          of: { start: tatortSunday.start, channelId: daserste, state: "scheduled" },
        },
      },
    ]);
  });

  it("does not count a scheduled copy the conflict result cannot serve", () => {
    const scheduled = recorded(tatortSunday, { state: "scheduled" });
    expect(plan([tatortFor(kim)], [tatortOnOne], [scheduled]).planned).toEqual([]);
    const unserved = plan([tatortFor(kim)], [tatortOnOne], [scheduled], {
      unserved: new Set([scheduled.id]),
    });
    expect(unserved.planned.map((item) => item.programme.id)).toEqual([tatortOnOne.id]);
  });

  it("annotates an already planned airing with the damaged recording it replaces", () => {
    const kims = tatortFor(kim);
    const failed = { ...failedSunday, ruleId: kims.id };
    const { planned } = plan([kims], [tatortOnOne], [failed]);
    expect(planned).toHaveLength(1);
    expect(planned[0]).toMatchObject({
      programme: tatortOnOne,
      ruleIds: [kims.id],
      replaces: [failed.id],
    });
  });

  it("finds Tatort on ONE for a Das Erste series recording made with seriesRule()", () => {
    expect(matchRule(erste, tatortOnOne, timeZone)).toBeUndefined();
    const { planned } = plan([erste], [tatortOnOne], [failedSunday]);
    expect(planned).toEqual([
      {
        programme: tatortOnOne,
        ruleIds: [erste.id],
        range: { start: tatortOnOne.start, end: tatortOnOne.end },
        replaces: [failedSunday.id],
      },
    ]);
  });

  it("records the same-evening F1 replay for a failed race of a Live F1: series recording", () => {
    const series = rule("live-f1", seriesRule(raceLive, noPad).matcher, {
      ownerId: kim,
      skipRepeats: true,
    });
    expect(series.matcher.title).toEqual([{ _tag: "StartsWith", values: ["Live F1:"] }]);
    expect(matchRule(series, raceReplay, timeZone)).toBeUndefined();
    const failed = {
      ...recorded(raceLive, { state: "failed", ruleId: series.id }),
      rerunUntil: at("2026-12-13T18:30:00Z"),
    };
    const { planned } = plan([series], [raceReplay], [failed], {
      now: DateTime.toEpochMillis(at("2026-11-29T19:00:00Z")),
    });
    expect(planned.map((item) => [item.programme.id, item.replaces])).toEqual([
      [raceReplay.id, [failed.id]],
    ]);
  });

  it("stops looking once the chain's search is over", () => {
    const declined = { ...failedSunday, rerunOutcome: "declined" as const };
    expect(plan([erste], [tatortOnOne], [declined]).planned).toEqual([]);
  });

  /** Jonas's own damaged copy of the same episode, Monday on WDR. */
  const jonass = tatortFor(jonas);
  const tatortMonday = programme({
    ...tatortSunday,
    id: ProgrammeId.make("tatort-wdr-monday"),
    channelId: wdr,
    start: at("2026-11-23T19:15:00Z"),
    end: at("2026-11-23T20:45:00Z"),
  });
  const failedMonday = {
    ...recorded(tatortMonday, { state: "incomplete", ruleId: jonass.id, ownerIds: [jonas] }),
    problems: [
      {
        _tag: "Gap" as const,
        range: { start: at("2026-11-23T19:30:00Z"), end: at("2026-11-23T19:40:00Z") },
      },
    ],
    rerunUntil: at("2026-12-07T20:45:00Z"),
  };

  it("lets two damaged originals on different channels share one repeat", () => {
    const { planned } = plan([erste, jonass], [tatortOnOne], [failedSunday, failedMonday]);
    expect(planned).toHaveLength(1);
    expect(planned[0]).toMatchObject({
      programme: tatortOnOne,
      replaces: [failedSunday.id, failedMonday.id],
    });
  });

  it("stops looking once a good repeat of another original holds the episode", () => {
    const goodRepeat = recorded(tatortOnOne, {
      state: "completed",
      ruleId: erste.id,
      replacesId: failedSunday.id,
    });
    const { planned } = plan(
      [erste, jonass],
      [tatortWdr],
      [failedSunday, failedMonday, goodRepeat],
    );
    expect(planned.flatMap((item) => item.replaces ?? [])).toEqual([]);
  });
});
