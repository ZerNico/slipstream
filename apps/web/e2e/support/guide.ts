/**
 * The timeline guide draws only the cells near its view (rows in view, about a screen of time
 * either side), so a journey that wants one programme's cell scrolls the grid to it first, as a
 * person would.
 */
import { expect, type Locator, type Page } from "@playwright/test";

/**
 * Scrolls the timeline to a programme and returns its cell once drawn. Where it lies comes from
 * the cells already drawn (their start, `data-start`, and their left edge give the pixels per
 * minute); a sweep of the grid is the fallback.
 */
export const revealCell = async (
  page: Page,
  programmeId: string,
  start: string,
): Promise<Locator> => {
  const cell = page.locator(`#guide-grid button[data-programme="${programmeId}"]`);
  const grid = page.locator("#guide-grid");
  const drawn = () =>
    expect(cell)
      .toHaveCount(1, { timeout: 1_000 })
      .then(
        () => true,
        () => false,
      );
  const aimed = await grid.evaluate((element, target) => {
    // Cells by start; the first of a row may be cut at the window's start, so the latest two
    // (on different starts) give the scale.
    const cells = [...element.querySelectorAll<HTMLElement>("button[data-start]")]
      .map((button) => ({ start: Number(button.dataset["start"]), left: button.offsetLeft }))
      .toSorted((a, b) => b.start - a.start);
    const [a] = cells;
    const b = cells.find((candidate) => a !== undefined && candidate.start < a.start - 60_000);
    if (a === undefined || b === undefined) return false;
    const perMinute = (a.left - b.left) / ((a.start - b.start) / 60_000);
    const left = a.left + ((target - a.start) / 60_000) * perMinute;
    element.scrollLeft = left - element.clientWidth / 3;
    return true;
  }, Date.parse(start));
  if (!(aimed && (await drawn()))) {
    await grid.evaluate((element) => {
      element.scrollLeft = 0;
    });
    // A screen at a time: the grid draws about a screen either side of its view.
    while (!(await drawn())) {
      const moved = await grid.evaluate((element) => {
        const before = element.scrollLeft;
        element.scrollLeft = before + element.clientWidth;
        return element.scrollLeft > before;
      });
      if (!moved) throw new Error(`the guide ends without programme ${programmeId}`);
    }
  }
  await cell.scrollIntoViewIfNeeded();
  return cell;
};
