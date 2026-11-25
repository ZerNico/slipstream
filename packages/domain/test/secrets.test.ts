import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import { SourceId, SourceStreamId } from "../src/ids.ts";
import {
  applySecretHeadersPatch,
  applySourceConfigPatch,
  redactUrl,
  sensitivePlainHeaders,
  SourceConfigPatch,
  SourceView,
  viewSource,
  viewSourceStream,
} from "../src/secrets.ts";
import { HttpUrl, type Source, type SourceConfig } from "../src/source.ts";
import { at } from "./test-support.ts";

const url = (value: string) => Schema.decodeUnknownSync(HttpUrl)(value);

const xtream: Source = {
  id: SourceId.make("provider"),
  name: "Provider",
  config: {
    _tag: "Xtream",
    serverUrl: url("http://line.example.com:8080"),
    username: "alice",
    password: "hunter2",
  },
  refreshIntervalMinutes: 720,
  headers: { "User-Agent": "VLC/3.0" },
  secretHeaders: { Authorization: "Bearer abc.def" },
  guideCleanup: { removeDuplicates: true, rewrites: [] },
  enabled: true,
  health: "ok",
};

const tvproxy: SourceConfig = {
  _tag: "M3u",
  playlistUrl: url("http://tvproxy.lan/get.php?username=alice&password=hunter2&type=m3u_plus"),
  guideUrl: url("http://tvproxy.lan/xmltv.php"),
};

describe("source views", () => {
  it("say a password is set without carrying it", () => {
    const view = viewSource(xtream);
    expect(view.config).toEqual({
      _tag: "Xtream",
      serverUrl: { url: "http://line.example.com:8080", hasCredentials: false },
      username: "alice",
      hasPassword: true,
    });
    expect(view.secretHeaderNames).toEqual(["Authorization"]);
    expect(view.headers).toEqual({ "User-Agent": "VLC/3.0" });
  });

  it("never leak a secret through the wire encoding, even from an unfiltered object", () => {
    const encoded = JSON.stringify(
      Schema.encodeUnknownSync(SourceView)({
        ...viewSource(xtream),
        ...xtream,
        config: viewSource(xtream).config,
      }),
    );
    expect(encoded).not.toContain("hunter2");
    expect(encoded).not.toContain("abc.def");
    expect(encoded).not.toContain('secretHeaders"');
  });

  it("mask credentials in playlist URLs", () => {
    const view = viewSource({ ...xtream, config: tvproxy });
    expect(view.config).toEqual({
      _tag: "M3u",
      playlistUrl: {
        url: "http://tvproxy.lan/get.php?username=***&password=***&type=m3u_plus",
        hasCredentials: true,
      },
      guideUrl: { url: "http://tvproxy.lan/xmltv.php", hasCredentials: false },
    });
  });

  it("drop stream URLs, whose paths can hold credentials", () => {
    const view = viewSourceStream({
      id: SourceStreamId.make("s1"),
      sourceId: xtream.id,
      upstreamId: "101",
      name: "Sky Sport F1",
      url: url("http://line.example.com:8080/live/alice/hunter2/101.ts"),
      lastSeenAt: at("2026-11-21T00:00:00Z"),
    });
    expect(JSON.stringify(view)).not.toContain("hunter2");
    expect(view.name).toBe("Sky Sport F1");
  });
});

describe("redactUrl", () => {
  it("masks user info and secret query values, and leaves clean URLs untouched", () => {
    expect(redactUrl("https://bob:pw@iptv.example.com/list.m3u?token=xyz&group=sport")).toBe(
      "https://***:***@iptv.example.com/list.m3u?token=***&group=sport",
    );
    expect(redactUrl("http://tvproxy.lan:8080/playlist.m3u")).toBe(
      "http://tvproxy.lan:8080/playlist.m3u",
    );
    expect(redactUrl("not a url")).toBe("***");
  });

  it("masks a lone user name or a lone query secret", () => {
    expect(redactUrl("http://bob@tuner.lan:5004/auto/v1")).toBe(
      "http://***@tuner.lan:5004/auto/v1",
    );
    expect(redactUrl("https://epg.example.com/guide.xml?key=abc#now")).toBe(
      "https://epg.example.com/guide.xml?key=***#now",
    );
  });
});

describe("config patches", () => {
  it("keep the stored password when the patch leaves it out", () => {
    const patch = Schema.decodeUnknownSync(SourceConfigPatch)({ _tag: "Xtream", username: "bob" });
    expect(applySourceConfigPatch(xtream.config, patch)).toEqual({
      ...xtream.config,
      username: "bob",
    });
  });

  it("replace the password when one is sent", () => {
    const result = applySourceConfigPatch(xtream.config, {
      _tag: "Xtream",
      username: "alice",
      password: "correct horse",
    });
    expect(result).toMatchObject({ password: "correct horse" });
  });

  it("ask for the secret when switching type", () => {
    expect(applySourceConfigPatch(tvproxy, { _tag: "Xtream", username: "alice" })).toEqual({
      _tag: "MissingSecret",
      field: "serverUrl",
    });
    expect(
      applySourceConfigPatch(tvproxy, {
        _tag: "Xtream",
        username: "alice",
        serverUrl: url("http://line.example.com"),
      }),
    ).toEqual({ _tag: "MissingSecret", field: "password" });
  });

  it("keep or remove the guide URL of an M3U source", () => {
    expect(applySourceConfigPatch(tvproxy, { _tag: "M3u" })).toEqual(tvproxy);
    expect(applySourceConfigPatch(tvproxy, { _tag: "M3u", guideUrl: null })).toEqual({
      _tag: "M3u",
      playlistUrl: tvproxy.playlistUrl,
    });
  });
});

describe("secret headers", () => {
  it("set, replace case-insensitively, remove with null and keep the rest", () => {
    expect(
      applySecretHeadersPatch(
        { Authorization: "Bearer old", "X-Api-Key": "k1" },
        { authorization: "Bearer new", "X-Api-Key": null, Cookie: "session=1" },
      ),
    ).toEqual({ authorization: "Bearer new", Cookie: "session=1" });
  });

  it("flags credentials put in plain headers", () => {
    expect(sensitivePlainHeaders({ "User-Agent": "VLC", authorization: "Basic x" })).toEqual([
      "authorization",
    ]);
  });
});
