/**
 * Layout checks every e2e spec reuses (SPEC §6, §9): nothing moves on load or
 * hover, no control takes the pointer while a route loads, no horizontal page scroll, touch
 * targets reach 44 px, every overlay fits the screen.
 *
 * ```ts
 * import { expectNoShiftOnLoad, expectNoShiftOn, expectNoHorizontalOverflow } from "./support/layout.ts";
 * await expectNoShiftOnLoad(page, "/guide");
 * await expectNoShiftOn(page, () => page.hover(".card"), { ignore: [".card-play"] });
 * ```
 */
import { expect, type Page } from "@playwright/test";

/** One element's box, keyed by its position in the tree so the same node is compared. */
export interface BoxSnapshot {
  readonly [path: string]: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  };
}

/** What to compare: elements under `scope`, minus those matching `ignore` (and their children). */
export interface ShiftOptions {
  /** Root of the comparison; `main` by default. */
  readonly scope?: string;
  /** Selectors allowed to move (a hover tooltip, a marker that follows the pointer). */
  readonly ignore?: readonly string[];
  /** Movement up to this many px counts as none (sub-pixel rounding). */
  readonly tolerance?: number;
}

/** The key under which {@link measureBoxes} records the layout viewport. */
const viewportKey = "(viewport)";

/**
 * Records the box of every visible element under `scope`. Elements are keyed by their path of
 * child indexes, so the skeleton and the loaded tree (the same components) line up. The layout
 * viewport is recorded too, by `clientWidth` and `clientHeight` (`innerWidth` counts the
 * scrollbar): a scrollbar that appears between two snapshots narrows it and is reported as the
 * viewport changing, not as every centred box moving.
 */
export const measureBoxes = (page: Page, options: ShiftOptions = {}): Promise<BoxSnapshot> =>
  page.evaluate(
    ({ scope, ignore, viewport }) => {
      const root = document.querySelector(scope);
      const out: Record<string, { x: number; y: number; width: number; height: number }> = {};
      const { clientWidth, clientHeight } = document.documentElement;
      out[viewport] = { x: 0, y: 0, width: clientWidth, height: clientHeight };
      if (!root) return out;
      const walk = (element: Element, path: string) => {
        if (ignore.some((selector) => element.matches(selector))) return;
        const style = getComputedStyle(element);
        if (style.display === "none" || style.visibility === "hidden") return;
        // Fixed layers (overlays, a switch's hidden native input) move with scrolling, not layout.
        if (style.position === "fixed") return;
        const rect = element.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          out[path] = {
            x: Math.round(rect.x * 10) / 10,
            y: Math.round((rect.y + window.scrollY) * 10) / 10,
            width: Math.round(rect.width * 10) / 10,
            height: Math.round(rect.height * 10) / 10,
          };
        }
        [...element.children].forEach((child, index) => walk(child, `${path}/${index}`));
      };
      walk(root, "");
      return out;
    },
    { scope: options.scope ?? "main", ignore: [...(options.ignore ?? [])], viewport: viewportKey },
  );

/** The paths whose boxes differ between two snapshots (present in both), with the change. */
export const movedBetween = (before: BoxSnapshot, after: BoxSnapshot, tolerance = 0.5): string[] =>
  Object.entries(before).flatMap(([path, box]) => {
    const next = after[path];
    if (!next) return [];
    const delta = Math.max(
      Math.abs(next.x - box.x),
      Math.abs(next.y - box.y),
      Math.abs(next.width - box.width),
      Math.abs(next.height - box.height),
    );
    return delta > tolerance ? [`${path || "(scope)"} moved ${delta.toFixed(1)}px`] : [];
  });

/**
 * Resolves once the page has painted twice more and every finite animation and transition has
 * finished, so a measurement sees what settled, not a fixed delay's guess. Layout-shift entries
 * of those frames are queued by then too.
 */
export const afterPaint = async (page: Page): Promise<void> => {
  await page.waitForFunction(() =>
    document
      .getAnimations()
      .every(
        (animation) =>
          animation.playState !== "running" ||
          animation.effect?.getTiming().iterations === Number.POSITIVE_INFINITY,
      ),
  );
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 0)));
      }),
  );
};

