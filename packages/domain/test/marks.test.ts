import { describe, expect, it } from "vitest";
import { ProgrammeId, RecordingId, RuleId } from "../src/ids.ts";
import { type MarkedRecording, programmeMarks } from "../src/marks.ts";
import type { RecordingState } from "../src/recording.ts";
import { arte, at, daserste, programme } from "./test-support.ts";

const tatort = programme({
  channelId: daserste,
  title: "Tatort",
  start: at("2026-11-22T19:15:00Z"),
  end: at("2026-11-22T20:45:00Z"),
});
const tagesthemen = programme({
  channelId: daserste,
  title: "Tagesthemen",
  start: at("2026-11-22T20:45:00Z"),
  end: at("2026-11-22T21:15:00Z"),
});
const film = programme({
  channelId: arte,
  title: "Der Pate",
  start: at("2026-11-22T19:15:00Z"),
  end: at("2026-11-22T22:00:00Z"),
});

const recording = (
  id: string,
  state: RecordingState,
  of: typeof tatort | undefined,
  range?: { readonly start: string; readonly end: string },
): MarkedRecording => ({
  id: RecordingId.make(id),
  state,
  title: of?.title ?? "Manual recording",
  channelId: of?.channelId ?? daserste,
  start: range === undefined ? (of?.start ?? at("2026-11-22T19:00:00Z")) : at(range.start),
  end: range === undefined ? (of?.end ?? at("2026-11-22T19:00:00Z")) : at(range.end),
  ...(of === undefined ? {} : { programmeId: of.id }),
});

describe("programmeMarks", () => {
  it("marks running, scheduled and conflicting recordings, nothing for finished ones", () => {
    const marks = programmeMarks(
      [
        { ...recording("a", "recording", tatort), ruleId: RuleId.make("krimi") },
        recording("b", "scheduled", tagesthemen),
        recording("c", "scheduled", film),
      ],
      [{ recordingIds: [RecordingId.make("c")] }],
    );
    expect(marks.get(tatort.id)).toEqual({
      state: "recording",
      recordingId: "a",
      ruleId: "krimi",
    });
    expect(marks.get(tagesthemen.id)?.state).toBe("scheduled");
    expect(marks.get(film.id)?.state).toBe("conflict");
    const finished = programmeMarks(
      (["completed", "incomplete", "failed", "cancelled"] as const).map((state) =>
        recording(state, state, tatort),
      ),
      [],
    );
    expect(finished.size).toBe(0);
  });

  it("prefers the running recording when a programme has several", () => {
    const marks = programmeMarks(
      [recording("done", "completed", tatort), recording("again", "scheduled", tatort)].concat(
        recording("now", "recording", tatort),
      ),
      [{ recordingIds: [RecordingId.make("again")] }],
    );
    expect(marks.get(tatort.id)).toMatchObject({ state: "recording", recordingId: "now" });
  });

  it("marks every programme a manual recording covers on its channel", () => {
    const manual = recording("manual", "scheduled", undefined, {
      start: "2026-11-22T19:10:00Z",
      end: "2026-11-22T21:20:00Z",
    });
    const marks = programmeMarks([manual], [], [tatort, tagesthemen, film]);
    expect([...marks.keys()].toSorted()).toEqual([tagesthemen.id, tatort.id].toSorted());
    expect(marks.get(ProgrammeId.make(film.id))).toBeUndefined();
  });

  it("marks a programme whose guide id changed by its title and time", () => {
    const renamed = {
      ...recording("old", "scheduled", tatort),
      programmeId: ProgrammeId.make("x"),
    };
    const marks = programmeMarks([renamed], [], [tatort, tagesthemen]);
    expect(marks.get(tatort.id)).toMatchObject({ state: "scheduled", recordingId: "old" });
    expect(marks.has(tagesthemen.id)).toBe(false);
  });

  it("marks airings the viewer already has with the quiet repeat mark, below any recording", () => {
    const of = {
      recordingId: RecordingId.make("sunday"),
      start: at("2026-11-15T19:15:00Z"),
      channelId: daserste,
      state: "completed" as const,
    };
    const deleted = { start: of.start, channelId: daserste, state: "history" as const };
    const marks = programmeMarks(
      [recording("a", "scheduled", tatort)],
      [],
      [tatort, tagesthemen, film],
      [
        { programmeId: tatort.id, of },
        { programmeId: tagesthemen.id, ruleId: RuleId.make("news"), of },
        { programmeId: film.id, of: deleted },
      ],
    );
    expect(marks.get(tatort.id)?.state).toBe("scheduled");
    expect(marks.get(tagesthemen.id)).toEqual({
      state: "repeat",
      recordingId: of.recordingId,
      ruleId: RuleId.make("news"),
      of,
    });
    expect(marks.get(film.id)).toMatchObject({ state: "repeat", recordingId: undefined });
  });
});
