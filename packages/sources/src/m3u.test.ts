import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseAttributes, parseM3u } from "./m3u.ts";

const fixture = readFileSync(new URL("../fixtures/tvproxy-playlist.m3u", import.meta.url), "utf8");

describe("parseM3u on the tvproxy fixture", () => {
  const playlist = parseM3u(fixture);

  it("reads every entry with its tvg attributes", () => {
    expect(playlist.issues).toEqual([]);
    expect(playlist.entries).toHaveLength(7);
    const f1 = playlist.entries[1];
    expect(f1).toMatchObject({
      name: "Sky Sport F1",
      tvgId: "ch1004",
      tvgName: "Sky Sport F1",
      groupTitle: "Sky Sport",
      channelNumber: "4",
      duration: -1,
      tvgLogo: "http://tvproxy.example:64321/logo/ch1004.png",
      url: "http://tvproxy.example:64321/?token=example-token-2&client=&hash=0000000000000000&expire=1700000000",
    });
    expect(f1?.attributes["channel-id"]).toBe("streamId9002");
  });

  it("keeps the second listing of a channel in another group", () => {
    const f1 = playlist.entries.filter((entry) => entry.tvgId === "ch1004");
    expect(f1.map((entry) => entry.groupTitle)).toEqual(["Sky Sport", "Sky Sport - simpliTV"]);
  });

  it("reads guide URLs from the header without repeats", () => {
    expect(playlist.guideUrls).toEqual(["http://tvproxy.example:64321/epg.xml"]);
  });

  it("leaves a missing logo undefined", () => {
    expect(playlist.entries[5]?.tvgLogo).toBeUndefined();
    expect(playlist.entries[5]?.name).toBe("Alarm für Cobra 11 / Balko");
  });
});

describe("parseM3u on messy input", () => {
  it("handles BOM, CRLF, unquoted and single-quoted values and commas in values", () => {
    const text =
      String.fromCharCode(0xfeff) +
      "#EXTM3U\r\n" +
      "#EXTINF:-1 tvg-id=one.de tvg-name='One HD' group-title=\"News, Sport\",One HD\r\n" +
      "http://example.com/1.ts\r\n";
    const playlist = parseM3u(text);
    expect(playlist.issues).toEqual([]);
    expect(playlist.entries[0]).toMatchObject({
      name: "One HD",
      tvgId: "one.de",
      tvgName: "One HD",
      groupTitle: "News, Sport",
    });
  });

  it("keeps quotes inside a quoted value and a comma inside the name", () => {
    const playlist = parseM3u(
      '#EXTM3U\n#EXTINF:-1 tvg-name="Foo "HD"" tvg-id="foo",Foo, the channel\nhttp://example.com/foo\n',
    );
    expect(playlist.entries[0]).toMatchObject({
      tvgName: 'Foo "HD"',
      tvgId: "foo",
      name: "Foo, the channel",
    });
  });

  it("falls back to tvg-name, #EXTGRP and #EXTVLCOPT", () => {
    const playlist = parseM3u(
      [
        "#EXTM3U",
        '#EXTINF:-1 tvg-name="Fallback Name",',
        "#EXTGRP:Movies",
        "#EXTVLCOPT:http-user-agent=Mozilla/5.0 Test",
        "#EXTVLCOPT:http-referrer=https://example.com/",
        "http://example.com/2.ts",
        "#EXTINF:-1,Plain",
        "http://example.com/3.ts",
      ].join("\n"),
    );
    expect(playlist.entries[0]).toMatchObject({
      name: "Fallback Name",
      groupTitle: "Movies",
      userAgent: "Mozilla/5.0 Test",
      referrer: "https://example.com/",
    });
    // #EXTGRP and VLC options apply to one entry only.
    expect(playlist.entries[1]).toMatchObject({ name: "Plain" });
    expect(playlist.entries[1]?.groupTitle).toBeUndefined();
    expect(playlist.entries[1]?.userAgent).toBeUndefined();
  });

  it("splits the header's guide URLs", () => {
    const playlist = parseM3u(
      [
        '#EXTM3U catchup="shift" x-tvg-url="http://a.example/guide.xml,http://b.example/guide.xml.gz"',
        '#EXTINF:-1 tvg-id="a",A',
        "http://example.com/a",
      ].join("\n"),
    );
    expect(playlist.guideUrls).toEqual([
      "http://a.example/guide.xml",
      "http://b.example/guide.xml.gz",
    ]);
  });

  it("reports and skips junk without losing the next entry", () => {
    const playlist = parseM3u(
      [
        '#EXTINF:-1 tvg-id="lost",Lost',
        '#EXTINF:-1 tvg-id="x",X',
        "not a url",
        "http://example.com/x",
        "rtmp://example.com/live/y",
        "#EXTINF:-1,Dangling",
      ].join("\n"),
    );
    expect(playlist.entries.map((entry) => entry.name)).toEqual(["X"]);
    expect(playlist.issues).toEqual([
      { line: 1, message: "missing #EXTM3U header" },
      { line: 1, message: "#EXTINF without a stream URL skipped" },
      { line: 3, message: "not a stream URL: not a url" },
      { line: 5, message: "stream URL skipped: only http and https are supported, got rtmp:" },
      { line: 6, message: "#EXTINF without a stream URL skipped" },
    ]);
  });

  it("refuses stream URLs that would make ffmpeg read local files", () => {
    const playlist = parseM3u(
      [
        "#EXTM3U",
        '#EXTINF:-1 tvg-id="secrets" group-title="Local",Secrets',
        "file:///etc/passwd",
        '#EXTINF:-1 tvg-id="joined",Joined',
        "concat:/etc/passwd|/etc/hosts",
        "#EXTINF:-1,Real",
        "HTTPS://provider.test/live/1.ts",
      ].join("\n"),
    );
    // The file entry goes with its #EXTINF; the concat line leaves "Joined" waiting, and the
    // next #EXTINF replaces it.
    expect(playlist.entries.map((entry) => [entry.name, entry.url, entry.groupTitle])).toEqual([
      ["Real", "HTTPS://provider.test/live/1.ts", undefined],
    ]);
    expect(playlist.issues).toEqual([
      { line: 3, message: "stream URL skipped: only http and https are supported, got file:" },
      { line: 5, message: "not a stream URL: concat:/etc/passwd|/etc/hosts" },
      { line: 4, message: "#EXTINF without a stream URL skipped" },
    ]);
  });

  it("returns an empty playlist for an HTML page", () => {
    const playlist = parseM3u("<!doctype html><html><body>Login</body></html>");
    expect(playlist.entries).toEqual([]);
  });
});

describe("parseAttributes", () => {
  it("returns the text after the first unquoted comma", () => {
    expect(parseAttributes(' a="1,2" b=3 , Name, with comma')).toEqual({
      attributes: { a: "1,2", b: "3" },
      rest: " Name, with comma",
    });
  });

  it("lower-cases keys and tolerates an unterminated quote", () => {
    expect(parseAttributes(' TVG-ID="abc')).toEqual({
      attributes: { "tvg-id": "abc" },
      rest: undefined,
    });
  });
});
