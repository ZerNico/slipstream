import type { Theme as TokenTheme } from "@slipstream/design-tokens/native";
import { createContext, use, useMemo } from "react";
import { Platform, useColorScheme, useWindowDimensions } from "react-native";
import { useReducedMotion } from "react-native-reanimated";
import {
  emFor,
  fonts,
  motionFor,
  paletteOf,
  radii,
  themeNameFor,
  tokenTheme,
  type Motion,
  type Palette,
} from "./palette.ts";

/** Everything a component needs to style itself. */
export interface Theme {
  /** Flat colours named after the design doc's custom properties. */
  readonly colors: Palette;
  /** The full token theme, for component colours (guide cells, chips, buttons). */
  readonly tokens: TokenTheme;
  readonly fonts: typeof fonts;
  readonly radii: typeof radii;
  readonly motion: Motion;
  readonly isTV: boolean;
  /** One design unit in dp ({@link emFor}). */
  readonly em: number;
}

/**
 * A scheme a screen insists on, whatever the system says: the player is dark on every device,
 * as on the web, so its chrome and shade read over any picture.
 */
export const SchemeOverride = createContext<"dark" | undefined>(undefined);

/** The theme for this device: TV is always dark, phone follows the system setting. */
export const useTheme = (): Theme => {
  const system = useColorScheme();
  const scheme = use(SchemeOverride) ?? system;
  const { width, height } = useWindowDimensions();
  const reduced = useReducedMotion();
  const isTV = Platform.isTV;
  const name = themeNameFor(isTV, scheme);
  return useMemo(() => {
    const tokens = tokenTheme(name);
    return {
      colors: paletteOf(tokens),
      tokens,
      fonts,
      radii,
      motion: motionFor(reduced),
      isTV,
      em: emFor(isTV, width, height),
    };
  }, [name, reduced, isTV, width, height]);
};
