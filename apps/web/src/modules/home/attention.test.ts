import { describe, expect, it } from "vitest";
import { DateTime } from "effect";
import { HOUR, RecordingId, UserId, viewSource } from "@slipstream/domain";
import { makeMockData } from "~/api/mock/fixtures.ts";
import { formatClock } from "~/i18n/formats.ts";
import { attentionIssues, conflictId } from "./attention.ts";
import { issueText } from "./issue-text.ts";

const NOW = Date.UTC(2026, 10, 22, 17, 42);
const data = makeMockData(NOW);
const sources = data.sources.map(viewSource);
const base = {
  me: UserId.make("alex"),
  admin: true,
  // As the list answers: without hidden recordings (a replaced original, a chain's anchor).
  recordings: data.recordings.filter((entry) => entry.hiddenAt === undefined),
  conflicts: data.conflicts,
  sources,
  now: NOW,
  dismissed: new Set<string>(),
};

describe("attentionIssues (SPEC §8.1, §7.8)", () => {
  it("lists errors before warnings for an admin: sources, failures, then conflicts", () => {
    const issues = attentionIssues(base);
    expect(issues.map((issue) => issue.kind)).toEqual([
      "source",
      "recording",
      "recording",
      "conflict",
    ]);
    expect(issues.map((issue) => issue.tone)).toEqual(["err", "err", "err", "warn"]);
  });

  it("shows other profiles only the problems of their own recordings", () => {
    const kim = attentionIssues({ ...base, me: UserId.make("kim"), admin: false });
    expect(kim.map((issue) => issue.kind)).toEqual(["recording"]);
    // Alex no longer sees the source and conflict, only his own failed Darts semi-final.
    const alex = attentionIssues({ ...base, admin: false });
    expect(alex.map((issue) => issue.kind)).toEqual(["recording"]);
  });

  it("leaves out what this device dismissed", () => {
    const [first] = data.conflicts;
    if (first === undefined) throw new Error("fixture conflict missing");
    const issues = attentionIssues({ ...base, dismissed: new Set([conflictId(first)]) });
    expect(issues.some((issue) => issue.kind === "conflict")).toBe(false);
  });

  it("shows one card per chain, worded by the search for the repeat", () => {
    const semi = data.recordings.find((entry) => entry.id === "darts-halbfinale-failed");
    if (semi === undefined) throw new Error("fixture recording missing");
    const wednesday = Date.UTC(2026, 10, 25, 21);
    const original = { ...semi, rerun: { state: "scheduled" as const } };
    // The repeat is scheduled and replaces the original: still one card, keyed by the original.
    const repeat = {
      ...semi,
      id: RecordingId.make("darts-repeat"),
      state: "scheduled" as const,
      problems: [],
      start: DateTime.makeUnsafe(wednesday),
      end: DateTime.makeUnsafe(wednesday + HOUR),
      replacesId: semi.id,
      replaces: { recordingId: semi.id, start: semi.start, channelId: semi.channelId },
    };
    const issues = attentionIssues({
      ...base,
      recordings: [original, repeat],
      conflicts: [],
      sources: [],
    });
    expect(issues.map((issue) => issue.id)).toEqual(["recording:darts-halbfinale-failed"]);
    const [card] = issues;
    if (card === undefined) throw new Error("no card");
    expect(issueText(card, NOW, "Europe/Berlin")).toEqual({
      title: "Darts: Grand Slam - Halbfinale failed",
      text: `Recording the repeat Wed 25, ${formatClock(wednesday)} instead`,
    });
  });

  it("swaps the chain's card for a dismissable ok card for 24 hours once replaced", () => {
    const semi = data.recordings.find((entry) => entry.id === "darts-halbfinale-failed");
    if (semi === undefined) throw new Error("fixture recording missing");
    const repeat = {
      ...semi,
      id: RecordingId.make("darts-repeat"),
      state: "completed" as const,
      problems: [],
      start: DateTime.makeUnsafe(NOW - 3 * HOUR),
      end: DateTime.makeUnsafe(NOW - 2 * HOUR),
      replacesId: semi.id,
      replaces: {
        recordingId: semi.id,
        start: semi.start,
        channelId: semi.channelId,
        replacedAt: DateTime.makeUnsafe(NOW - 2 * HOUR),
      },
    };
    // The server marks the replacement (`replacedAt`); the original is hidden, so only the
    // repeat is listed.
    const shown = (now: number, dismissed: ReadonlySet<string> = new Set()) =>
      attentionIssues({
        ...base,
        now,
        recordings: [repeat],
        conflicts: [],
        sources: [],
        dismissed,
      }).map((issue) => `${issue.kind}:${issue.tone}:${issue.id}`);
    expect(shown(NOW)).toEqual(["replaced:ok:replaced:darts-halbfinale-failed"]);
    expect(shown(NOW + 20 * HOUR)).toHaveLength(1);
    expect(shown(NOW + 26 * HOUR)).toEqual([]);
    expect(shown(NOW, new Set(["replaced:darts-halbfinale-failed"]))).toEqual([]);
    const [card] = attentionIssues({ ...base, recordings: [repeat], conflicts: [], sources: [] });
    if (card === undefined) throw new Error("no card");
    expect(issueText(card, NOW, "Europe/Berlin").title).toMatch(
      /^Darts: Grand Slam - Halbfinale replaced by the repeat from (today|\S+) \d{1,2}$/u,
    );
  });

  it("says what happened and names the overlap with the stream limit", () => {
    const issues = attentionIssues(base);
    const conflict = issues.find((issue) => issue.kind === "conflict");
    if (conflict === undefined) throw new Error("no conflict issue");
    const { title, text } = issueText(conflict, NOW, "Europe/Berlin");
    expect(title).toMatch(/^Conflict (today|tomorrow) at /u);
    expect(text).toContain("but only 1 stream is free then");
    expect(text).toContain("Darts: Grand Slam - Finale");
    const failed = issues.find((issue) => issue.kind === "recording");
    if (failed === undefined) throw new Error("no recording issue");
    expect(issueText(failed, NOW, "Europe/Berlin")).toEqual({
      title: "Tagesschau failed",
      text: "The source sent no picture for the whole slot. Slipstream retried 6 times.",
    });
  });
});
