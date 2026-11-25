import { Schema } from "effect";
import { HttpUrl, Source, type SourceConfig, SourceStream } from "./source.ts";

/*
 * Write-only source secrets. What an admin sends (`SourceConfig`, `secretHeaders`) is stored;
 * what any client reads back is a view that says a secret is set (`hasPassword`, header names,
 * URLs with credentials masked) and never the value. Updates may leave secrets out to keep them.
 */

/** Replaces secret values in views and logs. */
export const redactedMark = "***";

const secretQueryKeys = new Set([
  "password",
  "pass",
  "passwd",
  "pwd",
  "username",
  "user",
  "token",
  "access_token",
  "auth",
  "key",
  "apikey",
  "api_key",
  "secret",
  "sig",
  "signature",
]);

/**
 * Masks credentials in a URL for views and logs: the user-info part and the values of query
 * parameters such as `username`, `password`, `token` or `key`. Credentials inside a path (Xtream
 * stream URLs) look like ids, so stream URLs are never shown at all. A string that is not a URL
 * is masked whole.
 */
export const redactUrl = (url: string): string => {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return redactedMark;
  }
  const hasUserInfo = parsed.username !== "" || parsed.password !== "";
  let maskedQuery = false;
  for (const key of new Set(parsed.searchParams.keys())) {
    if (secretQueryKeys.has(key.toLowerCase())) {
      parsed.searchParams.set(key, redactedMark);
      maskedQuery = true;
    }
  }
  if (!hasUserInfo && !maskedQuery) return url;
  // Rebuilt by hand: some URL typings (React Native) declare `username` and `password` read-only.
  const masked = hasUserInfo
    ? `${parsed.protocol}//${parsed.username === "" ? "" : redactedMark}${parsed.password === "" ? "" : `:${redactedMark}`}@${parsed.host}${parsed.pathname}${parsed.search}${parsed.hash}`
    : parsed.href;
  // URL encodes the mark; keep it readable.
  return masked.replaceAll(encodeURIComponent(redactedMark), redactedMark);
};

const sensitiveHeaderNames = new Set([
  "authorization",
  "proxy-authorization",
  "cookie",
  "x-api-key",
  "x-auth-token",
]);

/** True for request headers that carry credentials and belong in `secretHeaders`. */
export const isSensitiveHeader = (name: string): boolean =>
  sensitiveHeaderNames.has(name.trim().toLowerCase());

/**
 * Plain headers that carry credentials and should be secret headers instead, so the editor can
 * refuse to save them where every admin view would show them.
 */
export const sensitivePlainHeaders = (headers: Readonly<Record<string, string>>): Array<string> =>
  Object.keys(headers).filter(isSensitiveHeader);

/** A URL as a view shows it: credentials masked, plus whether there were any. */
export const RedactedUrl = Schema.Struct({
  url: Schema.String,
  hasCredentials: Schema.Boolean,
}).annotate({ identifier: "RedactedUrl" });
export type RedactedUrl = typeof RedactedUrl.Type;

const viewUrl = (url: string): RedactedUrl => {
  const masked = redactUrl(url);
  return { url: masked, hasCredentials: masked !== url };
};

/** A source config as clients read it: no password, URLs with credentials masked. */
export const SourceConfigView = Schema.TaggedUnion({
  M3u: { playlistUrl: RedactedUrl, guideUrl: Schema.optionalKey(RedactedUrl) },
  Xtream: { serverUrl: RedactedUrl, username: Schema.String, hasPassword: Schema.Boolean },
  HdHomeRun: { deviceUrl: RedactedUrl },
  Url: { streamUrl: RedactedUrl },
}).annotate({ identifier: "SourceConfigView" });
export type SourceConfigView = typeof SourceConfigView.Type;

/** The view of a stored config. */
export const viewSourceConfig = (config: SourceConfig): SourceConfigView => {
  switch (config._tag) {
    case "M3u":
      return {
        _tag: "M3u",
        playlistUrl: viewUrl(config.playlistUrl),
        ...(config.guideUrl === undefined ? {} : { guideUrl: viewUrl(config.guideUrl) }),
      };
    case "Xtream":
      return {
        _tag: "Xtream",
        serverUrl: viewUrl(config.serverUrl),
        username: config.username,
        hasPassword: config.password !== "",
      };
    case "HdHomeRun":
      return { _tag: "HdHomeRun", deviceUrl: viewUrl(config.deviceUrl) };
    case "Url":
      return { _tag: "Url", streamUrl: viewUrl(config.streamUrl) };
  }
};

const { config: _config, secretHeaders: _secretHeaders, ...publicSourceFields } = Source.fields;

/** A source as every client reads it: secrets replaced by flags and names. */
export const SourceView = Schema.Struct({
  ...publicSourceFields,
  config: SourceConfigView,
  /** Names of the write-only headers that are set. */
  secretHeaderNames: Schema.Array(Schema.String),
}).annotate({ identifier: "SourceView" });
export type SourceView = typeof SourceView.Type;

