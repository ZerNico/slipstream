import { type NavigateOptions, useNavigate } from "@tanstack/react-router";
import {
  createContext,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
  use,
  useEffect,
  useMemo,
  useRef,
} from "react";
import { Icon } from "~/ui/icon.tsx";
import { CheckIcon } from "~/ui/icons.ts";
import type { MenuName } from "~/ui/overlay/overlay-state.ts";
import { useOverlay, useOverlayBinding } from "~/ui/overlay/use-overlay.tsx";
import { rovingIndex } from "~/ui/roving.ts";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "~/ui/primitives/dropdown-menu.tsx";
import { Sheet } from "~/ui/sheet/sheet.tsx";
import { media, useMediaQuery } from "~/ui/use-media-query.ts";

/** Whether the items render inside a popover menu or inside a sheet. */
type MenuMode =
  | { readonly kind: "popover" }
  | {
      readonly kind: "sheet";
      /** Closes the sheet; resolves once the URL has dropped it. */
      readonly close: () => Promise<void>;
      readonly leaveTo: (target: NavigateOptions) => void;
    };

const MenuModeContext = createContext<MenuMode>({ kind: "popover" });

const RadioContext = createContext<{
  value: string;
  onValueChange: (value: string) => void;
} | null>(null);

/**
 * A menu that is a popover on desktop and a Sheet under 768 px on touch (SPEC §2.4): the same
 * items, the one sheet behaviour (drag, Back, inert, focus trap), `?dlg=<name>` in the URL so
 * Back closes it, focus on the checked item for radio menus, focus back on the trigger. A deep
 * link with `?dlg=<name>` opens the sheet on phones and is dropped elsewhere.
 */
