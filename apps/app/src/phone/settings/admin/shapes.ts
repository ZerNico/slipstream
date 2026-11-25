import { type GroupShape, METER_EM, ROW_EM, ROW_TWO_LINES_EM } from "./metrics.ts";

/*
 * The loaded shape of each server settings page, for its skeleton: the same groups and rows the
 * page draws once its data is in.
 */

/**
 * Settings › Recording: extra time, Add exception under its heading, then Pictures. Most
 * households have no exceptions; the skeleton shows only while the settings first load, so
 * any there are arrive below it.
 */
export const recordingShape: readonly GroupShape[] = [
  { heading: true, rows: [ROW_EM, ROW_EM] },
  { heading: true, rows: [ROW_EM] },
  { heading: true, rows: [ROW_TWO_LINES_EM, ROW_EM] },
];

/** Settings › Default quality: hardware acceleration, then the three quality defaults. */
export const playbackShape: readonly GroupShape[] = [
  { heading: false, rows: [ROW_TWO_LINES_EM] },
  { heading: true, rows: [ROW_EM, ROW_EM, ROW_EM] },
];

/** Settings › Storage: the meter, then the space kept free and where recordings live. */
export const storageShape: readonly GroupShape[] = [
  { heading: false, rows: [METER_EM, ROW_EM, ROW_TWO_LINES_EM] },
];
