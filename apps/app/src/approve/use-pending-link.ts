import { useLinkingURL } from "expo-linking";
import { useRouter } from "expo-router";
import { useEffect, useRef } from "react";
import { deviceLinkCode } from "./device-link.ts";

/**
 * Keeps a scanned TV sign-in link across signing in on the phone. The approve screen sits
 * behind the sign-in guard, so a link that arrives before anyone is signed in would be dropped;
 * this remembers its code and opens the approve screen once a profile is ready.
 */
export const usePendingDeviceLink = (ready: boolean): void => {
  const url = useLinkingURL();
  const router = useRouter();
  const pending = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (url === null) return;
    const code = deviceLinkCode(url);
    // Signed in already: the router opened the approve screen itself.
    if (code !== undefined && !ready) pending.current = code;
  }, [url, ready]);

  useEffect(() => {
    const code = pending.current;
    if (!ready || code === undefined) return;
    pending.current = undefined;
    router.push({ pathname: "/link", params: { code } });
  }, [ready, router]);
};
