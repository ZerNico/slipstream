import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import type { ComponentProps } from "react";
import { cn } from "~/ui/utils.ts";

export type { IconSvgElement };

/**
 * Hugeicons draw on a 24 grid, so one stroke width looks heavier the bigger the icon. These keep
 * the line about 1.3 px on screen at every size (SPEC: 20 px default, 16 small, 24 in nav).
 */
const SIZES = {
  14: "size-3.5 [--icon-stroke:2]",
  16: "size-4 [--icon-stroke:1.85]",
  20: "size-5 [--icon-stroke:1.7]",
  24: "size-6 [--icon-stroke:1.55]",
} as const;

/** An icon size in px. */
export type IconSize = keyof typeof SIZES;

/**
 * The one way to draw a glyph. Glyphs come from `ui/icons.ts` by meaning. Icons are decorative:
 * the control around them carries the label.
 */
export function Icon({
  icon,
  size = 20,
  className,
  ...props
}: Omit<ComponentProps<typeof HugeiconsIcon>, "size" | "strokeWidth" | "absoluteStrokeWidth"> & {
  icon: IconSvgElement;
  size?: IconSize;
}) {
  return (
    <HugeiconsIcon
      icon={icon}
      size={size}
      aria-hidden
      className={cn("shrink-0 [&>*]:[stroke-width:var(--icon-stroke)]", SIZES[size], className)}
      {...props}
    />
  );
}
