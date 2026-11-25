import { useEffect, useState } from "react";
import Zeroconf from "react-native-zeroconf";
import {
  removeServer,
  SERVICE_TYPE,
  serverFromService,
  upsertServer,
  type FoundServer,
} from "./discovery.ts";

/** What discovery has found so far, and whether it is still looking. */
export interface Discovery {
  readonly servers: readonly FoundServer[];
  readonly scanning: boolean;
  /** Discovery failed to start (no multicast on this network or device). */
  readonly failed: boolean;
}

/** How long to keep scanning before saying nothing was found. */
const SCAN_MS = 8000;

/**
 * Scans the LAN for Slipstream servers with mDNS/DNS-SD (react-native-zeroconf, Android NSD)
 * for a few seconds after mount. Remount the caller to scan again ("Try again"); scanning stops
 * on unmount.
 */
export const useDiscovery = (): Discovery => {
  const [servers, setServers] = useState<readonly FoundServer[]>([]);
  const [scanning, setScanning] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const zeroconf = new Zeroconf();
    zeroconf.on("resolved", (service) => {
      const server = serverFromService(service);
      if (server !== undefined) setServers((current) => upsertServer(current, server));
    });
    zeroconf.on("remove", (name) => setServers((current) => removeServer(current, name)));
    zeroconf.on("error", () => setFailed(true));
    zeroconf.scan({ type: SERVICE_TYPE, protocol: "tcp", domain: "local." });
    const timer = setTimeout(() => {
      setScanning(false);
      zeroconf.stop();
    }, SCAN_MS);
    return () => {
      clearTimeout(timer);
      zeroconf.stop();
      zeroconf.removeDeviceListeners();
    };
  }, []);

  return { servers, scanning, failed };
};
