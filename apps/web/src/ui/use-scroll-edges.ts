import { type RefObject, useLayoutEffect, useRef, useState } from "react";

/** Data attributes for a `scroller-fade`: which edges have more content behind them. */
export interface ScrollEdges {
  readonly "data-fade-start"?: "";
  readonly "data-fade-end"?: "";
}

/**
 * Watches a horizontal scroller and says which of its edges hide more content, so the
 * `scroller-fade` utility fades exactly those edges (a cut-off chip reads as "more this way",
 * never as a clipped control), and whether it scrolls at all (a row's arrow buttons). Measures
 * again on scroll and on resize.
 */
export function useScrollEdges<T extends HTMLElement>(): {
  readonly ref: RefObject<T | null>;
  readonly edges: ScrollEdges;
  /** Whether the content is wider than the scroller. */
  readonly scrollable: boolean;
  /** Whether more content hides before the start, or after the end. */
  readonly more: { readonly start: boolean; readonly end: boolean };
} {
  const ref = useRef<T | null>(null);
  const [edges, setEdges] = useState({ scrollable: false, start: false, end: false });

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () => {
      const max = element.scrollWidth - element.clientWidth;
      const scrollable = max > 1;
      const start = scrollable && element.scrollLeft > 1;
      const end = scrollable && element.scrollLeft < max - 1;
      setEdges((current) =>
        current.scrollable === scrollable && current.start === start && current.end === end
          ? current
          : { scrollable, start, end },
      );
    };
    measure();
    element.addEventListener("scroll", measure, { passive: true });
    const observer =
      typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(measure);
    observer?.observe(element);
    return () => {
      element.removeEventListener("scroll", measure);
      observer?.disconnect();
    };
  }, []);

  return {
    ref,
    edges: {
      ...(edges.start ? { "data-fade-start": "" as const } : {}),
      ...(edges.end ? { "data-fade-end": "" as const } : {}),
    },
    scrollable: edges.scrollable,
    more: { start: edges.start, end: edges.end },
  };
}
