/**
 * The catalogue, one file per feature area. Each area keeps its English, German and parameter
 * samples side by side (see `area.ts`), so a screen adds a message in one file and work on
 * other areas never touches it. This index only joins the areas; add messages in the area file.
 * Every client (web, phone, TV) may use every key.
 *
 * | Area       | File          | What                                                         |
 * | ---------- | ------------- | ------------------------------------------------------------ |
 * | shell      | `shell.ts`    | navigation, shared actions, status chips, search, states     |
 * | home       | `home.ts`     | Home                                                         |
 * | guide      | `guide.ts`    | guide, programme sheet, record options                       |
 * | watch      | `watch.ts`    | player, timeline, watch choice, mini player                  |
 * | record now | `record-now.ts` | Record in the player: the programme being watched          |
 * | library    | `library.ts`  | recordings, scheduled, problems, collections, detail         |
 * | series     | `series.ts`   | series recordings list and editor, phone hand-off            |
 * | settings   | `settings.ts` | settings sections, sources, channels, users and invites      |
 * | lineup     | `lineup.ts`   | the channel lineup: filters, numbers, streams, guide mapping |
 * | auth       | `auth.ts`     | setup, sign-in, profiles, TV approval                        |
 * | picker     | `stream-picker.ts` | choosing a big playlist's streams, adding new ones      |
 * | review     | `review.ts`   | needs review: merge, new and gone streams, adding a stream  |
 * | reasons    | `reasons.ts`  | reasons the server reports as keys, never prose              |
 *
 * English is the source. Style (docs/design/design-language.html): plain words, no jargon or
 * codes in headlines, no apologies. Say what happened, why, what Slipstream did, then the
 * action. Future problems use the future tense; red is only for things that already failed.
 *
 * German addresses the reader as "du", like most German TV apps, and follows the glossary in
 * `glossary.ts`.
 */
import type { Translation } from "../src/translation.ts";
import { auth } from "./auth.ts";
import { guide } from "./guide.ts";
import { home } from "./home.ts";
import { library } from "./library.ts";
import { lineup } from "./lineup.ts";
import { reasons } from "./reasons.ts";
import { recordNow } from "./record-now.ts";
import { review } from "./review.ts";
import { series } from "./series.ts";
import { settings } from "./settings.ts";
import { shell } from "./shell.ts";
import { streamPicker } from "./stream-picker.ts";
import { watch } from "./watch.ts";

/** Every area, in the order their keys join the catalogue. */
export const areas = {
  shell,
  home,
  guide,
  watch,
  recordNow,
  library,
  series,
  settings,
  lineup,
  auth,
  reasons,
  streamPicker,
  review,
};

/** English, the source catalogue. */
export const en = {
  ...shell.en,
  ...home.en,
  ...guide.en,
  ...watch.en,
  ...recordNow.en,
  ...library.en,
  ...series.en,
  ...settings.en,
  ...lineup.en,
  ...auth.en,
  ...reasons.en,
  ...streamPicker.en,
  ...review.en,
};

/** German. A missing key, an extra key or a changed parameter is a type error. */
export const de: Translation<typeof en> = {
  ...shell.de,
  ...home.de,
  ...guide.de,
  ...watch.de,
  ...recordNow.de,
  ...library.de,
  ...series.de,
  ...settings.de,
  ...lineup.de,
  ...auth.de,
  ...reasons.de,
  ...streamPicker.de,
  ...review.de,
};

/** Parameter samples for every message that takes parameters. */
export const samples = {
  ...shell.samples,
  ...home.samples,
  ...guide.samples,
  ...watch.samples,
  ...recordNow.samples,
  ...library.samples,
  ...series.samples,
  ...settings.samples,
  ...lineup.samples,
  ...auth.samples,
  ...reasons.samples,
  ...streamPicker.samples,
  ...review.samples,
};

/** Keys whose German text matches the English on purpose. */
export const sameInGerman: readonly string[] = Object.values(areas).flatMap(
  (area): readonly string[] => area.sameInGerman,
);
