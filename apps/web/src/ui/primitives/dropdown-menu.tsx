import { Menu as MenuPrimitive } from "@base-ui/react/menu";
import type { ReactNode } from "react";
import { Icon } from "~/ui/icon.tsx";
import { CheckIcon } from "~/ui/icons.ts";
import { cn } from "~/ui/utils.ts";

/**
 * The desktop menu (SPEC §4 Menu): Base UI semantics, arrow keys, Tab and Esc close it, Esc
 * returns focus to the trigger; capped at the space available and scrolling, never covering its
 * trigger. Under 768 px on touch the same items render in a Sheet (see `ui/menu.tsx`).
 */
function DropdownMenu({ ...props }: MenuPrimitive.Root.Props) {
  return <MenuPrimitive.Root data-slot="dropdown-menu" {...props} />;
}

function DropdownMenuTrigger({ ...props }: MenuPrimitive.Trigger.Props) {
  return <MenuPrimitive.Trigger data-slot="dropdown-menu-trigger" {...props} />;
}

function DropdownMenuContent({
  align = "end",
  side = "bottom",
  sideOffset = 8,
  className,
  ...props
}: MenuPrimitive.Popup.Props &
  Pick<MenuPrimitive.Positioner.Props, "align" | "side" | "sideOffset">) {
  return (
    <MenuPrimitive.Portal>
      <MenuPrimitive.Positioner
        className="z-(--z-menu) outline-none"
        align={align}
        side={side}
        sideOffset={sideOffset}
        collisionPadding={8}
      >
        <MenuPrimitive.Popup
          data-slot="dropdown-menu-content"
          className={cn("menu", className)}
          {...props}
        />
      </MenuPrimitive.Positioner>
    </MenuPrimitive.Portal>
  );
}

/** A menu row: a 20 px icon column, the label, and optional trailing text (a key hint, a value). */
function DropdownMenuItem({
  className,
  icon,
  end,
  children,
  ...props
}: MenuPrimitive.Item.Props & { icon?: ReactNode; end?: ReactNode }) {
  return (
    <MenuPrimitive.Item
      data-slot="dropdown-menu-item"
      className={cn("menu-item", className)}
      {...props}
    >
      {icon === undefined ? null : <span className="menu-item-icon">{icon}</span>}
      {children}
      {end === undefined ? null : <span className="menu-item-end">{end}</span>}
    </MenuPrimitive.Item>
  );
}

function DropdownMenuRadioGroup({ ...props }: MenuPrimitive.RadioGroup.Props) {
  return <MenuPrimitive.RadioGroup data-slot="dropdown-menu-radio-group" {...props} />;
}

/** A radio row; the checked one shows an amber tick and gets focus when the menu opens. */
function DropdownMenuRadioItem({
  className,
  icon,
  children,
  ...props
}: MenuPrimitive.RadioItem.Props & { icon?: ReactNode }) {
  return (
    <MenuPrimitive.RadioItem
      data-slot="dropdown-menu-radio-item"
      className={cn("menu-item", className)}
      {...props}
    >
      {icon === undefined ? null : <span className="menu-item-icon">{icon}</span>}
      {children}
      <span className="menu-item-end">
        <MenuPrimitive.RadioItemIndicator>
          <Icon icon={CheckIcon} size={16} />
        </MenuPrimitive.RadioItemIndicator>
      </span>
    </MenuPrimitive.RadioItem>
  );
}

function DropdownMenuSeparator({ className, ...props }: MenuPrimitive.Separator.Props) {
  return (
    <MenuPrimitive.Separator
      data-slot="dropdown-menu-separator"
      className={cn("menu-sep", className)}
      {...props}
    />
  );
}

export {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
};
