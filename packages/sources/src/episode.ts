/** Season and episode details, merged from every `<episode-num>` of a programme. */
export interface EpisodeInfo {
  /** 1-based season number. */
  readonly season?: number | undefined;
  /** 1-based episode number within the season. */
  readonly episode?: number | undefined;
  /** Episodes in the season, when the feed says. */
  readonly episodeCount?: number | undefined;
  /** 1-based part number of a multi-part episode. */
  readonly part?: number | undefined;
  readonly partCount?: number | undefined;
  /** Raw `xmltv_ns` value, e.g. `1.4.0/2`. */
  readonly xmltvNs?: string | undefined;
  /** Raw `onscreen` value, e.g. `S1 E104`. */
  readonly onscreen?: string | undefined;
}

interface NsField {
  readonly value: number | undefined;
  readonly total: number | undefined;
}

const nsField = (field: string | undefined): NsField => {
  const [rawValue, rawTotal] = (field ?? "").split("/").map((part) => part.trim());
  const value = rawValue === undefined || rawValue === "" ? undefined : Number(rawValue);
  const total = rawTotal === undefined || rawTotal === "" ? undefined : Number(rawTotal);
  return {
    value: value !== undefined && Number.isInteger(value) && value >= 0 ? value + 1 : undefined,
    total: total !== undefined && Number.isInteger(total) && total > 0 ? total : undefined,
  };
};

/**
 * Parses `xmltv_ns` (`season.episode.part`, each zero-based and optionally `/total`).
 */
export const parseXmltvNs = (value: string): EpisodeInfo | undefined => {
  const fields = value.split(".");
  if (fields.length < 2 || fields.length > 3) return undefined;
  const season = nsField(fields[0]);
  const episode = nsField(fields[1]);
  const part = nsField(fields[2]);
  if (season.value === undefined && episode.value === undefined && part.value === undefined) {
    return undefined;
  }
  return {
    season: season.value,
    episode: episode.value,
    episodeCount: episode.total,
    part: part.value,
    partCount: part.total,
    xmltvNs: value.trim(),
  };
};

const ONSCREEN: ReadonlyArray<{ readonly pattern: RegExp; readonly season: boolean }> = [
  // S1 E104, S01E04, s2 e3, S01.E04, Season 1 Episode 4, Staffel 1 Folge 4
  {
    pattern:
      /(?:\bS|\bseason\s*|\bstaffel\s*)(\d{1,4})[\s.,:-]*(?:E|ep\.?\s*|episode\s*|folge\s*)(\d{1,5})/i,
    season: true,
  },
  // 1x04
  { pattern: /\b(\d{1,3})x(\d{1,4})\b/i, season: true },
  // E104, Ep. 12, Episode 12, Folge 12
  { pattern: /(?:\bE|\bep\.?\s*|\bepisode\s*|\bfolge\s*)(\d{1,5})\b/i, season: false },
];

/**
 * Parses free-form `onscreen` episode numbers such as `S1 E104`, `1x04` or `Folge 12`.
 */
export const parseOnscreen = (value: string): EpisodeInfo | undefined => {
  for (const { pattern, season } of ONSCREEN) {
    const match = pattern.exec(value);
    if (!match) continue;
    return season
      ? { season: Number(match[1]), episode: Number(match[2]), onscreen: value.trim() }
      : { episode: Number(match[1]), onscreen: value.trim() };
  }
  return value.trim() === "" ? undefined : { onscreen: value.trim() };
};

/**
 * Folds one `<episode-num>` into what is already known. `xmltv_ns` numbers win over `onscreen`
 * ones because they are structured; raw values of both systems are kept.
 */
export const mergeEpisodeNum = (
  current: EpisodeInfo | undefined,
  system: string | undefined,
  value: string,
): EpisodeInfo | undefined => {
  const normalised = (system ?? "").trim().toLowerCase();
  const parsed =
    normalised === "xmltv_ns"
      ? parseXmltvNs(value)
      : normalised === "onscreen" || normalised === ""
        ? parseOnscreen(value)
        : undefined;
  if (parsed === undefined) return current;
  if (current === undefined) return parsed;
  const preferParsed = normalised === "xmltv_ns";
  const pick = <K extends keyof EpisodeInfo>(key: K): EpisodeInfo[K] =>
    preferParsed ? (parsed[key] ?? current[key]) : (current[key] ?? parsed[key]);
  return {
    season: pick("season"),
    episode: pick("episode"),
    episodeCount: pick("episodeCount"),
    part: pick("part"),
    partCount: pick("partCount"),
    xmltvNs: current.xmltvNs ?? parsed.xmltvNs,
    onscreen: current.onscreen ?? parsed.onscreen,
  };
};
