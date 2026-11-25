import { setTimeZone } from "@slipstream/i18n";
import { Fragment, type ReactNode } from "react";
import { useHouseholdTimeZone } from "./hooks.ts";

/**
 * Writes every clock time and day below it in the household's time zone (`system.timeZone`),
 * the zone the server records by, so a reader abroad sees "20:15" where the guide says 20:15.
 *
 * The zone goes into the shared formatters before the children render, so the first paint
 * already uses it. Formatting is a plain function call the React Compiler memoizes around, so
 * a new zone remounts the subtree to redraw every time on screen; that happens once on a cold
 * load (while the screens still show skeletons) and never on a warm one, where the last
 * answer is kept in this browser. While the zone is unknown, the device's applies; screens
 * that depend on the day show skeletons until then.
 */
export function HouseholdZone({ children }: { children: ReactNode }) {
  const timeZone = useHouseholdTimeZone();
  // Idempotent and read only by the children rendered next; no React state changes with it
  // (`useLocale` subscribers compare the language, which stays the same).
  setTimeZone(timeZone);
  return <Fragment key={timeZone ?? "device"}>{children}</Fragment>;
}
