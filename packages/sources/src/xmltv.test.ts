// The vitest plugin does not see it.effect / it.live as test blocks (chat and siva turn it off).
/* oxlint-disable vitest/no-standalone-expect */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "@effect/vitest";
import { Effect, Stream } from "effect";
import {
  collectXmltv,
  makeXmltvParser,
  parseXmltv,
  parseXmltvStream,
  XmltvFormatError,
  type XmltvProgramme,
} from "./xmltv.ts";

const fixture = readFileSync(new URL("../fixtures/tvproxy-guide.xml", import.meta.url), "utf8");
const utc = (iso: string) => Date.parse(iso);

const MESSY = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE tv SYSTEM "xmltv.dtd">
<tv generator-info-name="hand-made">
  <channel id="one.example">
    <display-name lang="de">Eins</display-name>
    <display-name lang="en">One</display-name>
    <icon src="https://logos.example/one.png"/>
    <url>https://one.example</url>
  </channel>
  <channel><display-name>No id</display-name></channel>
  <programme start="20261122183000 +0100" stop="20261122200000 +0100" channel="one.example">
    <title lang="en">The Race</title>
    <title lang="de">Das Rennen</title>
    <sub-title lang="de">Teil&nbsp;2</sub-title>
    <desc lang="de"><![CDATA[Ein <b>spannendes</b> Rennen
      mit   viel Regen.]]></desc>
    <credits><actor>Somebody</actor></credits>
    <category lang="de">Sport</category>
    <category lang="en">Motorsport</category>
    <category lang="de">Sport</category>
    <icon src="https://images.example/race.jpg" width="640"/>
    <episode-num system="xmltv_ns">2 . 9/12 . 0/2</episode-num>
    <episode-num system="onscreen">S3 E10</episode-num>
    <date>20261122</date>
    <country>AT</country>
    <new/>
    <premiere/>
    <live/>
  </programme>
  <programme start="202611222000" channel="one.example">
    <title>Late Show</title>
    <previously-shown/>
  </programme>
  <programme start="undefined" stop="undefined" channel="one.example"><title>keine Daten vorhanden</title></programme>
  <programme start="20261122220000 +0000" stop="20261122210000 +0000" channel="one.example"><title>Backwards</title></programme>
  <programme start="20261122230000 +0000" stop="20261123000000 +0000"><title>No channel</title></programme>
  <programme start="20261123000000 +0000" stop="20261123010000 +0000" channel="one.example"><title>Fish &amp; Chips &copy; &bogus; done</title></programme>
