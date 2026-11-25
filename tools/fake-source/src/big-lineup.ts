import { channels } from "./channels.ts";

/**
 * A big playlist (`?lineup=big`), shaped like a large IPTV panel: about 4,800 streams in 28
 * groups ("DE | Vollprogramm", "UK | Entertainment", "VOD | Filme", "Radio", …), most channels in
 * HD and SD and some in FHD, and a guide that covers only part of them. Every entry plays one of
 * the eight real test streams, so whatever gets added can be watched and recorded. The eight
 * channels of the normal line-up are in it too, under their own guide ids, so a server that
 * already has them sees those streams join its channels.
 */

/** One stream of the big playlist. */
export interface BigEntry {
  readonly name: string;
  readonly group: string;
  /** Absent for streams the panel sends without one. */
  readonly tvgId?: string;
  /** Whether the big guide lists the tvg-id. */
  readonly inGuide: boolean;
  /** The test stream it plays: one of the normal line-up's slugs. */
  readonly stream: string;
}

interface GroupPlan {
  readonly name: string;
  /** Channels before copies; each comes in HD, most also in SD, some in FHD. */
  readonly channels: number;
  /** Known names first; the rest are numbered from `stem`. */
  readonly names: ReadonlyArray<string>;
  readonly stem: string;
  /** Share of channels the guide covers, in percent. */
  readonly coverage: number;
  /** On-demand and radio entries come once, without quality tags. */
  readonly copies: boolean;
}

const group = (
  name: string,
  count: number,
  stem: string,
  coverage: number,
  names: ReadonlyArray<string> = [],
  copies = true,
): GroupPlan => ({ name, channels: count, names, stem, coverage, copies });

/** The groups, in the order a panel lists them. Channel counts add up to ~4,800 streams. */
const plans: ReadonlyArray<GroupPlan> = [
  group("DE | Vollprogramm", 40, "Vollprogramm", 98, [
    "Das Erste",
    "ZDF",
    "RTL",
    "SAT.1",
    "ProSieben",
    "VOX",
    "kabel eins",
    "RTLZWEI",
    "3sat",
    "arte",
    "ONE",
    "ZDFneo",
    "tagesschau24",
    "phoenix",
    "KiKA",
    "Super RTL",
    "sixx",
    "SAT.1 Gold",
    "ProSieben MAXX",
    "kabel eins Doku",
  ]),
  group("DE | Nachrichten", 30, "Nachrichten", 83, ["n-tv", "WELT", "BILD TV", "euronews"]),
  group("DE | Sport", 70, "Sportkanal", 68, [
    "Eurosport 1",
    "Eurosport 2",
    "Sport1",
    "DAZN 1",
    "DAZN 2",
    "Sky Sport News",
    "Sky Sport Bundesliga",
    "Sky Sport F1",
  ]),
  group("DE | Sky", 45, "Sky Kanal", 95, ["Sky One", "Sky Atlantic", "Sky Cinema Premieren"]),
  group("DE | Kinder", 20, "Kinderkanal", 87, ["Nick", "Disney Channel", "Boomerang"]),
  group("DE | Dokumentation", 30, "Doku", 89, ["Discovery", "National Geographic", "History"]),
  group("DE | Musik", 15, "Musik", 36, ["MTV", "Deluxe Music"]),
  group("DE | Regional", 60, "Regional", 76, [
    "NDR Hamburg",
    "NDR Mecklenburg-Vorpommern",
    "WDR Köln",
    "WDR Aachen",
    "BR Süd",
    "SWR BW",
    "MDR Sachsen",
    "hr-fernsehen",
    "rbb Berlin",
  ]),
  group("DE | Film & Serie", 80, "Filmkanal", 72, ["TNT Serie", "AXN", "13th Street"]),
  group("DE | Shopping", 15, "Shop", 20, ["QVC", "HSE"]),
  group("AT | Österreich", 30, "ORF Kanal", 70, ["ORF 1", "ORF 2", "ServusTV", "PULS 4"]),
  group("CH | Schweiz", 25, "SRF Kanal", 65, ["SRF 1", "SRF zwei", "3+"]),
  group("UK | Entertainment", 150, "UK Channel", 70, ["BBC One", "BBC Two", "ITV1", "Channel 4"]),
  group("UK | News", 40, "UK News", 60, ["BBC News", "Sky News"]),
  group("UK | Sport", 120, "UK Sport", 55, ["Sky Sports Main Event", "TNT Sports 1"]),
  group("UK | Kids", 40, "UK Kids", 50, ["CBBC", "CBeebies"]),
  group("US | Entertainment", 220, "US Channel", 45, ["ABC", "CBS", "NBC", "FOX"]),
  group("US | News", 60, "US News", 40, ["CNN", "MSNBC"]),
  group("US | Sport", 160, "US Sport", 35, ["ESPN", "ESPN 2"]),
  group("FR | Général", 120, "Chaîne", 40, ["TF1", "France 2", "France 3", "M6"]),
  group("IT | Generali", 110, "Canale", 35, ["Rai 1", "Rai 2", "Canale 5"]),
  group("ES | Generales", 110, "Canal", 30, ["La 1", "Antena 3", "Telecinco"]),
  group("NL | Algemeen", 80, "Zender", 30, ["NPO 1", "RTL 4", "SBS6"]),
  group("PL | Ogólne", 80, "Kanał", 25, ["TVP 1", "Polsat", "TVN"]),
  group("TR | Ulusal", 80, "Kanal TR", 25, ["TRT 1", "ATV", "Show TV"]),
  group("VOD | Filme", 650, "Film", 0, [], false),
  group("VOD | Serien", 400, "Serie", 0, [], false),
  group("Radio", 120, "Radio", 0, ["Bayern 3", "1LIVE", "NDR 2"], false),
];

