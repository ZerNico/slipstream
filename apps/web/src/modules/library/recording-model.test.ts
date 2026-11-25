import { rerunText } from "@slipstream/i18n";
import { describe, expect, it } from "vitest";
import { DateTime } from "effect";
import {
  ChannelId,
  HOUR,
  MINUTE,
  problemChains,
  RecordingId,
  replacedCardMillis,
  replacedChains,
  RuleId,
  type RerunView,
} from "@slipstream/domain";
import { makeMockData, mockTimeZone } from "~/api/mock/fixtures.ts";
import { formatClock } from "~/i18n/formats.ts";
import { deleteChoice, deleteRequest } from "./detail.ts";
import { draftFromCollection, draftToUpdate, emptyDraft, opensAdvanced } from "./editor.ts";
import type { Entry } from "./library.ts";
import { seriesOffers } from "./offers.ts";
import { followsSummary } from "./words.ts";

/*
 * The library's side of the recording model (docs/design/recording-model.md §3.3–§3.7): the
 * collection editor's Advanced disclosure and linked collections, the series offer, the
 * delete confirm's variants, the repeat search in words and one card per chain.
 */

const NOW = Date.UTC(2026, 10, 22, 17, 42);
const data = makeMockData(NOW);
const at = (millis: number) => DateTime.makeUnsafe(millis);

const byId = (id: string): Entry => {
  const entry = data.recordings.find((item) => item.id === id);
  if (!entry) throw new Error(`no fixture recording ${id}`);
  return entry;
};
const formel1 = () => {
  const collection = data.collections.find((item) => item.id === "formel-1");
  if (!collection) throw new Error("no fixture collection formel-1");
  return collection;
};

/** A damaged recording of a series recording, with gaps over most of its programme. */
const damaged = (rerun: RerunView, overrides: Partial<Entry> = {}): Entry => ({
  ...byId("tatort-unter-woelfen"),
  state: "incomplete",
  problems: [
    {
      _tag: "Gap",
      range: { start: at(NOW - 80 * MINUTE), end: at(NOW - 60 * MINUTE) },
    },
  ],
  start: at(NOW - 90 * MINUTE),
  end: at(NOW),
  rerun,
  ...overrides,
});

describe("collection editor: Advanced and linked collections (§3.5)", () => {
  it("keeps Advanced closed for conditions, open when they are empty", () => {
    const existing = draftFromCollection(formel1());
    expect(opensAdvanced(existing)).toBe(false);
    expect(opensAdvanced(emptyDraft)).toBe(true);
    // Invalid: a name but nothing that says what belongs in it.
    expect(opensAdvanced({ ...emptyDraft, name: "Formel 1" })).toBe(true);
  });

  it("never sends the conditions of a collection that follows a series recording", () => {
    const linked = draftFromCollection({
      ...formel1(),
      follows: { ruleId: RuleId.make("formel-1-live"), ruleName: "Formel 1 live" },
    });
    const update = draftToUpdate({ ...linked, name: "F1" });
    expect(update).not.toHaveProperty("matcher");
    expect(update.name).toBe("F1");
    expect(draftToUpdate(draftFromCollection(formel1()))).toHaveProperty("matcher");
  });

  it("says what a linked collection follows in words", () => {
    const names: Record<string, string> = { "sky-sport-f1": "Sky Sport F1" };
    const channelName = (id: string) => names[id] ?? id;
    expect(
      followsSummary(
        {
          channels: [ChannelId.make("sky-sport-f1")],
          title: [{ _tag: "StartsWith", values: ["Live F1:"] }],
          categories: [],
        },
        channelName,
      ),
    ).toBe("Sky Sport F1, titles starting with “Live F1:”");
    expect(followsSummary({ channels: [], title: [], categories: ["Sport"] }, channelName)).toBe(
      "any channel, category Sport",
    );
  });
});

describe("the series offer (§3.3)", () => {
  const context = { timeZone: mockTimeZone };
  it("offers a series recording whose programmes scatter, never one that has a collection", () => {
    const offers = seriesOffers(data.rules, data.recordings, data.collections, context);
    expect(offers.map((item) => item.rule.id)).toEqual(["live-f1-academy"]);
    expect(offers[0]?.offer.groups).toBe(3);
    const declined = data.rules.map((rule) => ({ ...rule, offerDeclined: true }));
    expect(seriesOffers(declined, data.recordings, data.collections, context)).toEqual([]);
  });
});

