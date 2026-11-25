/**
 * Tells an upstream refusal (the provider's connection limit) from an ordinary failure, using
 * what ffmpeg printed for a run that produced no segment. Providers at their limit answer
 * 403, 429 or 509, or accept the request and close it before the first byte (PLAN 6.1).
 */
import { type CaptureRun } from "./capture/model.ts";

/** HTTP statuses IPTV panels send at their connection limit. */
const LIMIT_STATUSES: ReadonlySet<number> = new Set([403, 429, 509]);

/** A run that ended without data faster than this, on garbage or end of file, was refused. */
const IMMEDIATE_MS = 5000;

/** How a run without a single segment failed. */
export type EmptyRunCause =
  | { readonly _tag: "Refused"; readonly httpStatus: number | undefined }
  | { readonly _tag: "Unreachable" };

/**
 * The HTTP status in an ffmpeg log line: the http protocol warns "HTTP error 509 Bandwidth Limit
 * Exceeded" before the input error, which only says "5XX Server Error reply" for unusual codes.
 */
export const httpStatusIn = (line: string): number | undefined => {
  const match = /HTTP error (\d{3})\b/.exec(line) ?? /Server returned (\d{3})\b/.exec(line);
  return match?.[1] === undefined ? undefined : Number(match[1]);
};

/**
 * Classifies a run that produced no segment. `httpStatus` is the last status seen in its log;
 * `run.lastError` is ffmpeg's last error line.
 */
export const classifyEmptyRun = (
  run: Pick<CaptureRun, "startedAtMs" | "endedAtMs" | "lastError">,
  httpStatus: number | undefined,
): EmptyRunCause => {
  const status = httpStatus ?? (run.lastError === null ? undefined : httpStatusIn(run.lastError));
  if (status !== undefined) {
    return LIMIT_STATUSES.has(status)
      ? { _tag: "Refused", httpStatus: status }
      : { _tag: "Unreachable" };
  }
  const lasted = (run.endedAtMs ?? run.startedAtMs) - run.startedAtMs;
  const emptyBody = /invalid data found|end of file|could not find codec parameters/i.test(
    run.lastError ?? "",
  );
  return emptyBody && lasted < IMMEDIATE_MS
    ? { _tag: "Refused", httpStatus: undefined }
    : { _tag: "Unreachable" };
};
