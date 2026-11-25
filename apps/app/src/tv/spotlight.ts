import { useState } from "react";
import { memoryStore, type Store, useStore } from "../data/store.ts";

/**
 * Which card has focus on a TV screen whose backdrop and words follow focus (Home, Recordings,
 * a show's page). Cards write it, and only what shows it (the backdrop, Home's hero) reads it,
 * so moving along a row redraws those and not every row of cards.
 */
export type Spotlight = Store<string | undefined>;

/** The screen's spotlight, the same object for the screen's life. */
export const useSpotlight = (): Spotlight =>
  useState(() => memoryStore<string | undefined>(undefined))[0];

/** The id in the spotlight; re-renders the caller (only) when it changes. */
export const useSpotlit = (spotlight: Spotlight): string | undefined => useStore(spotlight);
