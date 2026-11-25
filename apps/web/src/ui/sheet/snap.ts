/**
 * Snap points of a bottom sheet (SPEC §8.3, decisions r2 #4, r3 #15). The half snap is sized to
 * the content: it shows everything down to the half anchor (artwork, badges, title, facts, or the
 * live timeline that follows the facts) with the pinned footer starting right below it, so the
 * footer never cuts a line. No half snap on short screens or when it would save too little.
 */

/** Space between the half anchor and the footer, px. */
export const anchorGap = 16;

/** A half snap that saves less than this many px is left out, px. */
export const minHalfSaving = 96;

/** Below this viewport height there is no half snap (short landscape opens at full), px. */
export const minViewportForHalf = 520;

/** What the snap computation needs, measured with the sheet at full height. */
export interface SnapMeasure {
  /** Height of the whole sheet at full snap. */
  readonly sheetHeight: number;
  /** Bottom edge of the half anchor, measured from the sheet's top edge. */
  readonly anchorBottom: number;
  /** Height of the pinned footer (0 without one). */
  readonly footerHeight: number;
  /** The viewport's height. */
  readonly viewportHeight: number;
}

/**
 * The visible height at the half snap, or null when the sheet has no half snap: the viewport is
 * short, or the half would hide less than {@link minHalfSaving}.
 */
export const halfSnapHeight = (m: SnapMeasure): number | null => {
  if (m.viewportHeight < minViewportForHalf) return null;
  const visible = Math.ceil(m.anchorBottom + anchorGap + m.footerHeight);
  return m.sheetHeight - visible > minHalfSaving ? visible : null;
};

/**
 * Snap points for Base UI's Drawer, as visible heights in px: half then full, or undefined when
 * the sheet only has its full position.
 */
export const snapPointsFor = (m: SnapMeasure): readonly string[] | undefined => {
  const half = halfSnapHeight(m);
  return half === null ? undefined : [`${half}px`, `${Math.ceil(m.sheetHeight)}px`];
};

/**
 * The element whose bottom edge decides the half snap: the one marked `data-half`, or the block
 * right after it when that block holds a timeline (its live-edge halo must not peek above the
 * footer, decision r3 #15).
 */
export const findHalfAnchor = (root: ParentNode): Element | null => {
  const marked = root.querySelector("[data-half]");
  if (!marked) return null;
  const next = marked.nextElementSibling;
  return next?.matches("[data-timeline], :has([data-timeline])") ? next : marked;
};
