import type { FakeChannel } from "./channels.ts";
import type { Programme } from "./schedule.ts";
import { xmltvTimestamp } from "./time.ts";

/** Escapes text for XML element content and attribute values. */
const xml = (text: string) =>
  text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");

/** M3U attribute values cannot hold a double quote; real playlists drop them too. */
const attribute = (text: string) => text.replaceAll('"', "");

/**
 * An extended M3U playlist in the shape tvproxy and most IPTV panels serve: `url-tvg` header,
 * `tvg-id`, `tvg-name`, `tvg-logo`, `tvg-chno` and `group-title` per entry. `streamQuery` is
 * appended to every stream URL, so fault parameters on the playlist reach the streams.
 */
export const renderPlaylist = (options: {
  readonly baseUrl: string;
  readonly channels: ReadonlyArray<FakeChannel>;
  readonly streamQuery?: string;
}): string => {
  const query = options.streamQuery ? `?${options.streamQuery}` : "";
  const lines = [
    `#EXTM3U url-tvg="${options.baseUrl}/epg.xml" x-tvg-url="${options.baseUrl}/epg.xml"`,
  ];
  for (const channel of options.channels) {
    lines.push(
      `#EXTINF:-1 tvg-id="${attribute(channel.tvgId)}" tvg-name="${attribute(channel.name)}" ` +
        `tvg-logo="${options.baseUrl}/logo/${channel.id}.svg" tvg-chno="${channel.number}" ` +
        `group-title="${attribute(channel.group)}",${channel.name}`,
      `${options.baseUrl}/stream/${channel.id}.ts${query}`,
    );
  }
  return `${lines.join("\n")}\n`;
};

const programmeXml = (programme: Programme, timeZone: string) => {
  const lines = [
    `  <programme start="${xmltvTimestamp(programme.start, timeZone)}" ` +
      `stop="${xmltvTimestamp(programme.stop, timeZone)}" channel="${xml(programme.channelId)}">`,
    `    <title lang="de">${xml(programme.title)}</title>`,
  ];
  if (programme.subTitle)
    lines.push(`    <sub-title lang="de">${xml(programme.subTitle)}</sub-title>`);
  lines.push(`    <desc lang="de">${xml(programme.description)}</desc>`);
  if (programme.director || programme.actors) {
    lines.push("    <credits>");
    if (programme.director) lines.push(`      <director>${xml(programme.director)}</director>`);
    for (const actor of programme.actors ?? []) lines.push(`      <actor>${xml(actor)}</actor>`);
    lines.push("    </credits>");
  }
  if (programme.year !== undefined) lines.push(`    <date>${programme.year}</date>`);
  for (const category of programme.categories) {
    lines.push(`    <category lang="de">${xml(category)}</category>`);
  }
  if (programme.country) lines.push(`    <country>${xml(programme.country)}</country>`);
  if (programme.episode) {
    const { season, episode, episodes } = programme.episode;
    lines.push(
      `    <episode-num system="xmltv_ns">${season - 1}.${episode - 1}/${episodes}.</episode-num>`,
      `    <episode-num system="onscreen">S${String(season).padStart(2, "0")} E${String(episode).padStart(2, "0")}</episode-num>`,
    );
  }
  if (programme.previouslyShown) lines.push("    <previously-shown />");
  if (programme.rating !== undefined) {
    lines.push(
      `    <rating system="FSK">`,
      `      <value>${programme.rating}</value>`,
      `    </rating>`,
    );
  }
  lines.push("  </programme>");
  return lines.join("\n");
};

/**
 * An XMLTV guide. With `duplicates`, every programme is written twice in a row, the way the
 * tvproxy feed does, so guide clean-up has something to remove.
 */
export const renderXmltv = (options: {
  readonly baseUrl: string;
  readonly channels: ReadonlyArray<FakeChannel>;
  readonly programmes: ReadonlyArray<Programme>;
  readonly timeZone: string;
  readonly duplicates?: boolean;
  /** Guide channels without programmes or logo (the big line-up's). */
  readonly extraChannels?: ReadonlyArray<{ readonly id: string; readonly name: string }>;
}): string => {
  const parts = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE tv SYSTEM "xmltv.dtd">',
    `<tv generator-info-name="slipstream-fake-source" source-info-url="${xml(options.baseUrl)}">`,
  ];
  for (const channel of options.channels) {
    parts.push(
      `  <channel id="${xml(channel.tvgId)}">`,
      `    <display-name lang="de">${xml(channel.name)}</display-name>`,
      `    <icon src="${xml(`${options.baseUrl}/logo/${channel.id}.svg`)}" />`,
      "  </channel>",
    );
  }
  for (const channel of options.extraChannels ?? []) {
    parts.push(
      `  <channel id="${xml(channel.id)}">`,
      `    <display-name lang="de">${xml(channel.name)}</display-name>`,
      "  </channel>",
    );
  }
  for (const programme of options.programmes) {
    const entry = programmeXml(programme, options.timeZone);
    parts.push(entry);
    if (options.duplicates) parts.push(entry);
  }
  parts.push("</tv>");
  return `${parts.join("\n")}\n`;
};

/** A square SVG logo: the channel colour with its initials and number. */
export const renderLogo = (channel: FakeChannel): string => {
  const initials = channel.name
    .split(/\s+/)
    .filter((word) => /^[\p{L}\d]/u.test(word))
    .slice(0, 3)
    .map((word) => word[0])
    .join("")
    .toUpperCase();
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="256" height="256">` +
    `<rect width="256" height="256" rx="40" fill="${channel.colour}"/>` +
    `<text x="128" y="150" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" ` +
    `font-size="${initials.length > 3 ? 64 : 88}" font-weight="700" fill="#ffffff">${xml(initials)}</text>` +
    `<text x="128" y="215" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" ` +
    `font-size="32" fill="#ffffff" fill-opacity="0.8">${channel.number}</text>` +
    `</svg>`
  );
};
