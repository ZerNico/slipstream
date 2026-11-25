/**
 * What the perf scripts share: signing in, the long-task observer, the settle wait, frame
 * statistics and the id of a cloned row.
 */
import type { BrowserContext, Page } from "@playwright/test";

/** What the measuring page keeps on its window and Chrome's heap size. */
declare global {
  interface Window {
    longTasks: number[];
  }
  interface Performance {
    readonly memory?: { readonly usedJSHeapSize: number };
  }
}

/**
 * The id of copy `copy` of a row: the original for copy 0, else the last six hex digits
 * replaced by the copy number, so clones stay valid ids. Also sent into the page as source
 * ({@link cloneIdSource}), where nothing can be imported.
 */
export const cloneId = (id: string, copy: number): string =>
  copy === 0 ? id : `${id.slice(0, -6)}${copy.toString(16).padStart(6, "0")}`;

/** {@link cloneId} as source text, for scripts that run inside the page. */
export const cloneIdSource = cloneId.toString();

/** Signs the page's context in; the session cookie then rides along with every request. */
export const signIn = async (
  page: Page,
  { url, user, password }: { url: string; user: string; password: string },
): Promise<void> => {
  const login = await page.request.post(`${url}/api/auth/login`, {
    data: { username: user, password },
  });
  if (!login.ok()) throw new Error(`login: ${login.status()}`);
};

/** Slows the CPU `rate` times and records every long task in `window.longTasks`. */
export const instrument = async (
  context: BrowserContext,
  page: Page,
  rate: number,
): Promise<void> => {
  const cdp = await context.newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate });
  await page.addInitScript(() => {
    window.longTasks = [];
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) window.longTasks.push(entry.duration);
    }).observe({ type: "longtask", buffered: true });
  });
};

/** Waits until the page has settled after it showed: about a second without a long task. */
export const settle = (page: Page): Promise<void> => page.waitForTimeout(1500);

/** The long tasks so far and the heap, read in the page. */
export const mainThread = (page: Page) =>
  page.evaluate(() => {
    const long = window.longTasks;
    const memory = performance.memory;
    return {
      domNodes: document.querySelectorAll("*").length,
      longTasks: long.length,
      longTaskMs: Math.round(long.reduce((a, b) => a + b, 0)),
      worstTaskMs: Math.round(Math.max(0, ...long)),
      heapMb: memory ? Math.round(memory.usedJSHeapSize / 1e6) : undefined,
    };
  });

/** A frame longer than this missed at least one 60 Hz frame (two frames, with a little slack). */
const jankyMs = 34;

/**
 * Frame statistics from the times between animation frames (the first is dropped: it measures
 * the wait for the first frame): count, p50, p95, the longest and the share of janky frames.
 */
export const frameStats = (times: readonly number[]) => {
  const sorted = times.slice(1).toSorted((a, b) => a - b);
  const p = (q: number) => Math.round(sorted[Math.floor(q * (sorted.length - 1))] ?? 0);
  return {
    frames: sorted.length,
    p50: p(0.5),
    p95: p(0.95),
    max: Math.round(sorted.at(-1) ?? 0),
    janky: Math.round(
      (100 * sorted.filter((d) => d > jankyMs).length) / Math.max(1, sorted.length),
    ),
  };
};