</tv>`;

describe("parseXmltv on the tvproxy fixture", () => {
  it.effect("reads channels and programmes and skips the placeholder with no times", () =>
    Effect.gen(function* () {
      const guide = yield* parseXmltv(fixture);
      expect(guide.channels).toHaveLength(7);
      expect(guide.channels[1]).toEqual({
        _tag: "Channel",
        id: "ch1004",
        displayNames: ["Sky Sport F1"],
        icon: undefined,
        url: undefined,
      });
      expect(guide.programmes).toHaveLength(37);
      expect(guide.issues).toEqual([
        {
          _tag: "Issue",
          message: 'programme on eventbeta0 skipped: unreadable start "undefined"',
          line: 46,
        },
      ]);
    }),
  );

  it.effect("parses the Sky Sport F1 qualifying with UTC times", () =>
    Effect.gen(function* () {
      const guide = yield* parseXmltv(fixture);
      const first = guide.programmes.find((programme) => programme.channel === "ch1004");
      expect(first).toEqual({
        _tag: "Programme",
        channel: "ch1004",
        start: utc("2026-11-21T06:30:00Z"),
        stop: utc("2026-11-21T08:00:00Z"),
        title: "F1: Qualifying - GP Las Vegas",
        subTitle: "GP Las Vegas: Qualifying",
        description: "Vom Las Vegas Street Circuit in Las Vegas, Nevada, USA.",
        categories: [],
        episode: undefined,
        icon: undefined,
        date: "2026",
        country: undefined,
        language: undefined,
        isNew: false,
        premiere: false,
        previouslyShown: false,
        live: false,
      } satisfies XmltvProgramme);
    }),
  );

  it.effect("applies +0100 offsets and reads onscreen episode numbers", () =>
    Effect.gen(function* () {
      const guide = yield* parseXmltv(fixture);
      const balko = guide.programmes.find((programme) => programme.title === "Balko");
      expect(balko?.start).toBe(utc("2026-11-21T06:44:00Z"));
      const series = guide.programmes.find((programme) => programme.channel === "ch1001");
      expect(series?.episode).toEqual({ season: 1, episode: 104, onscreen: "S1 E104" });
    }),
  );
});

describe("parseXmltv on messy input", () => {
  it.effect("reads every supported field", () =>
    Effect.gen(function* () {
      const guide = yield* parseXmltv(MESSY, { preferredLanguages: ["de"] });
      expect(guide.channels).toEqual([
        {
          _tag: "Channel",
          id: "one.example",
          displayNames: ["Eins", "One"],
          icon: "https://logos.example/one.png",
          url: "https://one.example",
        },
      ]);
      expect(guide.programmes[0]).toEqual({
        _tag: "Programme",
        channel: "one.example",
        start: utc("2026-11-22T17:30:00Z"),
        stop: utc("2026-11-22T19:00:00Z"),
        title: "Das Rennen",
        subTitle: "Teil 2",
        description: "Ein <b>spannendes</b> Rennen mit viel Regen.",
        categories: ["Sport", "Motorsport"],
        episode: {
          season: 3,
          episode: 10,
          episodeCount: 12,
          part: 1,
          partCount: 2,
          xmltvNs: "2 . 9/12 . 0/2",
          onscreen: "S3 E10",
        },
        icon: "https://images.example/race.jpg",
        date: "20261122",
        country: "AT",
        language: "de",
        isNew: true,
        premiere: true,
        previouslyShown: false,
        live: true,
      } satisfies XmltvProgramme);
    }),
  );

  it.effect("takes the first language without a preference, allows a missing stop", () =>
    Effect.gen(function* () {
      const guide = yield* parseXmltv(MESSY);
      expect(guide.programmes[0]?.title).toBe("The Race");
      expect(guide.programmes[1]).toMatchObject({
        title: "Late Show",
        start: utc("2026-11-22T20:00:00Z"),
        stop: undefined,
        previouslyShown: true,
      });
    }),
  );

  it.effect("reports bad records and bad entities, and keeps going", () =>
    Effect.gen(function* () {
      const guide = yield* parseXmltv(MESSY);
      expect(guide.programmes.map((programme) => programme.title)).toEqual([
        "The Race",
        "Late Show",
        "Fish & Chips © &bogus; done",
      ]);
      expect(guide.issues.map((issue) => issue.message)).toEqual([
        "channel without an id skipped",
        'programme on one.example skipped: unreadable start "undefined"',
        "programme on one.example skipped: stop is not after start",
        "programme without a channel skipped",
        "malformed XML: undefined entity.",
      ]);
    }),
  );

  it.effect("caps the number of issue events", () =>
    Effect.gen(function* () {
      const bad = '<programme start="x" channel="c"><title>t</title></programme>'.repeat(5);
      const guide = yield* parseXmltv(`<tv>${bad}</tv>`, { maxIssues: 2 });
      expect(guide.issues.map((issue) => issue.message)).toEqual([
        'programme on c skipped: unreadable start "x"',
        'programme on c skipped: unreadable start "x"',
        "3 more issues not shown",
      ]);
    }),
  );

  it.effect("fails with XmltvFormatError for an HTML page", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        parseXmltv("<!doctype html><html><body>Login</body></html>"),
      );
      expect(error).toBeInstanceOf(XmltvFormatError);
      expect(error.message).toBe("not an XMLTV document: got a web page");
    }),
  );

  it.effect("fails for a JSON error body", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(parseXmltv('{"error":"unauthorised"}'));
      expect(error.message).toBe('not an XMLTV document: starts with "{"error":"unaut"');
    }),
  );

  it.effect("fails for empty input", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(parseXmltv("   "));
      expect(error.message).toBe("not an XMLTV document: no root element");
    }),
  );
});

describe("parseXmltvStream", () => {
  it.effect(
    "gives the same result however the bytes are split, even inside a UTF-8 character",
    () =>
      Effect.gen(function* () {
        const bytes = new TextEncoder().encode(fixture);
        const whole = yield* parseXmltv(fixture);
        for (const size of [1, 7, 4096]) {
          const chunks: Uint8Array[] = [];
          for (let offset = 0; offset < bytes.length; offset += size) {
            chunks.push(bytes.subarray(offset, offset + size));
          }
          const split = yield* collectXmltv(parseXmltvStream(Stream.fromIterable(chunks)));
          expect(split).toEqual(whole);
        }
      }),
  );

  it.effect("decodes the encoding named in the XML declaration", () =>
    Effect.gen(function* () {
      const xml =
        '<?xml version="1.0" encoding="ISO-8859-1"?><tv><programme start="20260101000000 +0000" channel="c"><title>München Grüße</title></programme></tv>';
      const latin1 = Uint8Array.from(xml, (char) => char.charCodeAt(0));
      const guide = yield* collectXmltv(parseXmltvStream(Stream.make(latin1)));
      expect(guide.programmes[0]?.title).toBe("München Grüße");
    }),
  );

  it("emits programmes before the input has ended", () => {
    const parser = makeXmltvParser();
    expect(
      parser.write('<tv><programme start="20260101000000" channel="c"><title>A</title>'),
    ).toEqual([]);
    const events = parser.write("</programme><programme");
    expect(events).toMatchObject([{ _tag: "Programme", title: "A" }]);
    expect(
      parser.write(' start="20260101010000" channel="c"><title>B</title></programme></tv>'),
    ).toMatchObject([{ _tag: "Programme", title: "B" }]);
    expect(parser.end()).toEqual([]);
  });
});
