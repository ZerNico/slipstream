import { m } from "@slipstream/i18n";
import { problemOf } from "./errors.ts";

/** The words for a failed request, by what went wrong (`problemOf`). */
export const problemTitle = (error: unknown): string => {
  const { _tag: tag } = problemOf(error);
  if (tag === "Forbidden") return m.state_forbidden();
  if (tag === "Offline") return m.error_offline();
  return m.error_unexpected();
};
