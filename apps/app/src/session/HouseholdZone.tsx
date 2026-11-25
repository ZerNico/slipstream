import { getLocale, getRegion, setTimeZone, subscribe } from "@slipstream/i18n";
import { skipToken, useQuery } from "@tanstack/react-query";
import * as SecureStore from "expo-secure-store";
import { Fragment, useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { queryKeys } from "../api/keys.ts";
import { apiQueries } from "../api/queries.ts";
import { loadZone, saveZone, zoneInEffect } from "./household-zone.ts";
import { useSession } from "./session-context.ts";

/**
 * Writes every clock time and day below it in the household's time zone (`system.timeZone`),
 * the zone the server records by, so a reader abroad sees "20:15" where the guide says 20:15.
 * The same as the web's `HouseholdZone`.
 *
 * The zone goes into the shared formatters before the children render, so the first paint
 * already uses it: the zone the server named last time is read from the device first (the
 * splash screen stays up meanwhile), and the fresh answer replaces it. Formatting is a plain
 * function call, so a new zone remounts the subtree to redraw every time on screen; that
 * happens on the first start (or when the household moves) and never on a warm one. While no
 * zone is known, the device's applies. The language and region key the subtree the same way:
 * every word is a plain call too (and the React Compiler caches what it cannot see change), so a
 * new language from Settings or the device redraws everything at once.
 */
const languageKey = () => `${getLocale()}-${getRegion() ?? ""}`;

export const HouseholdZone = ({ children }: { readonly children: ReactNode }) => {
  const { runtime } = useSession();
  const language = useSyncExternalStore(subscribe, languageKey, languageKey);
  // `null` while the device is still being read.
  const [remembered, setRemembered] = useState<string | undefined | null>(null);
  useEffect(() => {
    let cancelled = false;
    loadZone(SecureStore)
      .then((zone) => {
        if (!cancelled) setRemembered(zone);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);
  const system = useQuery(
    runtime === undefined
      ? { queryKey: queryKeys.system, queryFn: skipToken }
      : apiQueries(runtime).system(),
  );
  const fetched = system.data?.timeZone;
  // Remember a new answer for the next start; this run already uses it.
  useEffect(() => {
    if (fetched !== undefined && remembered !== null && fetched !== remembered) {
      saveZone(SecureStore, fetched).catch(() => undefined);
    }
  }, [fetched, remembered]);

  if (remembered === null) return null;
  const zone = zoneInEffect(fetched, remembered);
  // Idempotent and read only by the children rendered next.
  setTimeZone(zone);
  return <Fragment key={`${zone ?? "device"}|${language}`}>{children}</Fragment>;
};
