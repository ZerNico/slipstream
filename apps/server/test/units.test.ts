/**
 * The pure and near-pure pieces: password hashing, user codes, rate limiting, source mapping,
 * sealed source secrets, FTS query building, byte ranges, retention policies, capture states,
 * hardware detection parsing and the mDNS announcement.
 */
import { assert, describe, it } from "@effect/vitest";
import { DateTime, Effect, Layer } from "effect";
import { TestClock } from "effect/testing";
import { expiredRecordings } from "@slipstream/recorder";
import type { XmltvProgramme } from "@slipstream/sources";
import {
  hashPassword,
  storedUserCode,
  randomUserCode,
  userCodeAlphabet,
  verifyPassword,
} from "../src/auth/crypto.ts";
import { backoffDelay, RateLimiter } from "../src/auth/rate-limit.ts";
import { ftsQuery } from "../src/guide/service.ts";
import { parseByteRange } from "../src/hls/service.ts";
import { retentionCandidates, retentionGroups } from "../src/recorder/repos.ts";
import {
  parseXmltvDate,
  programmeId,
  programmeRow,
  streamCandidates,
  streamRequest,
  toRewriteRules,
} from "../src/sources/mapping.ts";
import { isSealed, openWith, SecretBox, sealWith } from "../src/sources/secret-box.ts";
import { deriveKey, readSecretKey, SecretKey, secretKeyFile } from "../src/auth/secret-key.ts";
import { SIGNING_LABEL, Signing } from "../src/auth/signing.ts";
import { hmac } from "../src/auth/crypto.ts";
import { ServerConfig } from "../src/config.ts";
import { tempDir, testSettings } from "./support.ts";
import { advertisedUrl, instanceName } from "../src/system/advertise.ts";
import { parseEncoderList, summarise, testEncodeArgs } from "../src/system/hardware.ts";
import type { M3uEntry } from "@slipstream/sources";
import {
  ChannelId,
  type Collection,
  CollectionId,
  type Recording,
  RecordingId,
  type Rule,
  RuleId,
  UserId,
} from "@slipstream/domain";
import { randomBytes } from "node:crypto";
import { statSync } from "node:fs";
import { join } from "node:path";

describe("passwords", () => {
  it.effect("hashes with a fresh salt and verifies only the right password", () =>
    Effect.gen(function* () {
      const first = yield* hashPassword("correct horse battery staple");
      const second = yield* hashPassword("correct horse battery staple");
      assert.match(first, /^scrypt\$32768\$8\$1\$[\w-]+\$[\w-]+$/);
      assert.notStrictEqual(first, second);
      assert.isTrue(yield* verifyPassword("correct horse battery staple", first));
      assert.isFalse(yield* verifyPassword("correct horse battery stapler", first));
      assert.isFalse(yield* verifyPassword("anything", "not-a-hash"));
    }),
  );
});

