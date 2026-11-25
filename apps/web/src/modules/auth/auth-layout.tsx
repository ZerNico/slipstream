import { type ReactNode, useEffect, useRef } from "react";
import { m } from "@slipstream/i18n";
import { Lockup } from "~/shell/logo.tsx";
import { Artwork } from "~/ui/artwork/artwork.tsx";
import type { ArtworkSubject } from "~/ui/artwork/generate.ts";
import { media, matchesMedia } from "~/ui/use-media-query.ts";
import { wallColumns } from "./wall.ts";

/** One column of the wall, drifting slowly (still under reduced motion). */
function WallColumn({
  subjects,
  reverse,
}: {
  subjects: readonly ArtworkSubject[];
  reverse: boolean;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const element = ref.current;
    // The wall shows from 1100 px only; below it nothing should animate out of sight.
    if (element === null || !matchesMedia(media.desktop) || matchesMedia(media.reducedMotion)) {
      return;
    }
    const animation = element.animate(
      [{ transform: "translateY(0)" }, { transform: "translateY(-50%)" }],
      { duration: 60_000, iterations: Infinity, direction: reverse ? "reverse" : "normal" },
    );
    return () => animation.cancel();
  }, [reverse]);
  return (
    <div
      ref={ref}
      className={reverse ? "-mt-30 grid content-start gap-4" : "grid content-start gap-4"}
    >
      {[
        ...subjects.map((subject) => ({ subject, copy: "a" })),
        ...subjects.map((subject) => ({ subject, copy: "b" })),
      ].map(({ subject, copy }) => (
        <Artwork
          key={`${subject.title}-${copy}`}
          subject={subject}
          noTitle
          noMark
          className="rounded-[14px]"
        />
      ))}
    </div>
  );
}

/**
 * The drifting artwork wall beside the auth forms on desktop (SPEC §8.8): generated artwork in
 * three tilted columns under a dark scrim, with the promise in large type.
 */
function AuthWall() {
  return (
    <div
      className="relative hidden overflow-hidden bg-bg lg:block"
      data-surface="cine"
      aria-hidden="true"
    >
      <div className="absolute -inset-x-[5%] -inset-y-[10%] grid rotate-[-8deg] grid-cols-3 gap-4">
        {wallColumns.map((column, index) => (
          <WallColumn key={column[0]?.title ?? index} subjects={column} reverse={index === 1} />
        ))}
      </div>
      <div className="absolute inset-0 bg-[linear-gradient(90deg,color-mix(in_oklab,var(--bg)_20%,transparent),color-mix(in_oklab,var(--bg)_85%,transparent)),linear-gradient(0deg,color-mix(in_oklab,var(--bg)_90%,transparent),transparent_50%)]" />
      <div className="absolute right-12 bottom-12 left-12 z-[2] text-fg">
        <h2 className="max-w-[12ch] font-display text-[44px] leading-none font-[750] tracking-[-0.04em]">
          {m.auth_claim_title()}
        </h2>
      </div>
    </div>
  );
}

/**
 * The frame of every auth screen (setup, sign-in, TV approval, invite): the artwork wall on
 * desktop, and a centred 420 px column with the lockup on every size.
 */
export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="grid min-h-dvh bg-bg lg:grid-cols-[minmax(0,1.1fr)_minmax(480px,0.9fr)]">
      <AuthWall />
      <main
        id="main"
        className="grid content-center justify-items-center px-[max(var(--gutter),var(--safe-l))] pt-[max(32px,var(--safe-t))] pb-[max(32px,var(--safe-b))]"
      >
        <div className="grid w-full max-w-[420px] gap-5">
          <Lockup className="h-7.5" />
          {children}
        </div>
      </main>
    </div>
  );
}

/** The heading block of an auth screen: an `h1` and the line under it. */
export function AuthHeading({
  title,
  text,
  eyebrow,
}: {
  title: string;
  /** The line under the title; a node when it comes from data (an `Sk` while loading). */
  text?: ReactNode;
  eyebrow?: string;
}) {
  return (
    <div>
      {eyebrow === undefined ? null : <span className="type-eyebrow">{eyebrow}</span>}
      {/* Titles can carry a name (a TV's, a profile's): a long one wraps, never overflows. */}
      <h1
        className={
          eyebrow === undefined
            ? "type-h1 [overflow-wrap:anywhere]"
            : "type-h1 mt-1.5 [overflow-wrap:anywhere]"
        }
      >
        {title}
      </h1>
      {text === undefined ? null : <p className="mt-1.5 text-fg-2">{text}</p>}
    </div>
  );
}
