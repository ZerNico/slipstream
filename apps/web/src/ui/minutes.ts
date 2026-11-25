/*
 * The minutes offered for extra time, shared by every place that sets it.
 */

const earlyMinutes = [0, 1, 2, 3, 5, 10, 15, 20, 30, 45, 60];
const lateMinutes = [0, 1, 2, 3, 5, 10, 15, 20, 30, 45, 60, 90, 120, 180, 240];

/** The usual choices plus the current value when it is not one of them (set elsewhere). */
const withCurrent = (choices: readonly number[], current: number): number[] =>
  choices.includes(current) ? [...choices] : [...choices, current].toSorted((a, b) => a - b);

/** Minutes offered for starting early and for ending late. */
export const earlyChoices = (current: number): number[] => withCurrent(earlyMinutes, current);
export const lateChoices = (current: number): number[] => withCurrent(lateMinutes, current);
