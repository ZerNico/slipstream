/**
 * Measures the web guide with many channels: how long the grid takes to show, how many DOM
 * nodes it keeps, the main thread's long tasks, and the frames while scrolling sideways, down
 * and jumping days. The server stays as it is: the page's channel and guide answers are cloned
 * in the page (`--channels`), so any running instance works (`pnpm dev`).
 *
 *   node perf/guide.perf.ts --url http://127.0.0.1:27664 --user dev --password … --channels 300
 *
 * `--cpu 4` slows the CPU fourfold (Chrome's throttling), roughly a mid-range laptop on battery.
 */
import { chromium, type Page } from "@playwright/test";
import { parseArgs } from "node:util";
import { cloneIdSource, frameStats, instrument, mainThread, settle, signIn } from "./common.ts";

const { values } = parseArgs({
  options: {
    url: { type: "string", default: "http://127.0.0.1:27664" },
    user: { type: "string", default: "dev" },
    password: { type: "string", default: "" },
    channels: { type: "string", default: "300" },
    cpu: { type: "string", default: "4" },
    runs: { type: "string", default: "2" },
  },
});
const target = Number(values.channels);

/**
 * Clones the channels and their programmes in the page until there are `target` channels: the
 * page's `fetch` answers with the larger lists, so the app parses one big response as it would
 * from a server with that many channels (and nothing large crosses Playwright's channel).
 */
const multiply = async (page: Page, base: number) => {
  await page.addInitScript(
    ({ target: wanted, copies, cloneIdText }) => {
      // Playwright sends only this function to the page, so cloneId comes along as source.
      // oxlint-disable-next-line typescript/no-implied-eval
      const cloneId = new Function(`return ${cloneIdText}`)() as (
        id: string,
        copy: number,
      ) => string;
      type Row = Record<string, unknown> & { id: string };
      const original = window.fetch.bind(window);
      window.fetch = async (input, init) => {
        const url = new URL(input instanceof Request ? input.url : String(input), location.href);
        const channels = url.pathname === "/api/channels";
        if (!channels && url.pathname !== "/api/guide") return original(input, init);
        const response = await original(input, init);
        const list = (await response.json()) as Row[];
        const out = Array.from({ length: copies }, (_, copy) =>
          list.map((row, index) =>
            channels
              ? {
                  ...row,
                  id: cloneId(row.id, copy),
                  name: copy === 0 ? row["name"] : `${String(row["name"])} ${copy + 1}`,
                  number: copy * list.length + index + 1,
                }
              : {
                  ...row,
                  id: copy === 0 ? row.id : `${row.id}-${copy}`,
                  channelId: cloneId(String(row["channelId"]), copy),
                },
          ),
        ).flat();
        return new Response(JSON.stringify(channels ? out.slice(0, wanted) : out), {
          status: response.status,
          headers: response.headers,
        });
      };
    },
    { target, copies: Math.ceil(target / base), cloneIdText: cloneIdSource },
  );
};

/** The frames over `ms` while `drive` runs in the page ({@link frameStats}). */
const frames = async (page: Page, drive: string, ms: number) =>
  frameStats(
    await page.evaluate(
      async ({ script, duration }) => {
        const grid = document.querySelector<HTMLElement>("#guide-grid");
        if (!grid) throw new Error("no grid");
        const times: number[] = [];
        let last = performance.now();
        const start = last;
        await new Promise<void>((resolve) => {
          const tick = (now: number) => {
            times.push(now - last);
            last = now;
            const t = (now - start) / duration;
            // oxlint-disable-next-line typescript/no-implied-eval
            new Function("grid", "t", script)(grid, Math.min(1, t));
            if (t < 1) requestAnimationFrame(tick);
            else resolve();
          };
          requestAnimationFrame(tick);
        });
        return times;
      },
      { script: drive, duration: ms },
    ),
  );

const run = async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await signIn(page, values);
  const base = (
    (await (await page.request.get(`${values.url}/api/channels?includeHidden=true`)).json()) as []
  ).length;
  await multiply(page, base);
  await instrument(context, page, Number(values.cpu));

  const started = Date.now();
  await page.goto(`${values.url}/guide`);
  await page.locator("#guide-grid [data-programme]").first().waitFor({ timeout: 120_000 });
  const shown = Date.now() - started;
  await settle(page);
  const load = {
    ...(await mainThread(page)),
    ...(await page.evaluate(() => ({
      cells: document.querySelectorAll("#guide-grid [data-programme]").length,
      rows: document.querySelectorAll("#guide-grid [data-row]").length,
    }))),
  };

  const across = await frames(
    page,
    "if (t === 0) grid.dataset.x0 = grid.scrollLeft; grid.scrollLeft = Number(grid.dataset.x0) + t * 6000;",
    3000,
  );
  const down = await frames(
    page,
    "grid.scrollTop = t * Math.min(grid.scrollHeight - grid.clientHeight, 8000);",
    3000,
  );
  // Far jumps: a day ahead and back, four times, as the day switcher's arrows do.
  const jumps = await page.evaluate(async () => {
    const grid = document.querySelector<HTMLElement>("#guide-grid");
    if (!grid) throw new Error("no grid");
    const day = grid.scrollWidth / 8;
    const out: number[] = [];
    for (let index = 0; index < 4; index++) {
      const before = performance.now();
      grid.scrollLeft += index % 2 === 0 ? day : -day;
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      out.push(Math.round(performance.now() - before));
    }
    return out;
  });
  await browser.close();
  return { shownMs: shown, ...load, across, down, jumpMs: jumps };
};

const results = [];
for (let index = 0; index < Number(values.runs); index++) results.push(await run());
console.log(JSON.stringify({ channels: target, cpu: Number(values.cpu), results }, null, 2));
