import { DateTime } from "effect";
import { afterEach, describe, expect, it } from "vitest";
import {
  MINUTE,
  RecordingId,
  type RecordingProblem,
  type RecordingState,
} from "@slipstream/domain";
import { setLocale } from "@slipstream/i18n";
import { recordingIssueText as issueTextAt } from "./issue-text.ts";

const start = Date.UTC(2026, 10, 22, 17);
const at = (minutes: number) => DateTime.makeUnsafe(start + minutes * MINUTE);
const range = (from: number, to: number) => ({ start: at(from), end: at(to) });

/** A 90 min programme with 5 min early and 10 after: the window runs from -5 to 100. */
const entry = (problems: readonly RecordingProblem[], state: RecordingState = "incomplete") => ({
  id: RecordingId.make("rennen"),
  title: "Rennen",

  state,
  start: at(0),
  end: at(90),
  padding: { beforeMinutes: 5, afterMinutes: 10 },
  problems,
  protected: false,
});

/** None of these has a repeat scheduled: the clock and zone would only name its day. */
const recordingIssueText = (recording: ReturnType<typeof entry>) =>
  issueTextAt(recording, { now: start, timeZone: "Europe/Berlin" });

/** The formatters keep a number and its unit together with no-break spaces. */
const plain = (text: string) => text.replaceAll(" ", " ");

afterEach(() => setLocale("en"));

describe("recordingIssueText (SPEC §8.1 Needs attention, §8.4 gap summary)", () => {
  it("sums every gap and counts the places, not the first gap alone", () => {
    const issue = recordingIssueText(
      entry([
        { _tag: "Gap", range: range(10, 40) },
        { _tag: "Gap", range: range(50, 75) },
        { _tag: "Gap", range: range(80, 110) },
      ]),
    );
    // 30 + 25 + 20 (clipped at the window's end) = 75 min.
    expect({ ...issue, text: plain(issue.text) }).toEqual({
      failed: false,
      title: "Rennen is incomplete",
      text: "Missing 1 h 15 min in 3 places.",
    });
    setLocale("de");
    expect(plain(recordingIssueText(entry([{ _tag: "Gap", range: range(10, 40) }])).text)).toBe(
      "Es fehlen 30 Min.",
    );
  });

  it("counts repeated and overlapping reports once", () => {
    const issue = recordingIssueText(
      entry([
        { _tag: "Gap", range: range(10, 40) },
        { _tag: "Gap", range: range(10, 40) },
        { _tag: "Gap", range: range(30, 45) },
      ]),
    );
    expect(plain(issue.text)).toBe("Missing 35 min.");
  });

  it("names the cause behind most of the missing time", () => {
    const unreachable = recordingIssueText(
      entry([
        { _tag: "Gap", range: range(10, 15) },
        { _tag: "SourceUnreachable", range: range(50, 75), retries: 2 },
      ]),
    );
    expect(plain(unreachable.text)).toBe(
      "Missing 30 min in 2 places. The source couldn't be reached.",
    );
    const busy = recordingIssueText(entry([{ _tag: "SourceLimitReached", range: range(20, 30) }]));
    expect(plain(busy.text)).toBe("Missing 10 min. Every stream of the source was busy.");
  });

  it("reads nothing captured as failed, whatever the state says", () => {
    const covered = recordingIssueText(entry([{ _tag: "Gap", range: range(-10, 120) }]));
    expect(covered).toEqual({
      failed: true,
      title: "Rennen failed",
      text: "The source sent no picture for the whole slot.",
    });
    const noData = recordingIssueText(entry([{ _tag: "NoData" }], "recording"));
    expect(noData.failed).toBe(true);
  });

  it("says why a failed recording captured nothing: every stream busy, or the retries made", () => {
    const busy = recordingIssueText(
      entry([{ _tag: "SourceLimitReached", range: range(-5, 100) }], "failed"),
    );
    expect(busy.text).toBe("Every stream of the source was busy, so nothing was captured.");
    const retried = recordingIssueText(
      entry([{ _tag: "SourceUnreachable", range: range(-5, 100), retries: 3 }], "failed"),
    );
    expect(retried.text).toBe(
      "The source sent no picture for the whole slot. Slipstream retried 3 times.",
    );
  });
});
