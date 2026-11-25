/**
 * Parses an XMLTV guide from a file or URL and prints what parsing and clean-up found.
 *
 *   node packages/sources/scripts/inspect-guide.ts ./epg.xml
 *   node packages/sources/scripts/inspect-guide.ts http://tvproxy.local:64321/epg.xml
 */
import { createReadStream } from "node:fs";
import { Effect, Layer, Stream } from "effect";
import { FetchHttpClient } from "effect/http";
import { M3uXmltvSource } from "../src/adapter.ts";
import { cleanGuide } from "../src/cleanup.ts";
import { collectXmltv, parseXmltvStream, XmltvFormatError } from "../src/xmltv.ts";

const target = process.argv[2];
if (target === undefined) {
  console.error("usage: inspect-guide.ts <file or http(s) URL>");
  process.exit(2);
}

const fromFile = (path: string) =>
  Effect.gen(function* () {
    const bytes = Stream.fromAsyncIterable(
      createReadStream(path) as AsyncIterable<Uint8Array>,
      (error) => new XmltvFormatError({ message: String(error) }),
    );
    const parsed = yield* collectXmltv(parseXmltvStream(bytes));
    const cleaned = cleanGuide(parsed);
    return { ...cleaned, issues: parsed.issues, raw: parsed.programmes.length };
  });

const fromUrl = (url: string) =>
  Effect.gen(function* () {
    const source = yield* M3uXmltvSource;
    const guide = yield* source.fetchGuide({ playlistUrl: url, guideUrl: url });
    return { ...guide, report: guide.cleanup, raw: undefined };
  }).pipe(Effect.provide(M3uXmltvSource.layer.pipe(Layer.provide(FetchHttpClient.layer))));

const program = Effect.gen(function* () {
  const started = performance.now();
  const result = yield* /^https?:\/\//i.test(target) ? fromUrl(target) : fromFile(target);
  const seconds = ((performance.now() - started) / 1000).toFixed(2);
  console.log(`parsed in ${seconds} s`);
  console.log(`channels: ${result.channels.length}`);
  console.log(
    `programmes: ${result.programmes.length}${result.raw === undefined ? "" : ` (raw ${result.raw})`}`,
  );
  console.log(`clean-up: ${JSON.stringify(result.report)}`);
  console.log(`issues: ${result.issues.length}`);
  for (const issue of result.issues.slice(0, 10))
    console.log(`  line ${issue.line ?? "?"}: ${issue.message}`);
});

Effect.runPromise(program).catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