describe("user codes", () => {
  it("uses only characters that read unambiguously on a TV", () => {
    assert.notMatch(userCodeAlphabet, /[01OI]/);
    for (let index = 0; index < 200; index += 1) {
      assert.match(randomUserCode(), /^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
    }
  });

  it("accepts what people type: any case, spaces or no dash", () => {
    assert.strictEqual(storedUserCode("abcd efgh"), "ABCD-EFGH");
    assert.strictEqual(storedUserCode("ABCDEFGH"), "ABCD-EFGH");
    assert.strictEqual(storedUserCode(" abcd-efgh "), "ABCD-EFGH");
  });
});

describe("RateLimiter", () => {
  const limit = { max: 2, windowMillis: 60_000 };
  it.effect("refuses a key over its limit until the window passes", () =>
    Effect.gen(function* () {
      const limiter = yield* RateLimiter;
      yield* limiter.hit("k", limit);
      yield* limiter.hit("k", limit);
      const refused = yield* limiter.check("k", limit).pipe(Effect.flip);
      assert.strictEqual(refused.retryAfterSeconds, 60);
      yield* limiter.check("other", limit);
      yield* TestClock.adjust("61 seconds");
      yield* limiter.check("k", limit);
      yield* limiter.hit("k", limit);
      yield* limiter.reset("k");
      yield* limiter.consume("k", limit);
    }).pipe(Effect.provide(Layer.fresh(RateLimiter.layer))),
  );

  const backoff = { free: 2, baseMillis: 1000, maxMillis: 4000, forgetMillis: 3_600_000 };

  it("doubles the backoff after the free failures, up to its maximum", () => {
    assert.deepStrictEqual(
      [1, 2, 3, 4, 5, 6].map((failures) => backoffDelay(backoff, failures)),
      [0, 0, 1000, 2000, 4000, 4000],
    );
  });

  it.effect(
    "makes a key wait out its backoff through reserve, never locks it, and forgets it",
    () =>
      Effect.gen(function* () {
        const limiter = yield* RateLimiter;
        const attempt = (key: string) => limiter.reserve([{ key, backoff }]);
        // Two free failures, then each one makes the next attempt wait.
        yield* attempt("u");
        yield* attempt("u");
        yield* attempt("u");
        const refused = yield* attempt("u").pipe(Effect.flip);
        assert.strictEqual(refused.retryAfterSeconds, 1);
        yield* TestClock.adjust("1 second");
        yield* attempt("u");
        assert.strictEqual((yield* attempt("u").pipe(Effect.flip)).retryAfterSeconds, 2);
        // A right secret resets the key: the next attempt passes at once.
        yield* limiter.reset("u");
        yield* attempt("u");
        yield* attempt("v");
        yield* attempt("v");
        yield* attempt("v");
        yield* TestClock.adjust("1 hour");
        // An hour without failures starts over: this is the first one again, and so is free.
        yield* attempt("v");
        yield* attempt("v");
      }).pipe(Effect.provide(Layer.fresh(RateLimiter.layer))),
  );

  it.effect("keeps each window by its own length, whatever limit counts next", () =>
    Effect.gen(function* () {
      const limiter = yield* RateLimiter;
      const short = { max: 1, windowMillis: 1_000 };
      const long = { max: 1, windowMillis: 3_600_000 };
      yield* limiter.consume("short", short);
      yield* limiter.consume("long", long);
      yield* TestClock.adjust("2 seconds");
      // The short window ran out; the long one still holds.
      yield* limiter.consume("short", short);
      assert.isAbove(
        (yield* limiter.consume("long", long).pipe(Effect.flip)).retryAfterSeconds,
        3000,
      );
    }).pipe(Effect.provide(Layer.fresh(RateLimiter.layer))),
  );
});

const entry = (overrides: Partial<M3uEntry>): M3uEntry => ({
  name: "Das Erste HD",
  url: "http://provider.test/live/1.ts?token=abc",
  duration: -1,
  attributes: {},
  line: 2,
  ...overrides,
});

describe("source mapping", () => {
  it("keys streams by tvg-id, else name, and skips URLs that are not http", () => {
    const streams = streamCandidates([
      entry({ tvgId: "ard.de", tvgLogo: "http://provider.test/ard.png", channelNumber: "1" }),
      entry({ tvgId: "ard.de" }),
      entry({ name: "Radio", url: "rtsp://provider.test/radio" }),
      entry({ name: "No Id", tvgLogo: "data:image/png;base64,xx" }),
    ]);
    assert.deepStrictEqual(
      streams.map((stream) => [stream.upstreamId, stream.logoUrl]),
      [
        ["ard.de", "http://provider.test/ard.png"],
        ["ard.de#2", undefined],
        ["No Id", undefined],
      ],
    );
  });

  it("asks for a stream with the playlist's user agent and referrer for it", () => {
    const [stream] = streamCandidates([
      entry({ userAgent: "VLC/3.0.20", referrer: "http://portal.test/" }),
    ]);
    assert.strictEqual(stream?.userAgent, "VLC/3.0.20");
    assert.strictEqual(stream?.referrer, "http://portal.test/");
    // The playlist's own values win over the source's; other source headers stay.
    assert.deepStrictEqual(
      streamRequest(
        "Slipstream",
        { referer: "http://old.test/", "x-key": "k" },
        {
          userAgent: "VLC/3.0.20",
          referrer: "http://portal.test/",
        },
      ),
      { userAgent: "VLC/3.0.20", headers: { "x-key": "k", Referer: "http://portal.test/" } },
    );
    assert.deepStrictEqual(streamRequest("Slipstream", {}, { userAgent: null, referrer: null }), {
      userAgent: "Slipstream",
    });
    assert.deepStrictEqual(streamRequest(undefined, {}, { userAgent: null, referrer: null }), {});
  });

  it("keys a nameless stream by a hash of its URL, never by its credentials", () => {
    // Without a name of its own, the parser names an entry by its URL.
    const credentialed = "http://me:pw@provider.test/live/1.ts?token=abc";
    const streams = streamCandidates([
      entry({ name: credentialed, url: credentialed }),
      entry({ name: " ", url: "http://provider.test/live/1.ts?token=rotated" }),
    ]);
    assert.deepStrictEqual(
      streams.map((stream) => stream.name),
      ["http://provider.test/live/1.ts", "http://provider.test/live/1.ts"],
    );
    const [first, second] = streams.map((stream) => stream.upstreamId);
    assert.match(first ?? "", /^url:[\w-]{22}$/);
    // Rotating tokens or credentials keeps the id; the repeat gets its suffix.
    assert.strictEqual(second, `${first}#2`);
    for (const id of [first, second]) {
      assert.notInclude(id, "abc");
      assert.notInclude(id, "pw");
      assert.notInclude(id, "provider.test");
    }
  });

  it("maps XMLTV programmes to rows with stable ids and drops ones without a stop", () => {
    const programme: XmltvProgramme = {
      _tag: "Programme",
      channel: "ard.de",
      start: Date.UTC(2026, 10, 22, 4),
      stop: Date.UTC(2026, 10, 22, 6),
      title: "Live F1: Rennen",
      subTitle: "GP Las Vegas",
      categories: ["Sport"],
      episode: { season: 2026, episode: 22, xmltvNs: "2025.21." },
      icon: "http://img.test/f1.jpg",
      date: "20261122",
      isNew: false,
      premiere: false,
      previouslyShown: true,
      live: true,
    };
    const row = programmeRow("s1", programme);
    assert.strictEqual(row?.id, programmeId("s1", "ard.de", programme.start));
    assert.deepStrictEqual(row?.episode, { season: 2026, episode: 22 });
    assert.deepStrictEqual(row?.originalAirDate, { year: 2026, month: 11, day: 22 });
    assert.isTrue(row?.repeat);
    assert.isUndefined(programmeRow("s1", { ...programme, stop: undefined }));
    assert.notStrictEqual(programmeId("s1", "ard.de", 1), programmeId("s2", "ard.de", 1));
  });

  it("reads partial XMLTV dates", () => {
    assert.deepStrictEqual(parseXmltvDate("1999"), { year: 1999 });
    assert.deepStrictEqual(parseXmltvDate("199913"), { year: 1999 });
    assert.deepStrictEqual(parseXmltvDate("19990704 +0200"), { year: 1999, month: 7, day: 4 });
    assert.isUndefined(parseXmltvDate("soon"));
  });

  it("turns domain rewrites into adapter rules", () => {
    assert.deepStrictEqual(
      toRewriteRules({
        removeDuplicates: true,
        rewrites: [{ field: "subtitle", pattern: "^Folge (\\d+)$", replacement: "Episode $1" }],
      }),
      [{ field: "subTitle", pattern: "^Folge (\\d+)$", set: { subTitle: "Episode $1" } }],
    );
  });
});

describe("sealed source secrets", () => {
  const key = randomBytes(32);

  it("seals with a fresh IV every time and opens again", () => {
    const plain = JSON.stringify({ _tag: "M3u", playlistUrl: "http://p.test/get.php?token=abc" });
    const first = sealWith(key, plain);
    const second = sealWith(key, plain);
    assert.isTrue(isSealed(first));
    assert.notStrictEqual(first, second);
    assert.notInclude(first, "token=abc");
    assert.strictEqual(openWith(key, first), plain);
  });

  it("refuses values that are not sealed", () => {
    assert.isFalse(isSealed('{"a":1}'));
    assert.throws(() => openWith(key, '{"a":1}'));
  });

  it.effect("seals with the raw secret key and keeps opening after a restart", () =>
    Effect.gen(function* () {
      const root = yield* tempDir;
      const box = Layer.fresh(SecretBox.layer).pipe(
        Layer.provide(Layer.fresh(SecretKey.layer)),
        Layer.provide(ServerConfig.layerWith(testSettings(root))),
      );
      const sealed = yield* Effect.map(SecretBox, (opened) => opened.seal({ a: 1 })).pipe(
        Effect.provide(box),
      );
      // `v1:` values are sealed with the file's own bytes, as before the key was shared.
      const raw = readSecretKey(join(root, "config"));
      assert.deepStrictEqual(JSON.parse(openWith(raw, sealed)), { a: 1 });
      const opened = yield* Effect.flatMap(SecretBox, (again) => again.open(sealed)).pipe(
        Effect.provide(box),
      );
      assert.deepStrictEqual(opened, { a: 1 });
    }).pipe(Effect.scoped),
  );

  it("refuses a value sealed with another key", () => {
    const sealed = sealWith(randomBytes(32), "secret");
    assert.throws(() => openWith(key, sealed));
  });
});

describe("secret key", () => {
  it.effect("creates a private key file in a private directory on first start, once", () =>
    Effect.gen(function* () {
      const root = yield* tempDir;
      const configDir = join(root, "config");
      const layer = Layer.fresh(SecretKey.layer).pipe(
        Layer.provide(ServerConfig.layerWith(testSettings(root))),
      );
      const first = yield* Effect.provide(
        Effect.map(SecretKey, (key) => key),
        layer,
      );
      assert.strictEqual(statSync(configDir).mode & 0o777, 0o700);
      assert.strictEqual(statSync(join(configDir, secretKeyFile)).mode & 0o777, 0o600);
      assert.strictEqual(first.raw.length, 32);
      // A second start (or a process that lost the race to create it) reads the same key.
      const second = yield* Effect.provide(
        Effect.map(SecretKey, (key) => key),
        layer,
      );
      assert.isTrue(second.raw.equals(first.raw));
      assert.isTrue(readSecretKey(configDir).equals(first.raw));
    }).pipe(Effect.scoped),
  );

  it("derives an unrelated key per label, and signing uses its own", () => {
    const raw = randomBytes(32);
    const signing = deriveKey(raw, SIGNING_LABEL);
    assert.strictEqual(signing.length, 32);
    assert.isFalse(signing.equals(raw));
    assert.isFalse(signing.equals(deriveKey(raw, "another purpose")));
    assert.isTrue(signing.equals(deriveKey(raw, SIGNING_LABEL)));
  });

  it.effect("signs CSRF tokens with the derived signing key", () =>
    Effect.gen(function* () {
      const root = yield* tempDir;
      const layer = Signing.layer.pipe(
        Layer.provideMerge(Layer.fresh(SecretKey.layer)),
        Layer.provide(ServerConfig.layerWith(testSettings(root))),
      );
      const [signing, key] = yield* Effect.provide(
        Effect.all([
          Effect.map(Signing, (service) => service),
          Effect.map(SecretKey, (service) => service),
        ]),
        layer,
      );
      assert.strictEqual(
        signing.csrfFor("session"),
        hmac(key.derive(SIGNING_LABEL), "csrf:session"),
      );
      assert.notStrictEqual(signing.csrfFor("session"), hmac(key.raw, "csrf:session"));
    }).pipe(Effect.scoped),
  );
});

describe("ftsQuery", () => {
  it("makes every word a quoted prefix and strips FTS syntax", () => {
    assert.strictEqual(ftsQuery("qual f1"), '"qual"* "f1"*');
    assert.strictEqual(ftsQuery('Live: "F1" (Rennen)*'), '"Live"* "F1"* "Rennen"*');
    assert.isUndefined(ftsQuery('  "*"  '));
    assert.strictEqual(ftsQuery("Kurzsendung 16:04"), '"Kurzsendung"* "16 04"*');
  });
});

describe("parseByteRange", () => {
  it("reads single ranges and ignores what it cannot serve", () => {
    assert.deepStrictEqual(parseByteRange("bytes=0-99", 1000), { start: 0, end: 99 });
    assert.deepStrictEqual(parseByteRange("bytes=900-", 1000), { start: 900, end: 999 });
    assert.deepStrictEqual(parseByteRange("bytes=-100", 1000), { start: 900, end: 999 });
    assert.deepStrictEqual(parseByteRange("bytes=500-5000", 1000), { start: 500, end: 999 });
    assert.strictEqual(parseByteRange("bytes=1000-", 1000), "unsatisfiable");
    assert.isUndefined(parseByteRange(undefined, 1000));
    assert.isUndefined(parseByteRange("bytes=0-1,5-6", 1000));
    assert.isUndefined(parseByteRange("bytes=9-3", 1000));
  });
});

const at = (day: number) => DateTime.makeUnsafe(Date.UTC(2026, 10, day, 20));

const recording = (id: string, day: number, fields: Partial<Recording> = {}): Recording => ({
  id: RecordingId.make(id),
  channelId: ChannelId.make("sport"),
  start: at(day),
  end: DateTime.add(at(day), { hours: 1 }),
  title: "Show",
  categories: [],
  repeat: false,
  live: false,
  padding: { beforeMinutes: 0, afterMinutes: 0 },
  state: "completed",
  problems: [],
  ownerIds: [UserId.make("u1")],
  protected: false,
  labels: [],
  exportStatus: "none",
  createdAt: at(day),
  ...fields,
});

const rule: Rule = {
  id: RuleId.make("r1"),
  name: "Show",
  enabled: true,
  ownerId: UserId.make("u1"),
  matcher: {
    channels: [],
    title: [{ _tag: "IsExactly", values: ["Show"] }],
    categories: [],
    weekdays: [],
  },
  padding: { beforeMinutes: 0, afterMinutes: 0 },
  retention: { _tag: "KeepNewest", count: 2 },
  createdAt: at(1),
  skipRepeats: false,
  offerDeclined: false,
};

describe("retention policies", () => {
  const now = Date.UTC(2026, 10, 21);

  it("keeps a rule's newest recordings and names the policy and reason for the rest", () => {
    const all = [1, 2, 3, 4].map((day) => recording(`rec-${day}`, day, { ruleId: rule.id }));
    const groups = retentionGroups(all, [], [rule], "Europe/Berlin");
    assert.deepStrictEqual(
      retentionCandidates(all, groups, now).toSorted((a, b) =>
        a.recordingId.localeCompare(b.recordingId),
      ),
      ["rec-1", "rec-2"].map((id) => ({
        recordingId: RecordingId.make(id),
        reason: { _tag: "BeyondNewest" as const, count: 2 },
        policyFrom: { _tag: "Rule" as const, ruleId: rule.id },
      })),
    );
  });

  it("lets a collection's policy win over the rule's and never deletes protected ones", () => {
    const collection: Collection = {
      id: CollectionId.make("c1"),
      name: "Shows",
      rank: 0,
      matcher: rule.matcher,
      labels: [],
      layout: { parts: [], path: ["{title}"] },
      retention: { _tag: "KeepNewest", count: 1 },
    };
    const all = [
      recording("old", 1, { ruleId: rule.id, protected: true }),
      recording("mid", 2, { ruleId: rule.id }),
      recording("new", 3, { ruleId: rule.id }),
      recording("running", 4, { ruleId: rule.id, state: "recording" }),
    ];
    const groups = retentionGroups(all, [collection], [rule], "Europe/Berlin");
    assert.deepStrictEqual(
      groups.map((group) => group.id),
      ["collection:c1"],
    );
    // Keep the newest one: the running recording is about to be it, so both finished
    // unprotected ones go (the domain's applyRetention, which the sweep uses too).
    assert.deepStrictEqual(
      retentionCandidates(all, groups, now).map((candidate) => [
        candidate.recordingId,
        candidate.policyFrom._tag,
      ]),
      [
        ["mid", "Collection"],
        ["new", "Collection"],
      ],
    );
    // What the preview shows is exactly what the next sweep deletes.
    assert.deepStrictEqual(
      [...expiredRecordings(all, groups, now)].toSorted(),
      retentionCandidates(all, groups, now)
        .map((candidate) => candidate.recordingId as string)
        .toSorted(),
    );
  });

  it("keeps recordings without a rule or a collection policy", () => {
    const all = [1, 2, 3].map((day) => recording(`manual-${day}`, day));
    assert.deepStrictEqual(retentionGroups(all, [], [rule], "Europe/Berlin"), []);
  });
});

describe("hardware detection", () => {
  it("reads encoder names from ffmpeg -encoders", () => {
    const listed = parseEncoderList(
      [
        "Encoders:",
        " V..... = Video",
        " ------",
        " V....D libx264              libx264 H.264 / AVC",
        " V....D h264_nvenc           NVIDIA NVENC H.264 encoder (codec h264)",
        " A....D aac                  AAC (Advanced Audio Coding)",
      ].join("\n"),
    );
    assert.isTrue(listed.has("h264_nvenc"));
    assert.isTrue(listed.has("libx264"));
    assert.isFalse(listed.has("------"));
  });

  it("test-encodes VAAPI through its render node with the asked rate control", () => {
    const args = testEncodeArgs({ encoder: "vaapi", codec: "h264", name: "h264_vaapi" }, "cqp");
    assert.includeMembers(args, ["-vaapi_device", "h264_vaapi", "CQP", "null"]);
  });

  it("groups working encoders by family and drops ones that failed every mode", () => {
    assert.deepStrictEqual(
      summarise([
        { candidate: { encoder: "nvenc", codec: "h264", name: "h264_nvenc" }, modes: ["vbr"] },
        {
          candidate: { encoder: "nvenc", codec: "hevc", name: "hevc_nvenc" },
          modes: ["vbr", "cqp"],
        },
        { candidate: { encoder: "qsv", codec: "h264", name: "h264_qsv" }, modes: [] },
      ]),
      { encoders: [{ encoder: "nvenc", codecs: ["h264", "hevc"], rateControl: ["vbr", "cqp"] }] },
    );
  });
});

describe("mDNS announcement", () => {
  it("announces the public URL, else the LAN address", () => {
    assert.strictEqual(
      advertisedUrl("https://tv.example.com", 8080, "10.0.0.2"),
      "https://tv.example.com",
    );
    assert.strictEqual(advertisedUrl(undefined, 8080, "10.0.0.2"), "http://10.0.0.2:8080");
    assert.strictEqual(instanceName("nas.local"), "Slipstream (nas)");
  });
});
