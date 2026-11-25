import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import type { ComponentProps } from "react";
import { cn } from "~/ui/utils.ts";

/**
 * The centred dialog (SPEC §4 Dialog): `md` 640 px, `sm` 460 px, a scrolling body and a sticky
 * action footer, `max-height` that always fits the screen. Modal: focus trap, scroll lock,
 * background inert, Esc, focus returns to the opener. The `sm` size becomes a bottom sheet under
 * 600 px; that switch lives in `ui/dialog.tsx`.
 */
function Dialog({ ...props }: DialogPrimitive.Root.Props) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />;
}

/** The popup with its backdrop. `size` picks the width. */
function DialogContent({
  className,
  size = "md",
  children,
  ...props
}: DialogPrimitive.Popup.Props & { size?: "sm" | "md" }) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Backdrop data-slot="dialog-overlay" className="dialog-backdrop" />
      <DialogPrimitive.Viewport className="dialog-viewport" data-overlay-root="">
        <DialogPrimitive.Popup
          data-slot="dialog-content"
          data-size={size}
          className={cn("dialog", className)}
          {...props}
        >
          {children}
        </DialogPrimitive.Popup>
      </DialogPrimitive.Viewport>
    </DialogPrimitive.Portal>
  );
}

/** The sticky action row: stays on screen while the body scrolls. */
function DialogFooter({ className, ...props }: ComponentProps<"div">) {
  return <div data-slot="dialog-footer" className={cn("dialog-footer", className)} {...props} />;
}

function DialogTitle({ className, ...props }: DialogPrimitive.Title.Props) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn("dialog-title", className)}
      {...props}
    />
  );
}

export { Dialog, DialogContent, DialogFooter, DialogTitle };
