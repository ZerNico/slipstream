// The vitest plugin does not see it.effect / it.live as test blocks (chat and siva turn it off).
/* oxlint-disable vitest/no-standalone-expect */
import { describe, expect, it } from "@effect/vitest";
import { Effect, Stream } from "effect";
import { parseXmltvStream } from "./xmltv.ts";

const TARGET_BYTES = 50 * 1024 * 1024;
const CHUNK_BYTES = 64 * 1024;
const CHANNELS = 200;

const pad = (value: number) => String(value).padStart(2, "0");
const stamp = (ms: number) => {
  const date = new Date(ms);
  return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}00 +0000`;
};

/**
 * A lazily generated XMLTV document of about `TARGET_BYTES`, produced chunk by chunk so the
 * test itself never holds more than one chunk of it.
 */
function* generateGuide(): Generator<Uint8Array> {
  const encoder = new TextEncoder();
  let produced = 0;
  let index = 0;
  let buffer = '<?xml version="1.0" encoding="UTF-8"?>\n<tv generator-info-name="bench">\n';
  for (let channel = 0; channel < CHANNELS; channel++) {
    buffer += `<channel id="ch${channel}.example"><display-name>Channel ${channel}</display-name></channel>\n`;
  }
  const base = Date.UTC(2026, 10, 21);
  while (produced < TARGET_BYTES) {
    while (buffer.length < CHUNK_BYTES) {
      const channel = index % CHANNELS;
      const slot = Math.floor(index / CHANNELS);
      const start = base + slot * 30 * 60_000;
      buffer +=
        `<programme start="${stamp(start)}" stop="${stamp(start + 30 * 60_000)}" channel="ch${channel}.example">` +
        `<title lang="de">Sendung ${index} &amp; Grüße</title>` +
        `<sub-title lang="de">Folge ${slot}</sub-title>` +
        `<desc lang="de">Eine Beschreibung von Sendung ${index}, die lang genug ist, um wie ein echter Guide-Eintrag auszusehen, mit &quot;Zitaten&quot; und Umlauten.</desc>` +
        `<category lang="de">Sport</category>` +
        `<episode-num system="xmltv_ns">${slot % 10}.${index % 30}.</episode-num>` +
        `</programme>\n`;
      index++;
    }
    const bytes = encoder.encode(buffer);
    produced += bytes.length;
    buffer = "";
    yield bytes;
  }
  yield encoder.encode(`${buffer}</tv>\n`);
}

/** Heap in use after a full collection, so samples measure what is retained, not garbage. */
const retainedHeap = () => {
  globalThis.gc?.();
  return process.memoryUsage().heapUsed;
};

describe("parsing a 50 MB XMLTV guide", () => {
  it.live(
    "streams every programme while heap use stays flat",
    () =>
      Effect.gen(function* () {
        const baseline = retainedHeap();
        let peak = baseline;
        let bytes = 0;
        const chunks = Stream.fromIterable(generateGuide()).pipe(
          Stream.tap((chunk) =>
            Effect.sync(() => {
              bytes += chunk.length;
            }),
          ),
        );
        const started = performance.now();
        const counts = yield* parseXmltvStream(chunks).pipe(
          Stream.runFold(
            () => ({ channels: 0, programmes: 0, issues: 0, lastTitle: "" }),
            (acc, event) => {
              if (event._tag === "Programme") {
                acc.programmes++;
                acc.lastTitle = event.title;
                if (acc.programmes % 5000 === 0) {
                  peak = Math.max(peak, retainedHeap());
                }
              } else if (event._tag === "Channel") acc.channels++;
              else acc.issues++;
              return acc;
            },
          ),
        );
        const seconds = (performance.now() - started) / 1000;
        const growthMb = (peak - baseline) / 1024 / 1024;
        console.log(
          `parsed ${(bytes / 1024 / 1024).toFixed(1)} MB, ${counts.programmes} programmes in ${seconds.toFixed(2)} s, peak heap growth ${growthMb.toFixed(1)} MB`,
        );

        expect(bytes).toBeGreaterThanOrEqual(TARGET_BYTES);
        expect(counts.channels).toBe(CHANNELS);
        expect(counts.issues).toBe(0);
        expect(counts.programmes).toBeGreaterThan(100_000);
        expect(counts.lastTitle).toBe(`Sendung ${counts.programmes - 1} & Grüße`);
        // Streaming retains a few MB at most; keeping the records retains about 150 MB, so this
        // bound catches anything that holds on to the guide without flaking on GC timing.
        expect(growthMb).toBeLessThan(64);
      }),
    120_000,
  );
});
