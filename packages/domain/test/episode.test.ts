import { DateTime } from "effect";
import { describe, expect, it } from "vitest";
import {
  type EpisodeContext,
  episodeIdentity,
  episodeIndex,
  type EpisodeRecording,
  type EpisodeSubject,
  findRepeat,
  findRepeatAiring,
  genericSubtitles,
  historyEntryFor,
  isIdentifyingSubtitle,
  needsRepeat,
  repeatGapThresholdMs,
  sameEpisode,
  showKey,
} from "../src/episode.ts";
import type { ChannelId, UserId } from "../src/ids.ts";
import { matchRule } from "../src/rule.ts";
import { recordEveryKind, seriesRule } from "../src/series-rule.ts";
import { at, daserste, rule, timeZone } from "./test-support.ts";
import {
  brisant,
  bundesligaSaturday,
  bundesligaSunday,
  context,
  jonas,
  kim,
  lanz,
  lanzRepeat,
  one,
  pate,
  pateAgain,
  pateNoYear,
  raceAbuDhabi,
  raceHighlights,
  raceLive,
  raceNextMorning,
  raceNextYear,
  raceReplay,
  raceUnmarkedEvening,
  recorded,
  sportschau,
  sportschauLastWeek,
  tagesschauLive,
  tagesschauMidnight,
  tagesschauNoon,
  tagesschauToday,
  tagesschauYesterday,
  tatortFernsehfilm,
  tatortOnOne,
  tatortOtherStory,
  tatortSunday,
  tatortWdr,
  wdr,
} from "./episode-fixtures.ts";

/** Whether `airing` is left out because Kim has `earlier` (the §4.3 "Result" column). */
const leftOut = (
  airing: EpisodeSubject,
  earlier: EpisodeRecording,
  ctx: EpisodeContext = context,
): boolean =>
  findRepeat(airing, episodeIndex([earlier], []), { ...ctx, ownerId: kim }) !== undefined;

describe("show key", () => {
  it("strips Live and repeat markers so the live race and its replay share one key", () => {
    expect(showKey("Live F1: Rennen - GP Katar")).toBe("f1: rennen - gp katar");
    expect(showKey("F1: Rennen - GP Katar (Wh.)")).toBe("f1: rennen - gp katar");
    expect(showKey("Markus  Lanz (Wdh.)")).toBe("markus lanz");
  });
});

