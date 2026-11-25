import { Toast } from "@base-ui/react/toast";
import type { ReactNode } from "react";
import { Icon } from "~/ui/icon.tsx";
import { CheckIcon, RecordIcon, WarningIcon } from "~/ui/icons.ts";
import { media, useMediaQuery } from "~/ui/use-media-query.ts";
import { toastManager, toastTimeout } from "./toast-manager.ts";

/**
 * The toast layer (SPEC §2.2): phone centred above the tab bar, the mini player and a save bar;
 * from 768 px bottom right; in the player top centre. At most three, one in short landscape.
 */
export function Toaster({ children }: { children?: ReactNode }) {
  const short = useMediaQuery(media.shortLandscape);
  return (
    <Toast.Provider toastManager={toastManager} limit={short ? 1 : 3} timeout={toastTimeout}>
      {children}
      <Toast.Portal>
        <Toast.Viewport className="toasts">
          <ToastList />
        </Toast.Viewport>
      </Toast.Portal>
    </Toast.Provider>
  );
}

function ToastList() {
  const { toasts } = Toast.useToastManager();
  return toasts.map((item) => {
    const quiet =
      typeof item.data === "object" &&
      item.data !== null &&
      "quiet" in item.data &&
      item.data.quiet === true;
    return (
      <Toast.Root
        key={item.id}
        toast={item}
        className="toast"
        data-type={item.type}
        swipeDirection={["down", "right"]}
      >
        <Toast.Content className="toast-content">
          <span className="toast-icon" aria-hidden="true">
            <Icon
              icon={
                item.type === "recording"
                  ? RecordIcon
                  : item.type === "error"
                    ? WarningIcon
                    : CheckIcon
              }
            />
          </span>
          {/* Already announced in place: only the words are quiet, Undo stays reachable. */}
          <span className="toast-text" {...(quiet ? { "aria-hidden": true } : {})}>
            <Toast.Title className="toast-title" />
            <Toast.Description className="toast-description" />
          </span>
          <Toast.Action className="toast-action" />
        </Toast.Content>
      </Toast.Root>
    );
  });
}
