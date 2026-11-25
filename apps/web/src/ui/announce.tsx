import { useSyncExternalStore } from "react";
import { currentAnnouncement, subscribe } from "./announce-store.ts";

/** The polite live region; rendered once by the shell. */
export function Announcer() {
  const text = useSyncExternalStore(subscribe, currentAnnouncement, () => "");
  return (
    <div id="sr" className="sr-only" role="status" aria-live="polite">
      {text}
    </div>
  );
}
