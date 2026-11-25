import { describe, expect, it } from "vitest";
import { channels } from "./channels.ts";
import { renderLogo, renderPlaylist, renderXmltv } from "./render.ts";
import { type Programme, programmesBetween } from "./schedule.ts";

const baseUrl = "http://fake.test:8090";
const tz = "Europe/Berlin";

describe("renderPlaylist", () => {
  it("lists every channel with tvg attributes, group and stream URL", () => {
    const lines = renderPlaylist({ baseUrl, channels }).trimEnd().split("\n");
    expect(lines[0]).toBe(`#EXTM3U url-tvg="${baseUrl}/epg.xml" x-tvg-url="${baseUrl}/epg.xml"`);
    expect(lines).toHaveLength(1 + channels.length * 2);
    const f1 = channels[0];
    expect(lines[1]).toBe(
      `#EXTINF:-1 tvg-id="${f1?.tvgId}" tvg-name="Sportkanal F1 HD" ` +
        `tvg-logo="${baseUrl}/logo/sportkanal-f1.svg" tvg-chno="1" group-title="Sport",Sportkanal F1 HD`,
    );
    expect(lines[2]).toBe(`${baseUrl}/stream/sportkanal-f1.ts`);
    const ids = lines
      .filter((line) => line.startsWith("#EXTINF"))
      .map((line) => /tvg-id="([^"]+)"/.exec(line)?.[1]);
    expect(new Set(ids).size).toBe(channels.length);
  });

  it("copies fault parameters onto the stream URLs", () => {
    const playlist = renderPlaylist({ baseUrl, channels, streamQuery: "dropAfter=5&refuse=429" });
    expect(playlist).toContain(`${baseUrl}/stream/regional.ts?dropAfter=5&refuse=429\n`);
  });
});

describe("renderXmltv", () => {
  const from = new Date("2026-11-21T11:00:00Z");
  const to = new Date(from.getTime() + 48 * 3_600_000);
  const programmes = channels.flatMap((channel) => programmesBetween(channel, from, to, tz));

  it("writes channels and programmes in XMLTV order", () => {
    const guide = renderXmltv({ baseUrl, channels, programmes, timeZone: tz });
    expect(guide.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n')).toBe(true);
    expect(guide.match(/<channel id=/g)).toHaveLength(channels.length);
    expect(guide.match(/<programme /g)).toHaveLength(programmes.length);
    expect(guide.match(/<\/programme>/g)).toHaveLength(programmes.length);
    expect(guide).toMatch(
      /<programme start="20261121133000 \+0100" stop="20261121144500 \+0100" channel="SportkanalF1\.fake\.de">\n {4}<title lang="de">Live F1: 1\. Freies Training - GP Katar<\/title>/,
    );
    expect(guide).toMatch(/<episode-num system="xmltv_ns">\d+\.\d+\/\d+\.<\/episode-num>/);
    expect(guide).toMatch(/<episode-num system="onscreen">S\d\d E\d\d<\/episode-num>/);
    expect(guide).toContain('<category lang="de">Spielfilm</category>');
    expect(guide).toMatch(/<rating system="FSK">\n {6}<value>\d+<\/value>/);
    expect(guide.trimEnd().endsWith("</tv>")).toBe(true);
  });

  it("marks repeats as previously shown, with the repeat marker the guide gave the title", () => {
    const weekend = channels.flatMap((channel) =>
      programmesBetween(channel, from, new Date(from.getTime() + 72 * 3_600_000), tz),
    );
    const guide = renderXmltv({ baseUrl, channels, programmes: weekend, timeZone: tz });
    expect(guide).toMatch(
      /<title lang="de">F1: Rennen - GP Katar \(Wh\.\)<\/title>\n(?: {4}<(?!\/programme).*\n)*? {4}<previously-shown \/>/,
    );
    expect(guide).toMatch(
      /<title lang="de">Landesschau<\/title>\n {4}<sub-title lang="de">Das Magazin<\/sub-title>/,
    );
  });

  it("writes every programme twice with duplicates, like tvproxy", () => {
    const once = renderXmltv({ baseUrl, channels, programmes, timeZone: tz });
    const twice = renderXmltv({ baseUrl, channels, programmes, timeZone: tz, duplicates: true });
    expect(twice.match(/<programme /g)).toHaveLength(programmes.length * 2);
    const first = /<programme [\s\S]*?<\/programme>/.exec(twice)?.[0] ?? "";
    expect(twice).toContain(`${first}\n  ${first}`);
    expect(once).not.toContain(`${first}\n  ${first}`);
  });

  it("escapes markup in text", () => {
    const programme: Programme = {
      channelId: "A&B",
      start: from,
      stop: to,
      title: 'Tom & "Jerry" <live>',
      description: "it's",
      categories: [],
    };
    const guide = renderXmltv({ baseUrl, channels: [], programmes: [programme], timeZone: tz });
    expect(guide).toContain('channel="A&amp;B"');
    expect(guide).toContain('<title lang="de">Tom &amp; &quot;Jerry&quot; &lt;live&gt;</title>');
    expect(guide).toContain('<desc lang="de">it&apos;s</desc>');
  });
});

describe("renderLogo", () => {
  it("draws the channel colour and initials", () => {
    const [f1] = channels;
    if (!f1) throw new Error("no channels");
    const svg = renderLogo(f1);
    expect(svg).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
    expect(svg).toContain(`fill="${f1.colour}"`);
    expect(svg).toContain(">SFH</text>");
  });
});
