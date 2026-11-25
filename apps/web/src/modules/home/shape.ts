/**
 * What Home looked like last time on this device: the hero's words, the attention cards, every
 * row's cards, as plain text. The skeleton after a reload renders exactly
 * that as transparent bars (SPEC §6.2: "placeholder text from the cached shape"), so the loaded
 * page lands in the very same boxes. A first visit has no shape: only the hero holds a place
 * while loading, and the sections then appear below it, which moves nothing already there.
 */
import { Schema } from "effect";
import { shapeCache } from "~/api/shape-cache.ts";

const RowKey = Schema.Literals(["continue", "now", "scheduled", "new"]);
/** Which row a Home section is, for its id and the remembered layout. */
export type RowKey = typeof RowKey.Type;

const RowMore = Schema.Literals(["/recordings", "/guide", "/recordings/scheduled"]);

const CardText = Schema.Struct({
  title: Schema.String,
  subtitle: Schema.String,
  isNew: Schema.Boolean,
  /** Which overlays the art carries (badges, the time pill, a progress bar), so a placeholder
   * card has the same parts in the same order. */
  badges: Schema.Boolean,
  when: Schema.Boolean,
  progress: Schema.Boolean,
});
/** One card's words. */
export type CardText = typeof CardText.Type;

const RowText = Schema.Struct({
  key: RowKey,
  title: Schema.String,
  more: Schema.optionalKey(Schema.Struct({ label: Schema.String, to: RowMore })),
  cards: Schema.Array(CardText),
});
/** One row: its head and its cards. */
export type RowText = typeof RowText.Type;

const IssueTarget = Schema.Union([
  Schema.Struct({ to: Schema.Literal("scheduled") }),
  Schema.Struct({ to: Schema.Literal("sources") }),
  Schema.Struct({ to: Schema.Literal("detail"), id: Schema.String }),
  Schema.Struct({ to: Schema.Literal("choice"), id: Schema.String }),
]);
/** Where an attention card's action goes. */
export type IssueTarget = typeof IssueTarget.Type;

const IssueAction = Schema.Struct({ label: Schema.String, target: IssueTarget });
/** One action under an attention card; the first is the fix, the rest are quiet. */
export type IssueAction = typeof IssueAction.Type;

const IssueText = Schema.Struct({
  /** Problems are err or warn; good news (a replaced recording) is ok. */
  tone: Schema.Literals(["err", "warn", "ok"]),
  glyph: Schema.Literals(["server", "failed", "warning", "check"]),
  title: Schema.String,
  text: Schema.String,
  actions: Schema.Array(IssueAction),
});
/** One attention card's words. */
export type IssueText = typeof IssueText.Type;

const HeroIcon = Schema.Literals(["play", "fromStart", "live", "liveDot", "add", "none"]);
/** Which glyph a hero action carries. */
export type HeroIcon = typeof HeroIcon.Type;

const HeroBadge = Schema.Struct({
  tone: Schema.Literals(["live", "rec", "sched", "warn", "ok", "neutral", "glass"]),
  text: Schema.String,
  wide: Schema.optionalKey(Schema.Boolean),
});
/** A badge in the hero's badge row; `wide` ones are left out on phones. */
export type HeroBadge = typeof HeroBadge.Type;

const HeroText = Schema.Struct({
  badges: Schema.Array(HeroBadge),
  eyebrow: Schema.String,
  title: Schema.String,
  description: Schema.String,
  actions: Schema.Array(
    Schema.Struct({
      kind: Schema.Literals(["primary", "glass", "fold", "info"]),
      label: Schema.String,
      short: Schema.optionalKey(Schema.String),
      icon: HeroIcon,
    }),
  ),
});
/** The hero's words. */
export type HeroText = typeof HeroText.Type;

const HeroKind = Schema.Literals([
  "onboarding",
  "recording",
  "soon",
  "continue",
  "new",
  "live",
  "idle",
]);

const HomeShape = Schema.Struct({
  hero: HeroKind,
  heroText: Schema.optionalKey(HeroText),
  /** The recordings the hero showed, so the mini player decides the same way while loading. */
  heroIds: Schema.Array(Schema.String),
  issues: Schema.Array(IssueText),
  rows: Schema.Array(RowText),
});
/** Everything the skeleton needs. */
export type HomeShape = typeof HomeShape.Type;

/** The first visit: the hero and nothing under it. */
const emptyShape: HomeShape = { hero: "idle", heroIds: [], issues: [], rows: [] };

/** The layout kept on this device, in the shared shape cache. */
export const homeShape = shapeCache("home", HomeShape);

/** The shape stored on this device; none, or one not shaped like one (an older version), is a first visit. */
export const readShape = (): HomeShape => homeShape.read() ?? emptyShape;