/** Where each of the normal line-up's channels sits in the big playlist. */
const standardGroups: Readonly<Record<string, string>> = {
  "sportkanal-f1": "DE | Sport",
  "nachrichten-24": "DE | Nachrichten",
  serienwelt: "DE | Film & Serie",
  "kino-klassik": "DE | Film & Serie",
  kunterbunt: "DE | Kinder",
  "doku-plus": "DE | Dokumentation",
  regional: "DE | Regional",
  "testbild-kurz": "DE | Vollprogramm",
  filmhaus: "DE | Film & Serie",
};

/** A small, stable hash, so the same index always gets the same copies and coverage. */
const spread = (seed: number, salt: number) =>
  (Math.imul(seed, 2_654_435_761) + Math.imul(salt, 40_503)) >>> 0;

const percent = (seed: number, salt: number) => spread(seed, salt) % 100;

const slug = (name: string) =>
  name
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/[^A-Za-z0-9]+/g, "")
    .toLowerCase();

const build = (): ReadonlyArray<BigEntry> => {
  const entries: BigEntry[] = [];
  let index = 0;
  for (const plan of plans) {
    const country = slug(plan.name.split("|")[0] ?? "x");
    for (let n = 0; n < plan.channels; n += 1) {
      index += 1;
      const base = plan.names[n] ?? `${plan.stem} ${n + 1 - plan.names.length}`;
      const stream = channels[index % channels.length]?.id ?? "testbild-kurz";
      if (!plan.copies) {
        entries.push({ name: base, group: plan.name, inGuide: false, stream });
        continue;
      }
      const roll = percent(index, 1);
      // Covered channels have a guide id; of the rest, half carry an id the guide lacks.
      const inGuide = roll < plan.coverage;
      const tvgId = inGuide || roll % 2 === 0 ? `${slug(base)}.${country}.big` : undefined;
      const copy = (name: string): BigEntry => ({
        name,
        group: plan.name,
        ...(tvgId === undefined ? {} : { tvgId }),
        inGuide,
        stream,
      });
      entries.push(copy(`${base} HD`));
      // Well-known channels always come in SD too, as on real panels.
      if (n < plan.names.length || percent(index, 2) < 65) entries.push(copy(base));
      if (percent(index, 3) < 30) entries.push(copy(`${base} FHD`));
    }
  }
  for (const channel of channels) {
    entries.push({
      name: channel.name,
      group: standardGroups[channel.id] ?? "DE | Vollprogramm",
      tvgId: channel.tvgId,
      inGuide: true,
      stream: channel.id,
    });
  }
  return entries;
};

/** The big playlist's streams, the same on every call. */
export const bigLineup: ReadonlyArray<BigEntry> = build();

/** The group titles of the big playlist, in playlist order. */
export const bigGroups: ReadonlyArray<string> = plans.map((plan) => plan.name);

const attribute = (text: string) => text.replaceAll('"', "");

/** The big playlist as M3U; `streamQuery` reaches every stream URL, as on the normal one. */
export const renderBigPlaylist = (options: {
  readonly baseUrl: string;
  readonly streamQuery?: string;
}): string => {
  const query = options.streamQuery ? `?${options.streamQuery}` : "";
  const guide = `${options.baseUrl}/epg.xml?lineup=big`;
  const lines = [`#EXTM3U url-tvg="${guide}" x-tvg-url="${guide}"`];
  for (const entry of bigLineup) {
    const id = entry.tvgId === undefined ? "" : `tvg-id="${attribute(entry.tvgId)}" `;
    lines.push(
      `#EXTINF:-1 ${id}tvg-name="${attribute(entry.name)}" group-title="${attribute(entry.group)}",${entry.name}`,
      `${options.baseUrl}/stream/${entry.stream}.ts${query}`,
    );
  }
  return `${lines.join("\n")}\n`;
};

/**
 * The guide channels the big playlist adds to the normal guide: one per covered channel (its
 * copies share it), without programmes. The normal line-up's channels keep their programmes.
 */
export const bigGuideChannels = (): ReadonlyArray<{
  readonly id: string;
  readonly name: string;
}> => {
  const seen = new Set<string>(channels.map((channel) => channel.tvgId));
  const out: Array<{ id: string; name: string }> = [];
  for (const entry of bigLineup) {
    if (!entry.inGuide || entry.tvgId === undefined || seen.has(entry.tvgId)) continue;
    seen.add(entry.tvgId);
    out.push({ id: entry.tvgId, name: entry.name.replace(/ (?:HD|FHD)$/u, "") });
  }
  return out;
};
