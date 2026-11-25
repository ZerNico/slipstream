/**
 * The hero's words to remember, and the skeleton hero built back from them (SPEC §6.2). The
 * read line and the timeline are hidden while loading (`sk-hide`), so they are not kept.
 */
import { m } from "@slipstream/i18n";
import type { HeroView } from "./hero-view.ts";
import type { HeroKind } from "./model.ts";
import type { HeroText } from "./shape.ts";

/** What a loaded hero said, for the next skeleton. */
export const heroText = (view: HeroView): HeroText => ({
  badges: view.badges,
  eyebrow: view.eyebrow,
  title: view.title,
  description: view.description,
  actions: view.actions.map(({ kind, label, short, icon }) =>
    short === undefined ? { kind, label, icon } : { kind, label, short, icon },
  ),
});

/**
 * Words for a first visit: none. A guessed bar is the wrong width for whichever hero loads
 * (onboarding's one action, a title that steps down), so its box would move. The empty slots
 * keep their fixed heights (the actions row too), and the words only appear in them.
 */
const firstVisit: HeroText = {
  badges: [],
  eyebrow: "",
  title: "",
  description: "",
  actions: [],
};

/**
 * The hero while Home loads: the remembered words (or placeholder bars) in the very slots of
 * every state. Its actions go nowhere; controls take no pointer while the route loads.
 */
export const skeletonHero = (kind: HeroKind, text: HeroText | undefined): HeroView => {
  const words = text ?? firstVisit;
  return {
    kind,
    label: m.state_loading(),
    badges: words.badges,
    eyebrow: words.eyebrow,
    title: words.title,
    description: words.description,
    read: undefined,
    timeline: undefined,
    relative: false,
    actions: words.actions.map((action) => ({ ...action, target: { to: "guide" } })),
    // Onboarding has no picture (its wall fills the hero), and a first visit does not know
    // which picture comes: both keep the glow, whose box is the picture's.
    art: kind === "onboarding" || text === undefined ? undefined : { title: "" },
  };
};
