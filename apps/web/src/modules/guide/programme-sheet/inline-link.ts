/**
 * A link inside a sentence (the series recording's name, "Change defaults"): under a coarse
 * pointer an invisible hit area of at least 44 × 44 px around it, the ctl-sm expansion (SPEC
 * §9), so a short name is still easy to tap. The text itself never moves.
 */
export const inlineLink =
  "relative font-semibold text-fg underline underline-offset-2 coarse:before:absolute coarse:before:top-1/2 coarse:before:left-1/2 coarse:before:h-11 coarse:before:w-[max(100%,44px)] coarse:before:-translate-1/2";
