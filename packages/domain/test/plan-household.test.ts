import { describe, expect, it } from "vitest";
import { RecordingId } from "../src/ids.ts";
import {
  type HouseholdRecording,
  planHousehold,
  type PlanningAccess,
  type ServiceCandidate,
} from "../src/plan-household.ts";
import type { Programme } from "../src/programme.ts";
import { epochMs } from "../src/time.ts";
import { at, rule, timeZone } from "./test-support.ts";
import { channelNames, kim, recorded, tatortOnOne, tatortSunday } from "./episode-fixtures.ts";

const now = epochMs(at("2026-11-21T12:00:00Z"));

/** Kim's Tatort series recording on every channel, leaving out repeats. */
const tatort = rule(
  "tatort",
  { title: [{ _tag: "IsExactly", values: ["Tatort"] }] },
  { ownerId: kim, skipRepeats: true },
);

/** Access that sees everything; `unserved` answers with `blocked` and records what it was asked. */
const accessFor = (blocked: ReadonlyArray<string>) => {
  const asked: Array<ServiceCandidate> = [];
  const access: PlanningAccess = {
    history: [],
    sees: () => true,
    seesChannel: () => true,
    channelName: (id) => channelNames[id],
    unserved: (items) => {
      asked.push(...items);
      return new Set(items.flatMap((item) => (blocked.includes(item.id) ? [item.id] : [])));
    },
  };
  return { access, asked };
};

const planOver = (
  programmes: ReadonlyArray<Programme>,
  recordings: ReadonlyArray<HouseholdRecording>,
  blocked: ReadonlyArray<string>,
) => {
  const { access, asked } = accessFor(blocked);
  const plan = planHousehold({ rules: [tatort], programmes, recordings, access, now, timeZone });
  return { plan, asked };
};

describe("planHousehold (§5.2)", () => {
  it("moves an unserved item to the episode's later airing in the second pass", () => {
    const { plan } = planOver([tatortSunday, tatortOnOne], [], [tatortSunday.id]);
    expect(plan.unserved).toEqual(new Set([tatortSunday.id]));
    expect(plan.moved).toEqual(new Set([tatortSunday.id]));
    expect(plan.planned.map((item) => item.programme.id)).toEqual([
      tatortSunday.id,
      tatortOnOne.id,
    ]);
    expect(plan.context.unserved).toEqual(plan.moved);
  });

  it("keeps an unserved item planned when its episode does not air again", () => {
    const { plan } = planOver([tatortSunday], [], [tatortSunday.id]);
    expect(plan.unserved).toEqual(new Set([tatortSunday.id]));
    expect(plan.moved).toEqual(new Set());
    expect(plan.planned.map((item) => item.programme.id)).toEqual([tatortSunday.id]);
    expect(plan.context.unserved).toBeUndefined();
  });

  it("asks about active, visible fixed recordings and the plan, never derived or hidden rows", () => {
    const manual = recorded(tatortOnOne, {
      id: RecordingId.make("manual"),
      title: "Polizeiruf 110",
      state: "scheduled",
      ownerIds: [kim],
    });
    const hidden = {
      ...manual,
      id: RecordingId.make("hidden"),
      hiddenAt: at("2026-11-20T00:00:00Z"),
    };
    const derived = recorded(tatortSunday, {
      id: RecordingId.make("derived"),
      state: "scheduled",
      ruleId: tatort.id,
    });
    const { plan, asked } = planOver([tatortSunday], [manual, hidden, derived], []);
    expect(asked.map((item) => item.id).toSorted()).toEqual(["manual", tatortSunday.id].toSorted());
    expect(plan.existing.map((recording) => recording.id)).toEqual(["manual", "hidden"]);
    // The derived row is planned again from its programme.
    expect(plan.planned.map((item) => item.programme.id)).toEqual([tatortSunday.id]);
  });
});
