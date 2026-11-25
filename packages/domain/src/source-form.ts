import { Schema, Struct } from "effect";
import {
  type RedactedUrl,
  SecretHeadersPatch,
  SourceConfigPatch,
  type SourceView,
} from "./secrets.ts";
import { HttpUrl, Source } from "./source.ts";

/*
 * The source form every client shows (web and phone): what it holds as typed, how it checks
 * it, and what it sends. Words for its problems are in @slipstream/i18n (`sourceProblemTexts`).
 */

/** What the source form holds, as typed. */
export interface SourceDraft {
  readonly name: string;
  readonly playlist: string;
  readonly guide: string;
  readonly limit: string;
  readonly kept: string;
  /** Add new streams of groups already added on refresh. Absent means off. */
  readonly autoAddNew?: boolean;
}

/**
 * What an admin sends to create a source, secrets included (the Xtream password, credentials in
 * URLs, `secretHeaders`). Secrets are write-only: responses carry a `SourceView` instead.
 */
export const SourceInput = Source.mapFields(
  Struct.omit(["id", "health", "lastRefreshAt", "reviewedAt"]),
).annotate({ identifier: "SourceInput" });
export type SourceInput = typeof SourceInput.Type;

/**
 * A partial update; absent fields stay as they are. `config` may leave out the password and
 * URLs to keep the stored ones; `secretHeaders` sets (value) or removes (`null`) single headers.
 */
export const SourceUpdate = SourceInput.mapFields(Struct.map(Schema.optionalKey))
  .mapFields(
    Struct.assign({
      config: Schema.optionalKey(SourceConfigPatch),
      secretHeaders: Schema.optionalKey(SecretHeadersPatch),
    }),
  )
  .annotate({ identifier: "SourceUpdate" });
export type SourceUpdate = typeof SourceUpdate.Type;

/** What is wrong with one field of the form. */
export type SourceProblem = "nameMissing" | "urlInvalid";

/** The form's problems, per field. */
export interface SourceProblems {
  readonly name?: SourceProblem;
  readonly playlist?: SourceProblem;
  readonly guide?: SourceProblem;
}

const httpUrl = Schema.is(HttpUrl);

/** True for an absolute http(s) address once trimmed: what the contract's `HttpUrl` accepts. */
export const isHttpUrl = (value: string): boolean => httpUrl(value.trim());

/** A whole number from a form field, at least `min`, or nothing when the field is empty. */
export const draftCount = (value: string, min: number): number | undefined => {
  if (value.trim() === "") return undefined;
  const parsed = Math.round(Number(value));
  return Number.isFinite(parsed) ? Math.max(min, parsed) : undefined;
};

/**
 * How an address field starts: an address without credentials is shown as it is and can be
 * edited in place; one with credentials is write-only, so the field starts empty, says the
 * address is stored (masked), and keeps it unless something new is typed.
 */
export const addressField = (
  stored: RedactedUrl | undefined,
): { readonly initial: string; readonly writeOnly: boolean } =>
  stored === undefined || !stored.hasCredentials
    ? { initial: stored?.url ?? "", writeOnly: false }
    : { initial: "", writeOnly: true };

/** The form as it opens: empty for a new source, else the source as stored. */
export const sourceDraftOf = (source: SourceView | undefined): SourceDraft => {
  const config = source?.config._tag === "M3u" ? source.config : undefined;
  return {
    name: source?.name ?? "",
    playlist: addressField(config?.playlistUrl).initial,
    guide: addressField(config?.guideUrl).initial,
    limit: source?.maxStreams === undefined ? "" : String(source.maxStreams),
    kept: source?.keptForRecordings === undefined ? "" : String(source.keptForRecordings),
    autoAddNew: source?.autoAddNew ?? false,
  };
};

/** A new M3U + XMLTV source from the form (refreshing every 6 h, duplicates removed). */
export const sourceInput = (draft: SourceDraft): SourceInput => {
  const maxStreams = draftCount(draft.limit, 1);
  const kept = draftCount(draft.kept, 0);
  return {
    name: draft.name.trim(),
    config: {
      _tag: "M3u",
      playlistUrl: draft.playlist.trim(),
      ...(draft.guide.trim() === "" ? {} : { guideUrl: draft.guide.trim() }),
    },
    refreshIntervalMinutes: 360,
    ...(maxStreams === undefined ? {} : { maxStreams }),
    ...(kept === undefined || kept === 0 ? {} : { keptForRecordings: kept }),
    headers: {},
    guideCleanup: { removeDuplicates: true, rewrites: [] },
    enabled: true,
    ...(draft.autoAddNew === true ? { autoAddNew: true } : {}),
  };
};

/** Problems with the form, per field; addresses that stay stored need no new value. */
export const sourceDraftProblems = (
  draft: SourceDraft,
  keep: { readonly playlist: boolean },
): SourceProblems => ({
  ...(draft.name.trim() === "" ? { name: "nameMissing" } : {}),
  ...((keep.playlist && draft.playlist.trim() === "") || isHttpUrl(draft.playlist)
    ? {}
    : { playlist: "urlInvalid" }),
  ...(draft.guide.trim() === "" || isHttpUrl(draft.guide) ? {} : { guide: "urlInvalid" }),
});

/**
 * What an edit sends. Untouched write-only addresses are left out so the server keeps them;
 * an emptied guide address that was not write-only removes the guide. The streams kept for
 * recordings are sent when one is typed.
 */
export const sourceEdit = (source: SourceView, form: SourceDraft): SourceUpdate => {
  const maxStreams = draftCount(form.limit, 1);
  const kept = draftCount(form.kept, 0);
  const base: SourceUpdate = {
    name: form.name.trim(),
    ...(maxStreams === undefined ? {} : { maxStreams }),
    ...(kept === undefined ? {} : { keptForRecordings: kept }),
    ...(form.autoAddNew === undefined || form.autoAddNew === (source.autoAddNew ?? false)
      ? {}
      : { autoAddNew: form.autoAddNew }),
  };
  if (source.config._tag !== "M3u") return base;
  const guideStored = addressField(source.config.guideUrl);
  const playlist = form.playlist.trim();
  const guide = form.guide.trim();
  let guideUrl: string | null | undefined;
  if (guide !== "") guideUrl = guide;
  else if (!guideStored.writeOnly && source.config.guideUrl !== undefined) guideUrl = null;
  return {
    ...base,
    config: {
      _tag: "M3u",
      ...(playlist === "" ? {} : { playlistUrl: playlist }),
      ...(guideUrl === undefined ? {} : { guideUrl }),
    },
  };
};