describe("worked examples (§4.3)", () => {
  it("Tatort 1247 on ONE on Tuesday is left out after Sunday's Das Erste recording", () => {
    const sunday = recorded(tatortSunday);
    const of = findRepeat(tatortOnOne, episodeIndex([sunday], []), { ...context, ownerId: kim });
    expect(of).toEqual({
      recordingId: sunday.id,
      start: tatortSunday.start,
      channelId: daserste,
      state: "completed",
    });
  });

  it("Tatort “Unter Wölfen” without numbers on WDR is left out (sub-titles equal)", () => {
    expect(leftOut(tatortWdr, recorded(tatortSunday))).toBe(true);
  });

  it("Tatort categorised Fernsehfilm with a sub-title is an Episode and offers Record series", () => {
    expect(episodeIdentity(tatortFernsehfilm, context)._tag).toBe("Episode");
    expect(recordEveryKind(tatortFernsehfilm, context)).toBe("series");
  });

  it("Tatort with the same sub-title but another story is recorded (description guard)", () => {
    expect(leftOut(tatortOtherStory, recorded(tatortSunday))).toBe(false);
  });

  it("Live F1: Rennen - GP Katar with nothing earlier is recorded", () => {
    expect(findRepeat(raceLive, episodeIndex([], []), { ...context, ownerId: kim })).toBe(
      undefined,
    );
  });

  it("the marked replay the same evening is left out after the live race", () => {
    expect(leftOut(raceReplay, recorded(raceLive))).toBe(true);
  });

  it("the same replay is found as the repeat of a failed live race, which the matcher misses", () => {
    const series = rule(
      "live-f1",
      seriesRule(raceLive, { beforeMinutes: 0, afterMinutes: 0 }).matcher,
    );
    expect(matchRule(series, raceReplay, timeZone)).toBeUndefined();
    const failed = recorded(raceLive, { state: "failed" });
    expect(findRepeatAiring(failed, [raceReplay, raceHighlights], context)).toBe(raceReplay);
  });

  it("the unmarked not-live replay next morning within 20 % of the length is left out", () => {
    expect(leftOut(raceNextMorning, recorded(raceLive))).toBe(true);
  });

  it("F1: Rennen Highlights is recorded (another show key)", () => {
    expect(leftOut(raceHighlights, recorded(raceLive))).toBe(false);
  });

  it("next year's race is recorded (not the same or next day)", () => {
    expect(leftOut(raceNextYear, recorded(raceLive))).toBe(false);
  });

  it("next week's GP Abu Dhabi is recorded (another title)", () => {
    expect(leftOut(raceAbuDhabi, recorded(raceLive))).toBe(false);
  });

  it("Tagesschau 20:00 every day is recorded (not marked)", () => {
    expect(leftOut(tagesschauToday, recorded(tagesschauYesterday))).toBe(false);
  });

  it("Tagesschau 20:00 flagged live and the 00:00 edition are both recorded", () => {
    expect(leftOut(tagesschauMidnight, recorded(tagesschauLive))).toBe(false);
    expect(leftOut(tagesschauLive, recorded(tagesschauYesterday))).toBe(false);
  });

  it("Tagesschau 20:00 and 12:00 the same day are both recorded (neither marked)", () => {
    expect(leftOut(tagesschauToday, recorded(tagesschauNoon))).toBe(false);
  });

  it("Brisant with the generic sub-title “Das Magazin” is recorded every day", () => {
    const generic = genericSubtitles(brisant, timeZone);
    const ctx = { ...context, genericSubtitles: generic };
    const [yesterday, today] = brisant.slice(-2);
    expect(episodeIdentity(today!, ctx)._tag).toBe("Broadcast");
    expect(leftOut(today!, recorded(yesterday!), ctx)).toBe(false);
  });

  it("Markus Lanz (Wdh.) the next night is left out", () => {
    expect(leftOut(lanzRepeat, recorded(lanz))).toBe(true);
  });

  it("Der Pate (1972) is left out after Der Pate (1972)", () => {
    expect(leftOut(pateAgain, recorded(pate))).toBe(true);
  });

  it("Der Pate without a year in the guide is recorded", () => {
    expect(leftOut(pateNoYear, recorded(pate))).toBe(false);
  });

  it("Sportschau on Saturday is recorded after last Saturday's (not marked)", () => {
    expect(leftOut(sportschau, recorded(sportschauLastWeek))).toBe(false);
  });
});

describe("identifying sub-titles", () => {
  const base = { title: "Tatort", channelId: daserste, categories: ["Krimi"] };

  it("refuses dates, weekdays, repeat markers, the show, the channel and categories", () => {
    const refused = [
      "",
      "22.11.2026",
      "22. November",
      "Sonntag",
      "vom 22.11.",
      "(Wh.)",
      "Tatort",
      "Das Erste",
      "Krimi",
    ];
    expect(
      refused.filter((subtitle) => isIdentifyingSubtitle({ ...base, subtitle }, context)),
    ).toEqual([]);
    expect(isIdentifyingSubtitle({ ...base, subtitle: "Unter Wölfen" }, context)).toBe(true);
  });

  it("calls a sub-title on five days with changing descriptions generic", () => {
    const generic = genericSubtitles(brisant, timeZone);
    expect(generic.has("brisant\u0000das magazin")).toBe(true);
    expect(isIdentifyingSubtitle(brisant[0]!, { ...context, genericSubtitles: generic })).toBe(
      false,
    );
  });

  it("keeps a Tatort repeated three times with its one description an Episode", () => {
    const repeats = [tatortSunday, tatortOnOne, tatortOtherStory].map((airing) => ({
      ...airing,
      description: tatortSunday.description,
    }));
    const generic = genericSubtitles(repeats, timeZone);
    expect(generic.size).toBe(0);
    expect(episodeIdentity(tatortWdr, { ...context, genericSubtitles: generic })._tag).toBe(
      "Episode",
    );
  });

  it("calls a sub-title on three days without any description generic", () => {
    const bare = brisant.slice(0, 3).map(({ description: _d, ...airing }) => airing);
    expect(genericSubtitles(bare, timeZone).has("brisant\u0000das magazin")).toBe(true);
    expect(genericSubtitles(bare.slice(0, 2), timeZone).size).toBe(0);
  });
});