describe("the delete confirm (§3.6, §3.7)", () => {
  const id = RecordingId.make("x");

  it("offers a good episode of “Only episodes you don't have yet” to be recorded again", () => {
    const episode = byId("tatort-unter-woelfen");
    expect(deleteChoice(episode, { skipRepeats: true })).toBe("episode");
    expect(deleteChoice(episode, { skipRepeats: false })).toBe("plain");
    const { ruleId: _ruleId, ...byHand } = episode;
    expect(deleteChoice(byHand, undefined)).toBe("plain");
    expect(deleteRequest(id, "episode", false)).toEqual({ id });
    expect(deleteRequest(id, "episode", true)).toEqual({ id, history: "skip" });
  });

  it("lets a damaged recording that still looks for its repeat stop looking", () => {
    const looking = damaged({ state: "looking", until: at(NOW + 14 * 24 * HOUR) });
    expect(deleteChoice(looking, { skipRepeats: true })).toBe("damaged");
    expect(deleteChoice(damaged({ state: "exhausted" }), { skipRepeats: true })).toBe("plain");
    expect(deleteRequest(id, "damaged", false)).toEqual({ id });
    expect(deleteRequest(id, "damaged", true)).toEqual({ id, rerun: "stop" });
    expect(deleteRequest(id, "plain", true)).toEqual({ id });
  });
});

describe("where the search for the repeat stands (§3.7, §9)", () => {
  const wednesday = Date.UTC(2026, 10, 25, 21);
  const repeat = {
    recordingId: RecordingId.make("r"),
    start: at(wednesday),
    channelId: ChannelId.make("one"),
  };

  it("words every state", () => {
    const line = (rerun: RerunView, overrides: Partial<Entry> = {}) =>
      rerunText(damaged(rerun, overrides), NOW, mockTimeZone);
    const clock = formatClock(wednesday);
    expect(line({ state: "scheduled", repeat })).toBe(`Recording the repeat Wed 25, ${clock}`);
    expect(
      line({ state: "scheduled", repeat }, { state: "failed", problems: [{ _tag: "NoData" }] }),
    ).toBe(`Recording the repeat Wed 25, ${clock}`);
    expect(line({ state: "looking", until: at(Date.UTC(2026, 11, 6, 12)) })).toBe(
      "Looking for a repeat until Sun 6",
    );
    expect(line({ state: "exhausted" })).toBe("No repeat found");
    expect(line({ state: "kept", repeat })).toBe("Repeat recorded too");
    expect(line({ state: "kept", repeat }, { protected: true })).toBe(
      "Kept because it is protected",
    );
    expect(line({ state: "declined" })).toBeUndefined();
    const { rerun: _rerun, ...noSearch } = damaged({ state: "exhausted" });
    expect(rerunText(noSearch, NOW, mockTimeZone)).toBeUndefined();
  });
});

describe("one card per chain (§3.7)", () => {
  const original = damaged({ state: "scheduled" }, { id: RecordingId.make("original") });
  const { rerun: _rerun, ...withoutSearch } = original;
  const failedRepeat: Entry = {
    ...withoutSearch,
    id: RecordingId.make("repeat-1"),
    state: "failed",
    problems: [{ _tag: "NoData" }],
    start: at(NOW + HOUR),
    end: at(NOW + 2 * HOUR),
    replacesId: original.id,
    replaces: { recordingId: original.id, start: original.start, channelId: original.channelId },
  };

  it("keys a chain by its original and shows the original while it is listed", () => {
    expect(problemChains([original, failedRepeat]).map((entry) => entry.id)).toEqual(["original"]);
    // Once the original is gone from the list, the newest damaged repeat stands for the chain.
    expect(problemChains([failedRepeat]).map((entry) => entry.id)).toEqual(["repeat-1"]);
  });

  it("gives way to an ok card once the repeat replaced it, for 24 hours", () => {
    const replacedAt = NOW - 2 * HOUR;
    const ref = { recordingId: original.id, start: original.start, channelId: original.channelId };
    const good: Entry = {
      ...failedRepeat,
      id: RecordingId.make("repeat-2"),
      state: "completed",
      problems: [],
      start: at(NOW - 3 * HOUR),
      end: at(replacedAt),
      replaces: { ...ref, replacedAt: at(replacedAt) },
    };
    // The original is hidden (replaced): no problem card, one ok card keyed by the chain.
    expect(problemChains([good])).toEqual([]);
    expect(replacedChains([good], replacedAt + HOUR).map((chain) => chain.key)).toEqual([
      "replaced:original",
    ]);
    expect(replacedChains([good], replacedAt + replacedCardMillis)).toEqual([]);
    // The card follows the server's `replacedAt`, not whether the original happens to be listed:
    // a list that still holds it (a stale page) shows the card all the same.
    expect(replacedChains([original, good], replacedAt + HOUR)).toHaveLength(1);
    // Without `replacedAt` (kept, or not replaced yet) there is no card, original listed or not.
    const kept: Entry = { ...good, replaces: ref };
    expect(replacedChains([kept], replacedAt + HOUR)).toEqual([]);
  });
});
