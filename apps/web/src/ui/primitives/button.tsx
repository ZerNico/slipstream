import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { cva, type VariantProps } from "class-variance-authority";
import { cloneElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "~/ui/primitives/tooltip.tsx";
import { cn } from "~/ui/utils.ts";

/**
 * Buttons (SPEC §4): primary is the one amber action of a surface; secondary is a hover fill
 * with an outline; glass sits on artwork and video; ghost is quiet; danger and live are red.
 * Sizes follow the control height scale, so every button in a row shares one height.
 */
const buttonVariants = cva("btn", {
  variants: {
    variant: {
      primary: "btn-primary",
      secondary: "btn-secondary",
      glass: "btn-glass",
      ghost: "btn-ghost",
      danger: "btn-danger",
      live: "btn-live",
    },
    size: { sm: "btn-sm", md: "", lg: "btn-lg" },
  },
  defaultVariants: { variant: "secondary", size: "md" },
});

/** A button's look and height. */
type ButtonVariants = VariantProps<typeof buttonVariants>;

/**
 * A labelled button. `busy` swaps the label for a spinner and keeps the width; an icon goes
 * before the label as `icon`. Render a link with `render={<Link to="…" />}` and
 * `nativeButton={false}`: it stays a real link (role link, Enter only), styled as a button.
 */
function Button({
  className,
  variant,
  size,
  busy = false,
  icon,
  children,
  ...props
}: ButtonPrimitive.Props &
  ButtonVariants & {
    /** Shows a spinner in place of the label while an action runs. */
    busy?: boolean;
    /** An `<Icon>` drawn before the label. */
    icon?: ReactNode;
  }) {
  const content = (
    <>
      {icon}
      {children === undefined ? null : <span className="btn-label">{children}</span>}
    </>
  );
  const classes = cn(buttonVariants({ variant, size }), className);
  const link = asLink(props, { "data-slot": "button", className: classes }, content);
  if (link) return link;
  return (
    <ButtonPrimitive
      data-slot="button"
      data-busy={busy ? "" : undefined}
      aria-busy={busy || undefined}
      className={classes}
      {...props}
    >
      {content}
    </ButtonPrimitive>
  );
}

/**
 * A button rendered as a link (`render={<Link />}`, `nativeButton={false}`) is the link itself:
 * Base UI would add `role="button"` to it, which hides a navigation from assistive tech.
 */
const asLink = (
  props: ButtonPrimitive.Props,
  own: Record<string, unknown>,
  children: ReactNode,
): ReactElement | undefined => {
  const { render, nativeButton, ...rest } = props;
  if (nativeButton !== false || !isValidElement(render)) return undefined;
  return cloneElement(render, { ...rest, ...own, children } as Record<string, unknown>);
};

const iconButtonVariants = cva("ibtn", {
  variants: {
    variant: { plain: "", outline: "ibtn-outline", glass: "ibtn-glass", live: "ibtn-live" },
    size: { sm: "ibtn-sm", md: "", lg: "ibtn-lg" },
  },
  defaultVariants: { variant: "plain", size: "md" },
});

/**
 * A round icon-only button. `label` is required: it is the accessible name and, with a hovering
 * pointer, the tooltip (never on touch). `pressed` makes it a toggle.
 */
function IconButton({
  className,
  variant,
  size,
  label,
  tooltip = true,
  tooltipSide = "top",
  pressed,
  children,
  render,
  ...props
}: Omit<ButtonPrimitive.Props, "aria-label"> &
  VariantProps<typeof iconButtonVariants> & {
    /** Accessible name and tooltip text. */
    label: string;
    /** Shows `label` as a tooltip on hover and keyboard focus. */
    tooltip?: boolean;
    tooltipSide?: "top" | "bottom" | "left" | "right";
    /** Toggle state; renders `aria-pressed`. */
    pressed?: boolean;
    render?: ReactElement;
  }) {
  const classes = cn(iconButtonVariants({ variant, size }), className);
  const button = asLink(
    { ...props, ...(render ? { render } : {}) },
    { "data-slot": "icon-button", "aria-label": label, className: classes },
    children,
  ) ?? (
    <ButtonPrimitive
      data-slot="icon-button"
      aria-label={label}
      aria-pressed={pressed}
      className={classes}
      {...(render ? { render } : {})}
      {...props}
    >
      {children}
    </ButtonPrimitive>
  );
  if (!tooltip) return button;
  return (
    <Tooltip>
      <TooltipTrigger render={button} />
      <TooltipContent side={tooltipSide}>{label}</TooltipContent>
    </Tooltip>
  );
}

export { Button, IconButton };
