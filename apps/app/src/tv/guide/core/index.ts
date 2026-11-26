/** The TV guide's cursor, key-hold, digit entry and window logic: pure, with no React Native. */
export {
  defaultGuideConfig,
  hasData,
  makeGuide,
  type Guide,
  type GuideChannel,
  type GuideConfig,
  type GuideProgramme,
} from "./guide.ts";
export {
  emptySpan,
  focusedCell,
  initialCursor,
  isAtNow,
  relocate,
  step,
  type GuideAction,
  type GuideCursor,
} from "./cursor.ts";
export { idleHold, pressKey, type AccelerationConfig, type KeyHold } from "./hold.ts";
export { digitDeadline, expireDigits, typeDigit, type DigitEntry } from "./digits.ts";
export { guideWindow, type WindowCell, type WindowRow } from "./window.ts";
