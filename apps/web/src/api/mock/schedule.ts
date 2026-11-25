import type { RecordingEntry } from "@slipstream/api";
import { epochMs, type Programme, RecordingId, type Rule } from "@slipstream/domain";
import { now } from "./context.ts";
import { type MockData, toEntry } from "./fixtures.ts";
import { planForRule } from "./series.ts";

/**
 * Schedules what a new rule matches from now on with the scheduler's own `planRecordings` and
 * planning context: upcoming programmes on visible channels, one recording per programme, never
 * a duplicate of one that exists, and (for "Only episodes you don't have yet") never an episode
 * its owner already has or has scheduled. Returns the new entries; the caller stores and
 * announces them.
 */
export const scheduleForRule = (data: MockData, rule: Rule, at: number): RecordingEntry[] => {
  const { planned } = planForRule(data, rule, at);
  return planned.map(({ programme }) => entryFor(data, programme, rule, at));
};

const entryFor = (data: MockData, programme: Programme, rule: Rule, at: number): RecordingEntry => {
  const { id: programmeId, ...info } = programme;
  return toEntry(
    {
      id: RecordingId.make(crypto.randomUUID()),
      programmeId,
      ...info,
      padding: rule.padding,
      state: epochMs(programme.start) <= at ? "recording" : "scheduled",
      problems: [],
      ruleId: rule.id,
      ownerIds: [rule.ownerId],
      protected: false,
      labels: [],
      exportStatus: "none",
      createdAt: now(),
    },
    data,
    0,
  );
};
