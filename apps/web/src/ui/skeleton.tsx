import { type ComponentProps, type ElementType, type ReactNode, useEffect, useState } from "react";
import { m } from "@slipstream/i18n";
import { cn } from "~/ui/utils.ts";
import { fontWaitMs, LoadingContext, useIsLoading } from "./skeleton-state.ts";

/**
 * Resolves once the UI fonts are ready or after {@link fontWaitMs}, whichever comes first, so
 * swapping to Inter happens behind the skeleton, not in front of the data.
 */
function useFontsSettled(): boolean {
  const [settled, setSettled] = useState(
    () =>
      typeof document === "undefined" ||
      !("fonts" in document) ||
      document.fonts.status === "loaded",
  );
  useEffect(() => {
    if (settled) return;
    let alive = true;
    const done = () => {
      if (alive) setSettled(true);
    };
    const timer = window.setTimeout(done, fontWaitMs);
    document.fonts.ready.then(done, done);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [settled]);
  return settled;
}

/**
 * The skeleton contract (SPEC §6.2): loading is a state of the real component tree. Wrap a
 * route's content; pass whether *this route's* queries are pending. While loading, `<Sk>` text
 * and `<SkArt>` artwork paint placeholders in the very boxes the data will fill, controls ignore
 * the pointer and the scope is `aria-busy`. After load only the data fades in.
 */
export function LoadingScope({
  loading,
  as,
  className,
  children,
  ...props
}: Omit<ComponentProps<"div">, "children"> & {
  loading: boolean;
  as?: ElementType;
  children: ReactNode;
}) {
  const fontsSettled = useFontsSettled();
  const [wasLoading, setWasLoading] = useState(loading);
  if (loading && !wasLoading) setWasLoading(true);
  const showLoading = loading || !fontsSettled;
  const Element = as ?? "div";
  return (
    <LoadingContext value={showLoading}>
      <Element
        data-loading={showLoading ? "" : undefined}
        data-reveal={!showLoading && wasLoading ? "" : undefined}
        aria-busy={showLoading || undefined}
        className={className}
        {...props}
      >
        {children}
        {/* Last and always present, so the tree keeps its shape between loading and loaded. */}
        <span className="sr-only">{showLoading ? m.state_loading() : ""}</span>
      </Element>
    </LoadingContext>
  );
}

/** Placeholder text of a fixed length when there is no cached shape to copy. */
const filler = (chars: number) => "0".repeat(Math.max(1, chars));

/**
 * One piece of text that comes from data. While loading it renders `placeholder` (the text the
 * cached shape had, or `chars` filler characters) as a transparent bar of exactly that size.
 *
 * The placeholder and the data are separate elements (keyed), so the data arrives as a new node:
 * in a right-aligned or centred box the data's text starts elsewhere than the placeholder's, and
 * the same text node moving would count as a layout shift; a node inserted does not.
 */
export function Sk({
  children,
  placeholder,
  chars = 12,
  className,
  ...props
}: ComponentProps<"span"> & { placeholder?: string; chars?: number }) {
  const loading = useIsLoading();
  const empty = children === undefined || children === null || children === "";
  const placeholding = loading && empty;
  return (
    <span key={placeholding ? "placeholder" : "data"} className={cn("sk", className)} {...props}>
      {placeholding ? (placeholder ?? filler(chars)) : children}
    </span>
  );
}

/** Marks artwork (or any picture box) that comes from data: a placeholder fill while loading. */
export function SkArt({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("sk-art", className)} {...props} />;
}
