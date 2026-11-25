import { type SourceDraft, sourceDraftProblems } from "@slipstream/domain";
import { sourceFailureReasonText, sourceProblemTexts } from "@slipstream/i18n";
import { problemOf } from "~/api/errors.ts";
import { problemTitle } from "~/api/problem-title.ts";

/** Why a test or refresh failed, in words that point at the fix. */
export const sourceFailureText = (error: unknown): string => {
  const problem = problemOf(error);
  return problem._tag === "SourceFailed" ? sourceFailureReasonText(problem) : problemTitle(error);
};

/** Problems with the source form in words, per field; stored addresses need no new value. */
export const sourceErrors = (draft: SourceDraft, keep: { readonly playlist: boolean }) =>
  sourceProblemTexts(sourceDraftProblems(draft, keep));
