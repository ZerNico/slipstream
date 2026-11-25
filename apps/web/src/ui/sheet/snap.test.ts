// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { anchorGap, findHalfAnchor, halfSnapHeight, minHalfSaving, snapPointsFor } from "./snap.ts";

/** The live programme sheet on a 390 × 844 phone: art, badges, title, facts, then a timeline. */
const phoneSheet = { sheetHeight: 820, anchorBottom: 420, footerHeight: 73, viewportHeight: 844 };

describe("halfSnapHeight", () => {
  it("shows everything down to the anchor with the footer starting right below it", () => {
    expect(halfSnapHeight(phoneSheet)).toBe(420 + anchorGap + 73);
  });

  it("rounds up, so the footer never cuts the anchor's last pixel row", () => {
    expect(halfSnapHeight({ ...phoneSheet, anchorBottom: 420.2 })).toBe(510);
  });

  it("has no half snap when it would save too little", () => {
    const tight = { ...phoneSheet, sheetHeight: 420 + anchorGap + 73 + minHalfSaving };
    expect(halfSnapHeight(tight)).toBeNull();
    expect(halfSnapHeight({ ...tight, sheetHeight: tight.sheetHeight + 1 })).not.toBeNull();
  });

  it("has no half snap on a short screen (phone landscape opens at full)", () => {
    expect(halfSnapHeight({ ...phoneSheet, viewportHeight: 519 })).toBeNull();
    expect(halfSnapHeight({ ...phoneSheet, viewportHeight: 520 })).not.toBeNull();
  });
});

describe("snapPointsFor", () => {
  it("gives half then full as visible heights in px", () => {
    expect(snapPointsFor(phoneSheet)).toEqual(["509px", "820px"]);
  });

  it("gives nothing for a sheet that only has its full position", () => {
    expect(snapPointsFor({ ...phoneSheet, viewportHeight: 390 })).toBeUndefined();
  });
});

/** A detached tree to look for the half anchor in. */
const build = (html: string) => {
  const root = document.createElement("div");
  root.innerHTML = html;
  return root;
};

describe("findHalfAnchor", () => {
  it("uses the element marked data-half", () => {
    const root = build(`<h2>Title</h2><p data-half id="facts">Facts</p><p>Description</p>`);
    expect(findHalfAnchor(root)?.id).toBe("facts");
  });

  it("extends to a live timeline right after the facts, so its halo never peeks above the footer", () => {
    const root = build(`<p data-half>Facts</p><div id="tl" data-timeline></div><p>More</p>`);
    expect(findHalfAnchor(root)?.id).toBe("tl");
    const wrapped = build(`<p data-half>Facts</p><div id="block"><div data-timeline></div></div>`);
    expect(findHalfAnchor(wrapped)?.id).toBe("block");
  });

  it("finds nothing without a marked anchor", () => {
    expect(findHalfAnchor(build(`<p>Facts</p>`))).toBeNull();
  });
});