describe("identity classes (§4.1)", () => {
  it("puts live and unnumbered sport first, as Events", () => {
    expect(episodeIdentity(raceLive, context)._tag).toBe("Event");
    expect(episodeIdentity(sportschau, context)._tag).toBe("Event");
  });

  it("sorts numbered or sub-titled shows as Episodes, films by category, the rest as Broadcasts", () => {
    expect(episodeIdentity(tatortSunday, context)._tag).toBe("Episode");
    expect(episodeIdentity(pate, context)).toEqual({
      _tag: "Film",
      showKey: "der pate",
      year: 1972,
    });
    expect(episodeIdentity(lanz, context)._tag).toBe("Broadcast");
  });

  it("derives Record every from the identity for every fixture", () => {
    const fixtures = [
      tatortSunday,
      tatortOnOne,
      tatortWdr,
      tatortFernsehfilm,
      tatortOtherStory,
      raceLive,
      raceReplay,
      raceNextMorning,
      raceHighlights,
      tagesschauToday,
      tagesschauLive,
      ...brisant,
      lanz,
      lanzRepeat,
      pate,
      pateNoYear,
      sportschau,
    ];
    const expected = {
      Episode: "series",
      Event: "broadcasts",
      Broadcast: "broadcasts",
      Film: "none",
    };
    expect(fixtures.map((airing) => recordEveryKind(airing, context))).toEqual(
      fixtures.map((airing) => expected[episodeIdentity(airing, context)._tag]),
    );
  });
});

