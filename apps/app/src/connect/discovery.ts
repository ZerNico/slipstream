import { normaliseServerUrl } from "../api/client.ts";

/**
 * DNS-SD service type the server advertises: `_slipstream._tcp` in the `local.` domain. TXT
 * keys the app reads: `url` (the public base URL, preferred when set) and `path` (a base path
 * behind a reverse proxy).
 */
export const SERVICE_TYPE = "slipstream";

/** A resolved service as react-native-zeroconf reports it. */
export interface ResolvedService {
  readonly name: string;
  readonly host: string;
  readonly port: number;
  readonly ipv4: readonly string[];
  readonly txt: Readonly<Record<string, string>>;
}

/** A Slipstream server found on the network. */
export interface FoundServer {
  /** The instance name the server advertises ("unraid"). */
  readonly name: string;
  /** Origin the app connects to. */
  readonly url: string;
  /** What the sign-in screen shows: the IPv4 address, else the host name. */
  readonly address: string;
}

/**
 * Turns a resolved service into a server. IPv4 wins over the `.local` host name, because
 * Android resolves mDNS host names unreliably; a `url` TXT record wins over both.
 */
export const serverFromService = (service: ResolvedService): FoundServer | undefined => {
  const fromTxt = service.txt.url === undefined ? undefined : normaliseServerUrl(service.txt.url);
  const ip = service.ipv4[0];
  const host = ip ?? service.host.replace(/\.$/u, "");
  if (fromTxt !== undefined) return { name: service.name, url: fromTxt, address: ip ?? host };
  if (host === "" || service.port <= 0) return undefined;
  const path = service.txt.path ?? "";
  const url = normaliseServerUrl(`http://${host}:${service.port}${path}`);
  return url === undefined ? undefined : { name: service.name, url, address: host };
};

/** Adds or updates a server (keyed by name), keeping the list sorted by name. */
export const upsertServer = (
  servers: readonly FoundServer[],
  server: FoundServer,
): readonly FoundServer[] =>
  [...servers.filter((existing) => existing.name !== server.name), server].toSorted((a, b) =>
    a.name.localeCompare(b.name),
  );

/** Drops a server whose advertisement went away. */
export const removeServer = (
  servers: readonly FoundServer[],
  name: string,
): readonly FoundServer[] => servers.filter((server) => server.name !== name);
