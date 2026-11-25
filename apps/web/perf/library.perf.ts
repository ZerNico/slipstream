/**
 * Measures the recordings library with many recordings: how long it takes to show, how many DOM
 * nodes it keeps, the main thread's long tasks, and the frames while scrolling 9000 px. The
 * page's recordings answer is cloned in the browser (`--recordings`), each copy a show of its
 * own a day further back, so any running instance works (`pnpm dev`).
 *
 *   node perf/library.perf.ts --url http://127.0.0.1:27664 --password … --recordings 2000
 */
import { chromium } from "@playwright/test";
import { parseArgs } from "node:util";
import { cloneId, frameStats, instrument, mainThread, settle, signIn } from "./common.ts";

const { values } = parseArgs({
  options: {
    url: { type: "string", default: "http://127.0.0.1:27664" },
    user: { type: "string", default: "dev" },
    password: { type: "string", default: "" },
    recordings: { type: "string", default: "2000" },
    path: { type: "string", default: "/recordings" },
    cpu: { type: "string", default: "4" },
  },
});
const target = Number(values.recordings);
const day = 86_400_000;

interface RecordingJson {
  readonly id: string;
  readonly programmeId: string;
  readonly title: string;
  readonly start: string;
  readonly end: string;
  readonly state: string;
  readonly [key: string]: unknown;
}

const back = (iso: string, copy: number) => new Date(Date.parse(iso) - copy * day).toISOString();

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
await signIn(page, values);
await page.route(/\/api\/recordings(\?|$)/u, async (route) => {
  const response = await route.fetch();
  const list = (await response.json()) as RecordingJson[];
  const copies = Math.ceil(target / Math.max(1, list.length));
  const out = Array.from({ length: copies }, (_, copy) =>
    list.map((entry) =>
      copy === 0
        ? entry
        : {
            ...entry,
            id: cloneId(entry.id, copy),
            programmeId: `${entry.programmeId}-${copy}`,
            title: `${entry.title} ${copy + 1}`,
            start: back(entry.start, copy),
            end: back(entry.end, copy),
            // Copies are finished: only the real ones run or wait.
            state:
              entry.state === "recording" || entry.state === "scheduled"
                ? "completed"
                : entry.state,
          },
    ),
  )
    .flat()
    .slice(0, target);
  await route.fulfill({ response, json: out });
});
await instrument(context, page, Number(values.cpu));

const started = Date.now();
await page.goto(`${values.url}${values.path}`);
await page.locator('main a[href*="/recordings/"]').first().waitFor({ timeout: 120_000 });
const shown = Date.now() - started;
await settle(page);
const load = {
  ...(await mainThread(page)),
  links: await page.evaluate(() => document.querySelectorAll("main a").length),
};
// Scrolls the page's scroller (the tallest one) to its end over three seconds.
const scrolled = await page.evaluate(async () => {
  const candidates = [document.scrollingElement, ...document.querySelectorAll("*")].filter(
    (element): element is Element =>
      element !== null &&
      element.scrollHeight > element.clientHeight + 10 &&
      (element === document.scrollingElement ||
        ["auto", "scroll"].includes(getComputedStyle(element).overflowY)),
  );
  const scroller = candidates.toSorted((a, b) => b.scrollHeight - a.scrollHeight)[0];
  if (!scroller) return { height: 0, times: [] };
  // A fast but human pace: 9000 px in three seconds, or to the end if it is nearer.
  const distance = Math.min(9000, scroller.scrollHeight - scroller.clientHeight);
  const times: number[] = [];
  let last = performance.now();
  const start = last;
  await new Promise<void>((resolve) => {
    const tick = (now: number) => {
      times.push(now - last);
      last = now;
      const t = Math.min(1, (now - start) / 3000);
      scroller.scrollTop = t * distance;
      if (t < 1) requestAnimationFrame(tick);
      else resolve();
    };
    requestAnimationFrame(tick);
  });
  return { height: scroller.scrollHeight, times };
});
const scroll = { height: scrolled.height, ...frameStats(scrolled.times) };
await browser.close();
console.log(JSON.stringify({ recordings: target, shownMs: shown, ...load, scroll }));