describe("same episode (§4.2)", () => {
  it("matches an Event replay without a sub-title to the live airing that has one", () => {
    expect(raceReplay.subtitle).toBeUndefined();
    expect(sameEpisode(raceLive, raceReplay, context)).toBe(true);
  });

  it("keeps the Event window to the same or the next local calendar day", () => {
    const twoDaysLater = {
      ...raceReplay,
      start: at("2026-12-01T09:00:00Z"),
      end: at("2026-12-01T11:00:00Z"),
    };
    // 00:30 in Berlin is still the next local day of a Sunday-evening race.
    const justAfterMidnight = {
      ...raceReplay,
      start: at("2026-11-29T23:30:00Z"),
      end: at("2026-11-30T01:30:00Z"),
    };
    expect(sameEpisode(raceLive, justAfterMidnight, context)).toBe(true);
    expect(sameEpisode(raceLive, twoDaysLater, context)).toBe(false);
  });

  it("needs a positive signal for an unmarked replay: the sub-title again, or within 12 h", () => {
    // Saturday's live match and Sunday's unflagged one: same show, next day, not live, the same
    // length, but neither a sub-title nor closeness says replay.
    expect(sameEpisode(bundesligaSaturday, bundesligaSunday, context)).toBe(false);
    expect(leftOut(bundesligaSunday, recorded(bundesligaSaturday))).toBe(false);
    // Within 12 hours of the race's end, no sub-title is needed.
    expect(raceUnmarkedEvening.subtitle).toBeUndefined();
    expect(sameEpisode(raceLive, raceUnmarkedEvening, context)).toBe(true);
    // Past 12 hours the equal sub-title carries it; without it the replay is recorded.
    const { subtitle: _subtitle, ...bare } = raceNextMorning;
    expect(sameEpisode(raceLive, raceNextMorning, context)).toBe(true);
    expect(sameEpisode(raceLive, bare, context)).toBe(false);
    // A marked replay needs neither.
    expect(sameEpisode(bundesligaSaturday, { ...bundesligaSunday, repeat: true }, context)).toBe(
      true,
    );
  });

  it("needs the later Event's length within 20 % for the live to not-live inference", () => {
    const short = { ...raceNextMorning, end: at("2026-11-30T10:30:00Z") };
    expect(sameEpisode(raceLive, raceNextMorning, context)).toBe(true);
    expect(sameEpisode(raceLive, short, context)).toBe(false);
  });

  it("does not infer a Broadcast repeat from live to not live", () => {
    expect(sameEpisode(tagesschauLive, tagesschauMidnight, context)).toBe(false);
    expect(sameEpisode(tagesschauLive, { ...tagesschauMidnight, repeat: true }, context)).toBe(
      true,
    );
  });

  it("guards Episodes with different descriptions, but not short ones", () => {
    expect(sameEpisode(tatortSunday, tatortOtherStory, context)).toBe(false);
    expect(
      sameEpisode(
        { ...tatortSunday, description: "Krimi" },
        { ...tatortOtherStory, description: "Krimi aus Münster" },
        context,
      ),
    ).toBe(true);
  });

  it("trusts equal sub-titles over unequal numbers, and unequal sub-titles over equal numbers", () => {
    const renumbered = { ...tatortOnOne, episode: { episode: 1300 } };
    expect(sameEpisode(tatortSunday, renumbered, context)).toBe(true);
    const otherTitle = { ...tatortOnOne, subtitle: "Schattenmann" };
    expect(sameEpisode(tatortSunday, otherTitle, context)).toBe(false);
  });
});

const gap = (fromIso: string, toIso: string) => ({
  _tag: "Gap" as const,
  range: { start: at(fromIso), end: at(toIso) },
});

/** Whether a person sees a copy: only their own. */
const ownCopies = (owner: UserId, copy: EpisodeRecording) => copy.ownerIds.includes(owner);

describe("needs a repeat (§5.1)", () => {
  const base = recorded(tatortSunday);

  it("counts failed recordings and a minute missing from the programme itself", () => {
    expect(needsRepeat({ ...base, state: "failed" })).toBe(true);
    expect(needsRepeat(base)).toBe(false);
    const minute = DateTime.makeUnsafe(
      DateTime.toEpochMillis(tatortSunday.start) + repeatGapThresholdMs,
    );
    expect(
      needsRepeat({
        ...base,
        state: "incomplete",
        problems: [{ _tag: "Gap", range: { start: tatortSunday.start, end: minute } }],
      }),
    ).toBe(true);
  });

  it("ignores gaps in the extra time and stalls under a minute", () => {
    const padded = {
      ...base,
      state: "incomplete" as const,
      padding: { beforeMinutes: 5, afterMinutes: 10 },
    };
    expect(
      needsRepeat({ ...padded, problems: [gap("2026-11-22T19:10:00Z", "2026-11-22T19:15:00Z")] }),
    ).toBe(false);
    expect(
      needsRepeat({ ...padded, problems: [gap("2026-11-22T19:30:00Z", "2026-11-22T19:30:40Z")] }),
    ).toBe(false);
  });
});