declare global {
  interface Window {
    /** API reads in flight, counted by {@link trackRequests}; live events are not counted. */
    ssPendingFetches?: number;
  }
}

const trackedPages = new WeakSet<Page>();

/**
 * Counts the page's API reads in flight (`window.ssPendingFetches`), so {@link querySettled} can
 * wait for the last answer instead of guessing. Installs on every document the page loads from
 * now on; call it before navigating (`signIn` does). Calling it again does nothing.
 */
export const trackRequests = async (page: Page): Promise<void> => {
  if (trackedPages.has(page)) return;
  trackedPages.add(page);
  await page.addInitScript(() => {
    const original = window.fetch.bind(window);
    window.ssPendingFetches = 0;
    window.fetch = async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      // The live-events stream stays open for the page's life: never "in flight" to wait for.
      if (url.includes("/api/events")) return original(input, init);
      window.ssPendingFetches = (window.ssPendingFetches ?? 0) + 1;
      try {
        return await original(input, init);
      } finally {
        window.ssPendingFetches = (window.ssPendingFetches ?? 1) - 1;
      }
    };
  });
};

/** Resolves once every web font the page asked for has loaded (or failed): text has its metrics. */
export const fontsLoaded = async (page: Page): Promise<void> => {
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
};

/**
 * Resolves once no API read is in flight (see {@link trackRequests}) and no loading scope is on
 * screen. Without tracking only the loading scopes are waited for.
 */
export const querySettled = async (page: Page): Promise<void> => {
  await page.waitForFunction(
    () => (window.ssPendingFetches ?? 0) === 0 && document.querySelector("[data-loading]") === null,
    undefined,
    { timeout: 15_000 },
  );
};

/**
 * Resolves once every image on screen has loaded or failed. Lazy images below the fold have not
 * started and cannot move what is measured, so only those meeting the layout viewport count.
 */
export const imagesLoaded = async (page: Page): Promise<void> => {
  await page.waitForFunction(
    () => {
      const { clientWidth, clientHeight } = document.documentElement;
      return [...document.images].every((image) => {
        const box = image.getBoundingClientRect();
        const onScreen =
          box.bottom > 0 && box.right > 0 && box.top < clientHeight && box.left < clientWidth;
        return !onScreen || image.complete;
      });
    },
    undefined,
    { timeout: 15_000 },
  );
};

/**
 * Everything a measurement waits for, in order: the route mounted under `scope`, its reads
 * answered, fonts and on-screen images loaded, animations done and two frames painted. A box
 * measured after this is the box the person sees, whatever the machine's speed.
 */
export const settledForMeasure = async (page: Page, scope = "main"): Promise<void> => {
  await page.waitForSelector(`${scope} > *`, { state: "attached" });
  await querySettled(page);
  await fontsLoaded(page);
  await imagesLoaded(page);
  await afterPaint(page);
};

/** Runs `action` and expects no element under the scope to move (hover, toggles, panels). */
export const expectNoShiftOn = async (
  page: Page,
  action: () => Promise<unknown>,
  options: ShiftOptions = {},
): Promise<void> => {
  // Only the action may move things: the screen has finished loading and settled first.
  await settledForMeasure(page, options.scope);
  const before = await measureBoxes(page, options);
  await action();
  await settledForMeasure(page, options.scope);
  const after = await measureBoxes(page, options);
  expect(movedBetween(before, after, options.tolerance)).toEqual([]);
};

/** Controls that would take a click while the route is still loading. */
export const clickableWhileLoading = (page: Page, scope = "main"): Promise<string[]> =>
  page.evaluate((root) => {
    const busy = document.querySelector(`${root} [aria-busy="true"], ${root}[aria-busy="true"]`);
    if (!busy) return [];
    return [...busy.querySelectorAll<HTMLElement>("a, button, input, select, textarea, [tabindex]")]
      .filter((element) => getComputedStyle(element).pointerEvents !== "none")
      .map((element) => element.outerHTML.slice(0, 80));
  }, scope);

