/**
 * Words about sources that every client shows (web and phone). The failure type mirrors
 * @slipstream/api (`SourceFailed`) structurally, so this package needs the domain for types only.
 */
import type { SourceConfig, SourceProblem, SourceProblems } from "@slipstream/domain";
import { m } from "./runtime.ts";

/** A source's kind: the `_tag` of its config. */
export type SourceKind = SourceConfig["_tag"];

/** A source's kind in words ("M3U playlist"). */
export const sourceKindText = (kind: SourceKind): string => {
  switch (kind) {
    case "M3u":
      return m.source_kind_m3u();
    case "Xtream":
      return m.source_kind_xtream();
    case "HdHomeRun":
      return m.source_kind_hdhomerun();
    case "Url":
      return m.source_kind_url();
  }
};

/** Why a test or refresh failed: the `SourceFailed` error of @slipstream/api. */
export interface SourceFailure {
  readonly reason: "unreachable" | "httpError" | "invalidPlaylist" | "invalidGuide" | "tooLarge";
  readonly httpStatus?: number | undefined;
}

/** Why a test or refresh failed, in words that point at the fix. */
export const sourceFailureReasonText = (failure: SourceFailure): string => {
  switch (failure.reason) {
    case "unreachable":
      return m.source_failed_unreachable();
    case "httpError":
      return m.source_failed_http(
        failure.httpStatus === undefined ? {} : { status: failure.httpStatus },
      );
    case "invalidPlaylist":
      return m.source_failed_playlist();
    case "invalidGuide":
      return m.source_failed_guide();
    case "tooLarge":
      return m.source_failed_too_large();
  }
};

const problemText = (problem: SourceProblem | undefined): string | undefined => {
  switch (problem) {
    case "nameMissing":
      return m.source_name_missing();
    case "urlInvalid":
      return m.source_url_invalid();
    case undefined:
      return undefined;
  }
};

/** The source form's problems (`sourceDraftProblems`) in words, per field. */
export const sourceProblemTexts = (
  problems: SourceProblems,
): { name?: string; playlist?: string; guide?: string } => {
  const name = problemText(problems.name);
  const playlist = problemText(problems.playlist);
  const guide = problemText(problems.guide);
  return {
    ...(name === undefined ? {} : { name }),
    ...(playlist === undefined ? {} : { playlist }),
    ...(guide === undefined ? {} : { guide }),
  };
};
