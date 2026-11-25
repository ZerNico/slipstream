/**
 * Needs attention (SPEC §8.1, §7.8, §7.9): the same issue list the Recordings badge and the
 * Problems tab count, filtered per profile. Admins see conflicts and sources too; everyone else
 * sees the problems of their own recordings. A damaged recording and its repeats are one card
 * (recording model §3.7), which gives way to a short-lived ok card once the repeat replaced it.
 * Pure, so the order and the filter are tested.
 */
import type { RecordingEntry, ScheduleConflict } from "@slipstream/api";
import {
  chainOf,
  type ConflictRoom,
  conflictRoom,
  epochMs,
  problemChains,
  recordingGapSummary,
  type ReplacedChain,
  replacedChains,
  scheduledRepeatStart,
  type SourceView,
  type UserId,
} from "@slipstream/domain";

/** One thing that needs attention, with what it is about. */
export type Issue =
  | {
      readonly id: string;
      readonly tone: "err" | "warn";
      readonly kind: "recording";
      readonly entry: RecordingEntry;
      /** When the repeat that replaces it airs, epoch ms, while one is scheduled. */
      readonly repeatAt?: number | undefined;
    }
  | {
      readonly id: string;
      readonly tone: "warn";
      readonly kind: "conflict";
      readonly conflict: ScheduleConflict;
      readonly titles: readonly string[];
      /** How many can record then, as the copy may state it. */
      readonly room: ConflictRoom;
    }
  | {
      readonly id: string;
      readonly tone: "err" | "warn";
      readonly kind: "source";
      readonly source: SourceView;
    }
  | {
      readonly id: string;
      readonly tone: "ok";
      readonly kind: "replaced";
      readonly chain: ReplacedChain<RecordingEntry>;
    };

/** What the issue list is made from. */
export interface AttentionData {
  readonly me: UserId;
  readonly admin: boolean;
  /** Now, epoch ms: the "replaced" card lasts 24 hours. */
  readonly now: number;
  readonly recordings: readonly RecordingEntry[];
  readonly conflicts: readonly ScheduleConflict[];
  readonly sources: readonly SourceView[];
  /** Ids this device dismissed (client-only, SPEC: dismissed attention cards). */
  readonly dismissed: ReadonlySet<string>;
}

/** The stable id of a conflict: its recordings and its start, so a changed overlap reappears. */
export const conflictId = (conflict: ScheduleConflict): string =>
  `conflict:${epochMs(conflict.range.start)}:${conflict.recordingIds.toSorted().join("+")}`;

/** The id of a recording's card: one per chain, named by the original (`chainOf`). */
export const recordingIssueId = (entry: Pick<RecordingEntry, "id" | "replacesId">): string =>
  `recording:${chainOf(entry)}`;

/** Problems first, then good news. */
const toneRank = { err: 0, warn: 1, ok: 2 } as const;

/**
 * Every issue this profile should see, most severe first (errors, then warnings, then good
 * news), newest recording problems first inside each tone, without the dismissed
 * ones.
 */
export const attentionIssues = (data: AttentionData): readonly Issue[] => {
  const issues: Issue[] = [];
  const own = data.recordings.filter((entry) => data.admin || entry.ownerIds.includes(data.me));
  if (data.admin) {
    for (const conflict of data.conflicts) {
      issues.push({
        id: conflictId(conflict),
        tone: "warn",
        kind: "conflict",
        conflict,
        titles: conflict.recordingIds.flatMap((id) => {
          const entry = data.recordings.find((candidate) => candidate.id === id);
          return entry === undefined ? [] : [entry.title];
        }),
        room: conflictRoom(conflict, data.sources),
      });
    }
    for (const source of data.sources) {
      if (!source.enabled) continue;
      if (source.health === "unreachable" || source.health === "limitReached") {
        issues.push({
          id: `source:${source.id}:${source.health}`,
          tone: source.health === "unreachable" ? "err" : "warn",
          kind: "source",
          source,
        });
      }
    }
  }
  for (const entry of problemChains(own)) {
    issues.push({
      id: recordingIssueId(entry),
      // Failed by the shared reading: nothing usable captured, whatever the state says.
      tone: recordingGapSummary(entry).failed ? "err" : "warn",
      kind: "recording",
      entry,
      repeatAt: scheduledRepeatStart(entry, own),
    });
  }
  for (const chain of replacedChains(own, data.now)) {
    issues.push({ id: chain.key, tone: "ok", kind: "replaced", chain });
  }
  return issues
    .filter((issue) => !data.dismissed.has(issue.id))
    .map((issue, index) => ({ issue, index }))
    .toSorted((a, b) => toneRank[a.issue.tone] - toneRank[b.issue.tone] || a.index - b.index)
    .map(({ issue }) => issue);
};