/**
 * The skeleton contract test (SPEC §6.2): records every box on the route's first painted frame
 * and again once the route stops loading; they must be identical, and nothing may take the
 * pointer while `aria-busy`. Slow the API in the page (route interception) to see the skeleton
 * at all.
 */
export const expectNoShiftOnLoad = async (
  page: Page,
  url: string,
  options: ShiftOptions = {},
): Promise<void> => {
  await trackRequests(page);
  await page.goto(url, { waitUntil: "commit" });
  // `[data-loading]` is absent before React mounts too, so first wait for the route itself.
  const scope = options.scope ?? "main";
  await page.waitForSelector(`${scope} > *`, { state: "attached" });
  // The skeleton: the route's loading scope on screen. A route whose data was already there
  // never shows one, and is measured as it first painted.
  await page
    .locator(`${scope} [data-loading], ${scope}[data-loading]`)
    .first()
    .waitFor({ state: "attached", timeout: 3_000 })
    .catch(() => undefined);
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
  const early = await measureBoxes(page, options);
  expect(await clickableWhileLoading(page, options.scope)).toEqual([]);
  await settledForMeasure(page, scope);
  const loaded = await measureBoxes(page, options);
  expect(movedBetween(early, loaded, options.tolerance)).toEqual([]);
};

/** No horizontal page scroll (SPEC §9): compares with `clientWidth`, not `innerWidth`. */
export const expectNoHorizontalOverflow = async (page: Page): Promise<void> => {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
};

/**
 * What a finger can press: links (inline ones in a sheet's facts and sentences too), buttons,
 * tabs, inputs, and the controls Base UI draws as spans (switches, checkboxes, radios).
 */
const targets = [
  "a[href]",
  "button",
  '[role="tab"]',
  '[role="switch"]',
  '[role="checkbox"]',
  '[role="radio"]',
  'input:not([type="hidden"])',
] as const;

/**
 * Interactive elements smaller than `min` px that have no invisible hit area (SPEC §9: 44 px
 * under a coarse pointer). Run in a touch context. The scope is a selector list, so one call
 * can cover a screen and the sheet open over it (`"main, .sheet"`).
 */
export const smallTargets = (page: Page, min = 44, scope = "body"): Promise<string[]> =>
  page.evaluate(
    ({ minimum, roots, selectors }) =>
      [
        ...new Set(
          [...document.querySelectorAll<HTMLElement>(roots)].flatMap((root) => [
            ...root.querySelectorAll<HTMLElement>(selectors),
          ]),
        ),
      ]
        .filter((element) => {
          const rect = element.getBoundingClientRect();
          // Visually hidden helpers (a native input behind a switch, the skip link) are not targets.
          if (rect.width <= 2 || rect.height <= 2) return false;
          if (rect.bottom <= 0 || element.closest("[aria-hidden='true']")) return false;
          if (getComputedStyle(element).visibility === "hidden") return false;
          // An invisible ::before hit area counts, by the insets it actually has.
          const before = getComputedStyle(element, "::before");
          const hits = before.content !== "none" && before.position === "absolute";
          const grow = (a: string, b: string) =>
            hits ? -(Number.parseFloat(a) || 0) - (Number.parseFloat(b) || 0) : 0;
          return (
            Math.min(
              rect.width + grow(before.left, before.right),
              rect.height + grow(before.top, before.bottom),
            ) < minimum
          );
        })
        .map(
          (element) =>
            `${element.tagName.toLowerCase()} ${element.getAttribute("aria-label") ?? element.textContent?.trim().slice(0, 30) ?? ""}`,
        ),
    { minimum: min, roots: scope, selectors: targets.join(", ") },
  );

/** What {@link overlaysSettled} keeps on the page between frames. */
declare global {
  interface Window {
    overlayBoxes?: { readonly key: string; readonly still: number };
  }
}

/** Frames an overlay's box must hold still before it counts as settled. */
const restingFrames = 5;

/**
 * Waits until overlays have finished sliding or fading in: the overlay the URL names exists, no
 * finite animation runs, and every overlay's box has held still for {@link restingFrames} frames.
 * The later checks catch what the first cannot see: an overlay mounts once its code has loaded,
 * a sheet's slide starts a frame after it mounts, so for a moment there is nothing to wait for.
 */
