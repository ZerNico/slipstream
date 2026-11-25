import { skipToken, useQuery, useQueryClient } from "@tanstack/react-query";
import { type AvatarTone, RuleId, type UserId } from "@slipstream/domain";
import { use, useEffect, useState } from "react";
import { ApiContext, type ApiContextValue } from "./api-context.ts";
import type { Api, EventsStatus } from "./client.ts";
import { applyServerEvent } from "./events.ts";
import { keys, type Queries } from "./queries.ts";
import { shapes } from "./shape-cache.ts";

const useApiContext = (): ApiContextValue => {
  const value = use(ApiContext);
  if (!value) throw new Error("useApi needs an <ApiProvider> above it");
  return value;
};

/** The API bridge, for mutations. */
export const useApi = (): Api => useApiContext().api;

/** The read options, for `useQuery`. */
export const useQueries = (): Queries => useApiContext().queries;

/**
 * Follows the server's live events while mounted and applies them to the cache. Returns how
 * the connection is doing, so the shell can say when live updates are paused.
 */
export function useServerEvents(): EventsStatus {
  const api = useApi();
  const client = useQueryClient();
  const [status, setStatus] = useState<EventsStatus>("connecting");
  useEffect(() => {
    let interrupted = false;
    return api.events(
      (event) => applyServerEvent(client, event),
      (next) => {
        setStatus(next);
        if (next === "retrying") interrupted = true;
        // After a gap, whatever changed meanwhile was missed; refetch what is on screen.
        if (next === "open" && interrupted) {
          interrupted = false;
          void client.invalidateQueries({ refetchType: "active" });
        }
      },
    );
  }, [api, client]);
  return status;
}

/**
 * The household's time zone (`system.timeZone`): the zone the server counts calendar days,
 * rules and groups in, so anything that names a day or predicts the server uses it, never the
 * browser's. Undefined until the server answered, unless this browser kept its last answer.
 */
export function useHouseholdTimeZone(): string | undefined {
  const system = useQuery({
    ...useQueries().system(),
    placeholderData: (previous) => previous ?? shapes.system.read(),
  });
  return system.data?.timeZone;
}

/** The key of a query that waits for a rule id. */
const noRule = RuleId.make("none");

/** "Group these as “Live F1”?" for a series recording; no offer while loading or when none. */
export function useRuleOffer(id: RuleId | undefined) {
  const queries = useQueries();
  return useQuery(
    id === undefined
      ? { queryKey: keys.ruleOffer(noRule), queryFn: skipToken }
      : queries.ruleOffer(id),
  );
}

/** How many deleted episodes a series recording keeps out for the viewer. */
export function useRuleHistory(id: RuleId | undefined) {
  const queries = useQueries();
  return useQuery(
    id === undefined
      ? { queryKey: keys.ruleHistory(noRule), queryFn: skipToken }
      : queries.ruleHistory(id),
  );
}

/**
 * Airings in a window (epoch ms) the viewer already has, for the guide's repeat mark. Keeps the
 * last answer while the window moves, so marks never blink.
 */
export function useGuideRepeats(range: { readonly from: number; readonly to: number }) {
  return useQuery({
    ...useQueries().guideRepeats(range.from, range.to),
    placeholderData: (previous) => previous,
  });
}

/**
 * Each household profile's avatar tone by id, for avatars beside owners' names. Empty until the
 * profiles load, and for guests, who see only themselves; avatars then use the default tone.
 */
export function useAvatarTones(): (id: UserId | undefined) => AvatarTone | undefined {
  const profiles = useQuery(useQueries().profiles()).data;
  return (id) =>
    id === undefined ? undefined : profiles?.find((profile) => profile.id === id)?.avatarTone;
}
