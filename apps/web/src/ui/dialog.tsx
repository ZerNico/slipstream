import { type ReactNode, type RefObject, useRef } from "react";
import {
  Dialog as DialogRoot,
  DialogContent,
  DialogFooter,
  DialogTitle,
} from "~/ui/primitives/dialog.tsx";
import { openedFromKeyboard } from "~/ui/input-modality.ts";
import { Sheet } from "~/ui/sheet/sheet.tsx";
import { media, useMediaQuery } from "~/ui/use-media-query.ts";

/** What a dialog shows and how it closes. */
export interface DialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  /** The dialog's accessible name. */
  readonly label: string;
  /** Shows `label` as the dialog's heading. Off for dialogs whose content names itself. */
  readonly showTitle?: boolean;
  /** `md` 640 px, `sm` 460 px (a bottom sheet under 600 px). */
  readonly size?: "sm" | "md";
  /** The sticky action row. */
  readonly footer?: ReactNode;
  /** Where keyboard users land (the first field of a form); touch lands on the dialog itself. */
  readonly keyboardFocus?: RefObject<HTMLElement | null>;
  /** Where everyone lands, whatever the input (the palette's search field). */
  readonly initialFocus?: RefObject<HTMLElement | null>;
  readonly returnFocus?: RefObject<HTMLElement | null>;
  /** Keeps it dark (dialogs opened from the player). */
  readonly cine?: boolean;
  readonly children: ReactNode;
}

/**
 * A modal dialog (SPEC §4 Dialog). `sm` dialogs become a bottom sheet under 600 px with a grab
 * handle and drag to dismiss (the same sheet as everywhere); `md` stays a centred dialog that
 * fits the screen. Initial focus follows the input modality (SPEC §7.3).
 */
export function Dialog({
  open,
  onOpenChange,
  label,
  showTitle = false,
  size = "md",
  footer,
  keyboardFocus,
  initialFocus,
  returnFocus,
  cine = false,
  children,
}: DialogProps) {
  const centred = useMediaQuery(media.phablet);
  const popupRef = useRef<HTMLDivElement | null>(null);
  if (size === "sm" && !centred) {
    return (
      <Sheet
        open={open}
        onOpenChange={onOpenChange}
        label={label}
        halfSnap={false}
        bottomOnly
        hideHeader={!showTitle}
        cine={cine}
        {...(footer === undefined ? {} : { footer })}
        {...(initialFocus || keyboardFocus ? { keyboardFocus: initialFocus ?? keyboardFocus } : {})}
        {...(returnFocus ? { returnFocus } : {})}
      >
        {children}
      </Sheet>
    );
  }
  return (
    <DialogRoot open={open} onOpenChange={onOpenChange}>
      <DialogContent
        ref={popupRef}
        size={size}
        data-surface={cine ? "cine" : undefined}
        initialFocus={(type) =>
          initialFocus?.current ??
          (openedFromKeyboard(type) ? (keyboardFocus?.current ?? true) : popupRef.current)
        }
        {...(returnFocus ? { finalFocus: returnFocus } : {})}
      >
        <div className={showTitle ? "dialog-head" : "sr-only"}>
          <DialogTitle>{label}</DialogTitle>
        </div>
        {children}
        {footer === undefined ? null : <DialogFooter>{footer}</DialogFooter>}
      </DialogContent>
    </DialogRoot>
  );
}