describe("find repeat", () => {
  it("counts only copies the owner sees, and never failed, hidden or damaged ones", () => {
    const index = episodeIndex([recorded(tatortSunday)], []);
    expect(
      findRepeat(tatortOnOne, index, { ...context, ownerId: jonas, sees: ownCopies }),
    ).toBeUndefined();
    for (const copy of [
      recorded(tatortSunday, { state: "failed" }),
      recorded(tatortSunday, { hiddenAt: at("2026-11-23T00:00:00Z") }),
      recorded(tatortSunday, {
        state: "incomplete",
        problems: [{ _tag: "Gap", range: { start: tatortSunday.start, end: tatortSunday.end } }],
      }),
    ]) {
      expect(
        findRepeat(tatortOnOne, episodeIndex([copy], []), { ...context, ownerId: kim }),
      ).toBeUndefined();
    }
  });

  it("does not count a scheduled copy the conflict result cannot serve", () => {
    const scheduled = recorded(tatortSunday, { state: "scheduled" });
    const index = episodeIndex([scheduled], []);
    expect(findRepeat(tatortOnOne, index, { ...context, ownerId: kim })?.state).toBe("scheduled");
    expect(
      findRepeat(tatortOnOne, index, {
        ...context,
        ownerId: kim,
        unserved: new Set([scheduled.id]),
      }),
    ).toBeUndefined();
  });

  it("finds a deleted episode in the owner's history only", () => {
    const row = historyEntryFor(tatortSunday, { userId: kim }, context);
    const index = episodeIndex([], [row]);
    expect(findRepeat(tatortOnOne, index, { ...context, ownerId: kim })).toEqual({
      start: tatortSunday.start,
      channelId: daserste,
      state: "history",
    });
    expect(findRepeat(tatortOnOne, index, { ...context, ownerId: jonas })).toBeUndefined();
  });
});

/** Jonas does not get ONE. */
const seesChannel = (owner: UserId, channel: ChannelId) => !(owner === jonas && channel === one);

/** Kim, limited to collections, would not see a Tatort recorded on WDR. */
const sees = (owner: UserId, recording: { readonly channelId: ChannelId }) =>
  !(owner === kim && recording.channelId === wdr);

describe("find repeat airing (§3.7)", () => {
  const failed = recorded(tatortSunday, {
    state: "failed",
    ruleId: rule("tatort", {}).id,
  });

  it("finds Tatort on ONE although the series recording is on Das Erste", () => {
    expect(findRepeatAiring(failed, [tatortOnOne], context)).toBe(tatortOnOne);
  });

  it("skips airings before the end, after the deadline or on hidden channels", () => {
    const until = { ...failed, rerunUntil: at("2026-11-24T00:00:00Z") };
    expect(findRepeatAiring(until, [tatortOnOne], context)).toBeUndefined();
    expect(
      findRepeatAiring(failed, [tatortOnOne], { ...context, seesChannel: (_o, c) => c !== one }),
    ).toBeUndefined();
  });

  it("accepts only an airing every owner of the original may see", () => {
    const shared = { ...failed, ownerIds: [kim, jonas] };
    // Jonas does not get ONE: the repeat goes to WDR, which both see.
    expect(findRepeatAiring(shared, [tatortOnOne, tatortWdr], { ...context, seesChannel })).toBe(
      tatortWdr,
    );
    // With Kim alone, ONE is the earliest airing.
    expect(findRepeatAiring(failed, [tatortOnOne, tatortWdr], { ...context, seesChannel })).toBe(
      tatortOnOne,
    );
    // A collection-limited owner must see where the repeat lands, not only its channel.
    expect(
      findRepeatAiring(shared, [tatortOnOne, tatortWdr], { ...context, seesChannel, sees }),
    ).toBeUndefined();
  });

  it("prefers an airing the conflict result can serve", () => {
    expect(
      findRepeatAiring(failed, [tatortOnOne, tatortWdr], {
        ...context,
        unserved: new Set([tatortOnOne.id]),
      }),
    ).toBe(tatortWdr);
    expect(findRepeatAiring(failed, [tatortOnOne, tatortWdr], context)).toBe(tatortOnOne);
  });
});
