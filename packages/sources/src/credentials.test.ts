import { describe, expect, it } from "@effect/vitest";
import {
  mayReceiveHeaders,
  redactSecrets,
  stripUrl,
  streamRequestHeaders,
  streamSecrets,
} from "./credentials.ts";

describe("redaction", () => {
  it("redacts credentials, query and fragment from URLs", () => {
    expect(stripUrl("http://user:pass@tv.example:8080/get.php?username=u&password=p#x")).toBe(
      "http://tv.example:8080/get.php",
    );
    expect(stripUrl("not a url")).toBe("(invalid URL)");
    expect(stripUrl("http://u:p@tv.example/live/u/p/1.ts", ["u", "p"])).toBe(
      "http://tv.example/live/***/***/1.ts",
    );
  });

  it("redacts every URL in a log line and secrets outside them", () => {
    const secrets = ["u", "p", "s3cret-token"];
    expect(
      redactSecrets(
        "[http @ 0x1] Opening 'http://u:p@127.0.0.1:9/live/u/p/1.ts?token=s3cret-token' for reading",
        secrets,
      ),
    ).toBe("[http @ 0x1] Opening 'http://127.0.0.1:9/live/***/***/1.ts' for reading");
    expect(redactSecrets("http://u:p@127.0.0.1:9/live/u/p/1.ts: Connection refused", secrets)).toBe(
      "http://127.0.0.1:9/live/***/***/1.ts: Connection refused",
    );
    // Short secrets are whole path segments only; elsewhere they would mangle ordinary words.
    expect(redactSecrets("header s3cret-token sent, upstream paused", secrets)).toBe(
      "header *** sent, upstream paused",
    );
  });
});

describe("stream request headers and secrets", () => {
  const source = {
    config: {
      _tag: "M3u" as const,
      playlistUrl: "http://provider.test:8080/get.php?username=me&password=pw",
    },
    headers: { referer: "http://provider.test/" },
    secretHeaders: { authorization: "Bearer t0ken" },
  };

  it("trusts only the origin a URL belongs to", () => {
    expect(mayReceiveHeaders(source.config.playlistUrl, "http://provider.test:8080/x")).toBe(true);
    expect(mayReceiveHeaders(source.config.playlistUrl, "http://provider.test/x")).toBe(false);
    expect(mayReceiveHeaders(source.config.playlistUrl, "not a url")).toBe(false);
  });

  it("sends secret headers only to streams on the source's origin", () => {
    expect(streamRequestHeaders(source, "http://provider.test:8080/live/1.ts")).toEqual({
      referer: "http://provider.test/",
      authorization: "Bearer t0ken",
    });
    // Another host, or the same host on another port or scheme, gets the plain headers only.
    for (const url of [
      "http://cdn.example/live/1.ts",
      "http://provider.test:9090/live/1.ts",
      "https://provider.test:8080/live/1.ts",
    ]) {
      expect(streamRequestHeaders(source, url)).toEqual({ referer: "http://provider.test/" });
    }
    // An Xtream source's origin is its server.
    const xtream = {
      config: {
        _tag: "Xtream" as const,
        serverUrl: "http://xtream.test",
        username: "me",
        password: "pw",
      },
      secretHeaders: { "x-key": "k" },
    };
    expect(streamRequestHeaders(xtream, "http://xtream.test/live/me/pw/1.ts")).toEqual({
      "x-key": "k",
    });
  });

  it("lists every credential a log line about a stream must not show", () => {
    expect(
      streamSecrets(source, "http://u:p@cdn.example/live/u/p/1.ts?token=abc").toSorted(),
    ).toEqual(["Bearer t0ken", "abc", "me", "p", "pw", "u"].toSorted());
  });
});
