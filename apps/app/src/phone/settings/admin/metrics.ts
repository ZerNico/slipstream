/*
 * Measures of the grouped settings lists, in em, shared by the rows and their skeletons so what
 * arrives lands where its bone was.
 */

/** A row with one line (a title and a control at the end). */
export const ROW_EM = 3.4;

/** A row with a title and a line under it. */
export const ROW_TWO_LINES_EM = 4.4;

/** A group's heading above its panel. */
export const HEADING_EM = 2.6;

/** The storage meter's panel. */
export const METER_EM = 6.2;

/** One group of a settings skeleton: a heading or not, then its rows' heights in em. */
export interface GroupShape {
  readonly heading: boolean;
  readonly rows: readonly number[];
}
