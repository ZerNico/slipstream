import { useQueryClient } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";
import type { EventsStatus } from "~/api/client.ts";
import { m } from "@slipstream/i18n";
import { Icon } from "~/ui/icon.tsx";
import { OfflineIcon } from "~/ui/icons.ts";
import { Button } from "~/ui/primitives/button.tsx";

const subscribeOnline = (notify: () => void) => {
  window.addEventListener("online", notify);
  window.addEventListener("offline", notify);
  return () => {
    window.removeEventListener("online", notify);
    window.removeEventListener("offline", notify);
  };
};

/** Whether the browser says it is online. */
const useOnline = () =>
  useSyncExternalStore(
    subscribeOnline,
    () => navigator.onLine,
    () => true,
  );

/**
 * The offline strip (SPEC §2.2, §3.1): a neutral glass overlay under the top bar with an orange
 * icon, never red and never in flow, so it moves nothing when the connection drops. Shown while
 * the browser is offline or the live event stream is reconnecting.
 */
export function OfflineStrip({ events }: { events: EventsStatus }) {
  const online = useOnline();
  const client = useQueryClient();
  if (online && events !== "retrying") return null;
  return (
    <div className="shell-offline" role="status">
      <div className="shell-offline-row wrap">
        <Icon icon={OfflineIcon} className="shell-offline-icon" />
        <span className="min-w-0 flex-1">{m.error_offline()}</span>
        <Button size="sm" onClick={() => void client.invalidateQueries({ refetchType: "active" })}>
          {m.action_try_again()}
        </Button>
      </div>
    </div>
  );
}
