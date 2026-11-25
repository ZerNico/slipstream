import { createContext, useContext } from "react";

/** A short notice over every screen, optionally with one action ("Undo"). */
export interface Toast {
  readonly text: string;
  readonly action?: { readonly label: string; readonly onPress: () => void } | undefined;
}

/** Shows a toast, replacing the one on screen. */
export type ShowToast = (toast: Toast) => void;

/** How long a toast without an action stays, ms. */
const TOAST_MILLIS = 5000;

/** How long a toast with an action stays, ms: longer, so there is time to press it. */
export const TOAST_ACTION_MILLIS = 8000;

/** How long a toast stays. */
export const toastMillis = (toast: Toast): number =>
  toast.action === undefined ? TOAST_MILLIS : TOAST_ACTION_MILLIS;

/** Filled by `ToastHost`; outside it, toasts go nowhere. */
export const ToastContext = createContext<ShowToast>(() => undefined);

/** Shows toasts through the nearest `ToastHost`. */
export const useToast = (): ShowToast => useContext(ToastContext);