export const overlaysSettled = async (page: Page): Promise<void> => {
  await overlaysNotAnimating(page);
  await page.waitForFunction(
    (frames) => {
      const overlays = [...document.querySelectorAll(".sheet, .dialog, .menu")];
      // An overlay the URL names may mount a moment later (its code loads on first use).
      if (overlays.length === 0 && /[?&](sheet|dlg|choice)=/u.test(location.search)) return false;
      const key = JSON.stringify(
        overlays.map((element) => {
          const box = element.getBoundingClientRect();
          return [box.x, box.y, box.width, box.height];
        }),
      );
      const before = window.overlayBoxes;
      const still = before?.key === key ? before.still + 1 : 0;
      window.overlayBoxes = { key, still };
      return still >= frames;
    },
    restingFrames,
    { polling: "raf" },
  );
};

/** No overlay runs a finite animation (an infinite one, a spinner, never ends). */
const overlaysNotAnimating = (page: Page): Promise<unknown> =>
  page.waitForFunction(() =>
    [...document.querySelectorAll(".sheet, .dialog, .menu")].every(
      (element) =>
        // Base UI sets the starting style a frame before the slide-in transition exists: until
        // it is gone there is no animation to wait for yet.
        !element.matches("[data-starting-style], [data-ending-style]") &&
        element
          .getAnimations({ subtree: true })
          .every(
            (animation) =>
              animation.playState !== "running" ||
              animation.effect?.getTiming().iterations === Number.POSITIVE_INFINITY,
          ),
    ),
  );

/** Every open overlay's bottom edge is on screen (SPEC §9 "Every overlay fits"). */
export const expectOverlaysFit = async (page: Page): Promise<void> => {
  await overlaysSettled(page);
  const overflowing = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>(".sheet, .dialog, .menu")]
      // The layout viewport's height: `innerHeight` counts a horizontal scrollbar as screen.
      .filter(
        (element) =>
          element.getBoundingClientRect().bottom > document.documentElement.clientHeight + 1,
      )
      .map((element) => element.className),
  );
  expect(overflowing).toEqual([]);
};

/** One layout shift the browser reported: how much, and which elements moved. */
export interface ReportedShift {
  readonly value: number;
  readonly sources: readonly string[];
}

declare global {
  interface Window {
    /** Layout shifts recorded by {@link recordLayoutShifts}. */
    ssShifts?: ReportedShift[];
  }
}

/**
 * Records every layout shift the browser's Layout Instability API reports in this page, from the
 * first paint on (the same measure as Core Web Vitals' CLS: elements that were on screen and
 * moved, never content that appears). Call once per page, before navigating.
 */
export const recordLayoutShifts = async (page: Page): Promise<void> => {
  await page.addInitScript(() => {
    const shifts: ReportedShift[] = [];
    window.ssShifts = shifts;
    // Runs in the page, so it carries its own helper.
    // oxlint-disable-next-line unicorn/consistent-function-scoping -- serialised into the page
    const describe = (node: Node | null): string => {
      if (!(node instanceof Element)) return node?.nodeName ?? "?";
      const attributes = [...node.attributes]
        .filter((attribute) => attribute.name === "class" || attribute.name.startsWith("data-"))
        .map((attribute) => `[${attribute.name}="${attribute.value.slice(0, 40)}"]`)
        .join("");
      return `${node.tagName.toLowerCase()}${attributes}`;
    };
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (!("value" in entry) || typeof entry.value !== "number") continue;
        if ("hadRecentInput" in entry && entry.hadRecentInput === true) continue;
        const sources =
          "sources" in entry && Array.isArray(entry.sources)
            ? entry.sources.map((source: { node: Node | null }) => describe(source.node))
            : [];
        shifts.push({ value: entry.value, sources });
      }
    }).observe({ type: "layout-shift", buffered: true });
  });
};

/** The shifts recorded since the page loaded (or since the last `takeLayoutShifts`). */
export const takeLayoutShifts = (page: Page): Promise<ReportedShift[]> =>
  page.evaluate(() => window.ssShifts?.splice(0, window.ssShifts.length) ?? []);