export function ResponsiveMenu({
  name,
  label,
  trigger,
  align = "end",
  side = "bottom",
  cine = false,
  open,
  onOpenChange,
  className,
  children,
}: {
  /** The URL name (`account`, `filter`, `day`). */
  name: MenuName;
  /** The menu's accessible name and the sheet's header. */
  label: string;
  /** The trigger button element. */
  trigger: ReactElement;
  align?: "start" | "center" | "end";
  /** Where the popover opens; the player's menus open upwards above its control row. */
  side?: "top" | "bottom";
  /** Dark in every theme, like the player it sits on (popover and sheet). */
  cine?: boolean;
  /**
   * The popover's open state, for a caller that opens it by key or keeps something awake
   * while it is open. A controlled popover is not modal, so the page under it keeps working.
   */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Extra classes for the popover. */
  className?: string;
  children: ReactNode;
}) {
  const asSheet = useMediaQuery(media.menuAsSheet);
  const overlay = useOverlay();
  const binding = useOverlayBinding("dlg", name);
  const triggerRef = useRef<HTMLElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const firstRef = useRef<HTMLElement | null>(null);

  // A context value: the lint rule against constructed context values wants it memoized.
  const sheetMode = useMemo<MenuMode>(
    () => ({
      kind: "sheet",
      close: () => overlay.close(),
      leaveTo: (target) => overlay.leaveTo(target),
    }),
    [overlay],
  );

  // `?dlg=<name>` exists only where the menu is a sheet; elsewhere the param is dropped.
  const strayParam = binding.open && !asSheet;
  useEffect(() => {
    if (strayParam) void overlay.close();
  }, [strayParam, overlay]);

  if (!asSheet) {
    const controlled = open !== undefined;
    return (
      <DropdownMenu
        modal={!controlled}
        {...(controlled ? { open, ...(onOpenChange ? { onOpenChange } : {}) } : {})}
      >
        <DropdownMenuTrigger render={trigger} />
        <DropdownMenuContent
          align={align}
          side={side}
          aria-label={label}
          className={className}
          data-surface={cine ? "cine" : undefined}
        >
          {children}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  const keyboardTarget = () => {
    const list = listRef.current;
    firstRef.current =
      list?.querySelector<HTMLElement>('[aria-checked="true"]') ??
      list?.querySelector<HTMLElement>('[role^="menuitem"]') ??
      null;
  };

  return (
    <>
      <TriggerSlot
        trigger={trigger}
        triggerRef={triggerRef}
        onOpen={() => {
          keyboardTarget();
          overlay.open({ kind: "dlg", name });
        }}
      />
      <Sheet
        open={binding.open && asSheet}
        onOpenChange={binding.onOpenChange}
        label={label}
        halfSnap={false}
        bottomOnly
        cine={cine}
        keyboardFocus={firstRef}
        returnFocus={triggerRef}
      >
        <MenuModeContext value={sheetMode}>
          <div
            ref={listRef}
            role="menu"
            aria-label={label}
            className="menu-inline"
            onKeyDown={moveFocus}
          >
            {children}
          </div>
        </MenuModeContext>
      </Sheet>
    </>
  );
}

/** Renders the trigger with an open handler and a ref, keeping its own props. */
function TriggerSlot({
  trigger,
  triggerRef,
  onOpen,
}: {
  trigger: ReactElement;
  triggerRef: { current: HTMLElement | null };
  onOpen: () => void;
}) {
  return (
    <span
      className="contents"
      ref={(node) => {
        triggerRef.current =
          node?.firstElementChild instanceof HTMLElement ? node.firstElementChild : null;
      }}
      onClickCapture={(event) => {
        event.preventDefault();
        onOpen();
      }}
    >
      {trigger}
    </span>
  );
}

/** Arrow keys, Home and End move between rows of a menu rendered in a sheet. */
const moveFocus = (event: KeyboardEvent<HTMLDivElement>) => {
  const rows = [...event.currentTarget.querySelectorAll<HTMLElement>('[role^="menuitem"]')];
  const index = rows.indexOf(document.activeElement as HTMLElement);
  const next = rovingIndex(index, rows.length, event.key);
  if (next === undefined) return;
  event.preventDefault();
  rows[next]?.focus();
};

/**
 * A menu row: a 20 px icon column, the label, optional trailing text. Pass `link` for rows that go
 * somewhere (in a sheet the overlay's history entry is replaced, so Back never reopens it) or
 * `onSelect` for actions.
 */
export function MenuItem({
  icon,
  end,
  link,
  onSelect,
  disabled,
  children,
}: {
  icon?: ReactNode;
  end?: ReactNode;
  link?: NavigateOptions;
  onSelect?: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  const mode = use(MenuModeContext);
  const navigate = useNavigate();
  if (mode.kind === "popover") {
    return (
      <DropdownMenuItem
        icon={icon}
        end={end}
        onClick={() => {
          if (link !== undefined) void navigate(link);
          onSelect?.();
        }}
        {...(disabled ? { disabled } : {})}
      >
        {children}
      </DropdownMenuItem>
    );
  }
  return (
    <button
      type="button"
      role="menuitem"
      className="menu-item"
      disabled={disabled}
      onClick={() => {
        // A link replaces the sheet's entry; an action waits until the sheet has left the URL,
        // so whatever it navigates to (another overlay, a search param) is not undone by Back.
        if (link !== undefined) {
          mode.leaveTo(link);
          onSelect?.();
        } else {
          void mode.close().then(() => onSelect?.());
        }
      }}
    >
      {icon === undefined ? null : <span className="menu-item-icon">{icon}</span>}
      {children}
      {end === undefined ? null : <span className="menu-item-end">{end}</span>}
    </button>
  );
}

/** A group of radio rows (theme, day, view). */
export function MenuRadioGroup({
  value,
  onValueChange,
  children,
}: {
  value: string;
  onValueChange: (value: string) => void;
  children: ReactNode;
}) {
  const mode = use(MenuModeContext);
  const radio = useMemo(() => ({ value, onValueChange }), [value, onValueChange]);
  if (mode.kind === "popover") {
    return (
      <DropdownMenuRadioGroup value={value} onValueChange={onValueChange}>
        {children}
      </DropdownMenuRadioGroup>
    );
  }
  return (
    <RadioContext value={radio}>
      <div role="group">{children}</div>
    </RadioContext>
  );
}

/** A radio row; the checked one shows an amber tick. */
export function MenuRadioItem({
  value,
  icon,
  children,
}: {
  value: string;
  icon?: ReactNode;
  children: ReactNode;
}) {
  const mode = use(MenuModeContext);
  const radio = use(RadioContext);
  if (mode.kind === "popover") {
    return (
      <DropdownMenuRadioItem value={value} icon={icon} closeOnClick>
        {children}
      </DropdownMenuRadioItem>
    );
  }
  const checked = radio?.value === value;
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={checked}
      className="menu-item"
      onClick={() => {
        void mode.close().then(() => radio?.onValueChange(value));
      }}
    >
      {icon === undefined ? null : <span className="menu-item-icon">{icon}</span>}
      {children}
      <span className="menu-item-end">{checked ? <Icon icon={CheckIcon} size={16} /> : null}</span>
    </button>
  );
}

/** A hairline between groups of rows. */
export function MenuSeparator() {
  const mode = use(MenuModeContext);
  return mode.kind === "popover" ? (
    <DropdownMenuSeparator />
  ) : (
    <div role="separator" className="menu-sep" />
  );
}

/** A small uppercase heading over a group of rows. */
export function MenuLabel({ children }: { children: ReactNode }) {
  return (
    <div className="menu-head" role="presentation">
      {children}
    </div>
  );
}