/** The view of a stored source. */
export const viewSource = (source: Source): SourceView => {
  const { config, secretHeaders, ...rest } = source;
  return {
    ...rest,
    config: viewSourceConfig(config),
    secretHeaderNames: Object.keys(secretHeaders ?? {}).toSorted(),
  };
};

/**
 * A config change. Fields holding secrets may be left out to keep the stored value: the Xtream
 * password, and URLs (which can embed credentials and are only ever shown masked). Switching to
 * another source type needs every field of the new type.
 */
export const SourceConfigPatch = Schema.TaggedUnion({
  M3u: {
    playlistUrl: Schema.optionalKey(HttpUrl),
    /** `null` removes the guide URL. */
    guideUrl: Schema.optionalKey(Schema.NullOr(HttpUrl)),
  },
  Xtream: {
    serverUrl: Schema.optionalKey(HttpUrl),
    username: Schema.String,
    password: Schema.optionalKey(Schema.String),
  },
  HdHomeRun: { deviceUrl: Schema.optionalKey(HttpUrl) },
  Url: { streamUrl: Schema.optionalKey(HttpUrl) },
}).annotate({ identifier: "SourceConfigPatch" });
export type SourceConfigPatch = typeof SourceConfigPatch.Type;

/** A patch left out a field the stored config cannot supply. */
export interface MissingSecret {
  readonly _tag: "MissingSecret";
  /** Field name in the patch, e.g. `password`. */
  readonly field: string;
}

const missing = (field: string): MissingSecret => ({ _tag: "MissingSecret", field });

/** Applies a config patch to the stored config, or names the field that has to be sent. */
export const applySourceConfigPatch = (
  current: SourceConfig | undefined,
  patch: SourceConfigPatch,
): SourceConfig | MissingSecret => {
  switch (patch._tag) {
    case "M3u": {
      const stored = current?._tag === "M3u" ? current : undefined;
      const playlistUrl = patch.playlistUrl ?? stored?.playlistUrl;
      if (playlistUrl === undefined) return missing("playlistUrl");
      const guideUrl = patch.guideUrl === undefined ? stored?.guideUrl : patch.guideUrl;
      return guideUrl === undefined || guideUrl === null
        ? { _tag: "M3u", playlistUrl }
        : { _tag: "M3u", playlistUrl, guideUrl };
    }
    case "Xtream": {
      const stored = current?._tag === "Xtream" ? current : undefined;
      const serverUrl = patch.serverUrl ?? stored?.serverUrl;
      if (serverUrl === undefined) return missing("serverUrl");
      const password = patch.password ?? stored?.password;
      if (password === undefined) return missing("password");
      return { _tag: "Xtream", serverUrl, username: patch.username, password };
    }
    case "HdHomeRun": {
      const stored = current?._tag === "HdHomeRun" ? current.deviceUrl : undefined;
      const deviceUrl = patch.deviceUrl ?? stored;
      return deviceUrl === undefined ? missing("deviceUrl") : { _tag: "HdHomeRun", deviceUrl };
    }
    case "Url": {
      const stored = current?._tag === "Url" ? current.streamUrl : undefined;
      const streamUrl = patch.streamUrl ?? stored;
      return streamUrl === undefined ? missing("streamUrl") : { _tag: "Url", streamUrl };
    }
  }
};

/** A change to the write-only headers: a value sets one, `null` removes it, absent names stay. */
export const SecretHeadersPatch = Schema.Record(
  Schema.String,
  Schema.NullOr(Schema.String),
).annotate({ identifier: "SecretHeadersPatch" });
export type SecretHeadersPatch = typeof SecretHeadersPatch.Type;

/** Applies a secret-headers patch. Header names compare case-insensitively, as in HTTP. */
export const applySecretHeadersPatch = (
  current: Readonly<Record<string, string>> | undefined,
  patch: SecretHeadersPatch,
): Record<string, string> => {
  const next = new Map(
    Object.entries(current ?? {}).map(([name, value]) => [name.toLowerCase(), { name, value }]),
  );
  for (const [name, value] of Object.entries(patch)) {
    if (value === null) next.delete(name.toLowerCase());
    else next.set(name.toLowerCase(), { name, value });
  }
  return Object.fromEntries([...next.values()].map(({ name, value }) => [name, value]));
};

const { url: _url, ...publicStreamFields } = SourceStream.fields;

/** A source stream as clients read it: without its URL, which may embed credentials. */
export const SourceStreamView = Schema.Struct(publicStreamFields).annotate({
  identifier: "SourceStreamView",
});
export type SourceStreamView = typeof SourceStreamView.Type;

/** The view of a source stream. */
export const viewSourceStream = (stream: SourceStream): SourceStreamView => {
  const { url: _streamUrl, ...rest } = stream;
  return rest;
};
