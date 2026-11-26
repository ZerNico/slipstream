/**
 * Slipstream's shared message catalogue for the web and the app. Every word a person reads
 * comes from here, English included.
 *
 * ```ts
 * import { m, setLocale, matchLocale } from "@slipstream/i18n"
 * setLocale(matchLocale(navigator.languages))
 * m.recordings_count({ count: 3 }) // "3 recordings" or "3 Aufnahmen"
 * ```
 */
export { messageKeys } from "./catalogue.ts";
export type { Catalogue, Message, MessageKey, MessageParams, Messages } from "./catalogue.ts";
export { createFormatters } from "./format.ts";
export type { FormatOptions, Formatters, PluralForms } from "./format.ts";
export {
  baseLocale,
  detectRegion,
  detectRegionParts,
  formatTag,
  isLocale,
  locales,
  matchLocale,
  matchLocaleParts,
  regionOf,
} from "./locales.ts";
export type { Locale } from "./locales.ts";
export { languageName } from "./language-text.ts";
export { pathLabels } from "./path-labels.ts";
export { conflictText, resolveIntro } from "./conflict-text.ts";
export type { ConflictRoomWords, ConflictWords, ResolveIntroWords } from "./conflict-text.ts";
export {
  conflictTitle,
  dayPill,
  recordingFacts,
  rerunText,
  sentenceDay,
  whenLabel,
} from "./recording-text.ts";
export type { RecordingFactsSubject, RerunSubject } from "./recording-text.ts";
export {
  guestAccessLine,
  inviteExpiryLabel,
  inviteLine,
  profileLine,
  toneLabel,
} from "./household-text.ts";
export type { AccessWords, AvatarToneWord, InviteExpiryWord } from "./household-text.ts";
export { keepBufferLabel, keepRunningLabel } from "./live-keep-text.ts";
export { pictureConversionsLabel } from "./picture-conversions-text.ts";
export { deliveryText } from "./delivery-text.ts";
export { deviceQualityLabel, householdDefaultHintText, qualityLabel } from "./quality-text.ts";
export { sourceFailureReasonText, sourceKindText, sourceProblemTexts } from "./source-text.ts";
export type { SourceFailure, SourceKind } from "./source-text.ts";
export {
  seriesCardLine,
  seriesConditionKindLabel,
  seriesKeepKindLabel,
  seriesSkipMark,
  seriesTemplateText,
} from "./series-text.ts";
export type { SeriesSkipMark } from "./series-text.ts";
export { streamLimitText, transcodeReasonText } from "./status-text.ts";
export { watchOptionText } from "./watch-choice-text.ts";
export type { WatchOptionText } from "./watch-choice-text.ts";
export type { StreamLimitReason, TranscodeReasonCode } from "./status-text.ts";
export type { PathWords } from "./path-labels.ts";
export {
  catalogues,
  formatLocale,
  formatters,
  getLocale,
  getRegion,
  getTimeZone,
  m,
  messagesFor,
  setLocale,
  setRegion,
  setTimeZone,
  subscribe,
} from "./runtime.ts";
