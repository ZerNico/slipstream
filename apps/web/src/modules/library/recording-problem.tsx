import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { m } from "@slipstream/i18n";
import { Icon } from "~/ui/icon.tsx";
import { CloseIcon, ServerIcon, WarningIcon } from "~/ui/icons.ts";
import { Button } from "~/ui/primitives/button.tsx";
import type { ProblemCopy } from "./problem-text.ts";

/**
 * What went wrong with a recording, on its detail (SPEC §8.4). Incomplete: one quiet line, how
 * much is missing and what happens about it. Failed: the red box with every reason and the fixes
 * (record the repeat, test the source).
 */
export function RecordingProblem({
  problem,
  rerun,
  recordRepeat,
}: {
  problem: ProblemCopy;
  /** What the automatic search for a repeat is doing, when there is one. */
  rerun: string | undefined;
  /** "Record the repeat" in the given weight, or nothing when there is no repeat to record. */
  recordRepeat: (variant: "primary" | "secondary") => ReactNode;
}) {
  if (!problem.failed) {
    return (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2" data-problem="">
        <p className="flex min-w-0 items-center gap-2 text-[14px] text-warn-fg">
          <Icon icon={WarningIcon} size={16} className="flex-none" />
          <span className="min-w-0">
            {[m.library_card_missing({ seconds: Math.round(problem.missingMs / 1000) }), rerun]
              .filter((part) => part !== undefined)
              .join(" · ")}
          </span>
        </p>
        {recordRepeat("secondary")}
      </div>
    );
  }
  return (
    <div className="grid gap-2.5 rounded-lg bg-live-soft p-4.5 shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--live)_35%,transparent)]">
      <h2 className="flex items-center gap-2 text-[15px] font-semibold text-live-fg">
        <Icon icon={CloseIcon} className="shrink-0" />
        <span className="min-w-0">{m.library_problem_failed()}</span>
      </h2>
      {problem.lines.length > 1 ? (
        <ul className="grid list-disc gap-1 pl-5 text-sm text-fg">
          {problem.lines.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-fg">{problem.lines[0]}</p>
      )}
      {problem.total === undefined ? null : (
        <p className="text-sm font-semibold text-fg">{problem.total}</p>
      )}
      {rerun === undefined ? null : (
        <p className="text-sm font-semibold text-fg" data-rerun="">
          {rerun}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {recordRepeat("primary")}
        <Button
          size="sm"
          icon={<Icon icon={ServerIcon} size={16} />}
          nativeButton={false}
          render={<Link to="/settings/$section" params={{ section: "sources" }} />}
        >
          {m.source_test()}
        </Button>
      </div>
    </div>
  );
}
