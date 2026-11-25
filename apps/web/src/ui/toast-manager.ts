import { Toast } from "@base-ui/react/toast";
import { m } from "@slipstream/i18n";

/** How long a toast stays, ms (SPEC §4 Toast). */
export const toastTimeout = 4200;

/** The app-wide toast manager: `toast()` works from anywhere, inside React or not. */
export const toastManager = Toast.createToastManager();

/** What a toast says and offers. */
export interface ToastOptions {
  readonly title: string;
  readonly description?: string;
  /** success (green tick), recording (red dot), error (red warning). */
  readonly type?: "success" | "recording" | "error";
  /** Shows "Undo"; called when pressed, then the toast closes. */
  readonly undo?: () => void;
  /**
   * The same news was already announced in place (the polite live region): the toast's words
   * are hidden from assistive tech, so each event is heard once (SPEC §7.3). Its Undo stays
   * reachable.
   */
  readonly alreadyAnnounced?: boolean;
}

/** Shows a toast. Returns its id, for `dismissToast`. */
export const toast = (options: ToastOptions): string => {
  const id = crypto.randomUUID();
  const { undo } = options;
  return toastManager.add({
    id,
    title: options.title,
    ...(options.description === undefined ? {} : { description: options.description }),
    type: options.type ?? "success",
    timeout: toastTimeout,
    data: { quiet: options.alreadyAnnounced === true },
    ...(undo
      ? {
          actionProps: {
            children: m.toast_undo(),
            onClick: () => {
              undo();
              toastManager.close(id);
            },
          },
        }
      : {}),
  });
};

/** Closes a toast early. */
export const dismissToast = (id: string): void => toastManager.close(id);
