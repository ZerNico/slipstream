import type { ReactElement } from "react";
import type { MenuName } from "~/ui/overlay/overlay-state.ts";
import {
  MenuLabel,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  ResponsiveMenu,
} from "~/ui/menu.tsx";

/** One radio row: a value, its label and an optional quieter second line. */
export interface PlayerMenuOption {
  readonly value: string;
  readonly label: string;
  readonly detail?: string;
}

/** A group of radio rows under a small heading. */
export interface PlayerMenuGroup {
  readonly label: string;
  readonly value: string;
  readonly options: readonly PlayerMenuOption[];
  readonly onChange: (value: string) => void;
  /** `pair`: two short choices side by side, as one segmented control (Fit and Fill). */
  readonly layout?: "rows" | "pair";
}

/**
 * The player's audio and Options menus (SPEC §7.1): the shared `ResponsiveMenu`, opening
 * upwards above the control row and dark like the player; under 768 px on touch the same rows
 * render in the one bottom sheet with `?dlg=<name>` in the URL, so Back closes it.
 */
export function PlayerMenu({
  name,
  label,
  trigger,
  groups,
  open,
  onOpenChange,
}: {
  /** The URL name of the sheet (`audio`, `quality`). */
  name: MenuName;
  label: string;
  trigger: ReactElement;
  groups: readonly PlayerMenuGroup[];
  /** The popover's open state, so keys (A, Q) can open it and the chrome stays awake. */
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <ResponsiveMenu
      name={name}
      label={label}
      trigger={trigger}
      side="top"
      cine
      open={open}
      onOpenChange={onOpenChange}
      className="max-w-80"
    >
      {groups.map((group, index) => (
        <div key={group.label} role="presentation">
          {index > 0 ? <MenuSeparator /> : null}
          <MenuLabel>{group.label}</MenuLabel>
          <MenuRadioGroup value={group.value} onValueChange={group.onChange}>
            {group.layout === "pair" ? (
              <div className="menu-pair" role="presentation">
                {group.options.map((option) => (
                  <MenuRadioItem key={option.value} value={option.value}>
                    {option.label}
                  </MenuRadioItem>
                ))}
              </div>
            ) : (
              group.options.map((option) => (
                <MenuRadioItem key={option.value} value={option.value}>
                  <OptionText option={option} />
                </MenuRadioItem>
              ))
            )}
          </MenuRadioGroup>
        </div>
      ))}
    </ResponsiveMenu>
  );
}

function OptionText({ option }: { option: PlayerMenuOption }) {
  if (option.detail === undefined) return <span className="min-w-0 flex-1">{option.label}</span>;
  return (
    <span className="grid min-w-0 flex-1">
      <span>{option.label}</span>
      <span className="text-caption font-normal text-fg-3">{option.detail}</span>
    </span>
  );
}
