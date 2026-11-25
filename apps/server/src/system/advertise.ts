/**
 * Local network discovery (PLAN 6.9): the server announces itself over mDNS / DNS-SD as
 * `_slipstream._tcp` with a TXT record `url` (its public URL, or its LAN address), so the app's
 * sign-in screen finds it without typing an address. Uses `bonjour-service` (pure JavaScript
 * multicast DNS). Off with `SLIPSTREAM_MDNS=false`, e.g. when the host already runs a
 * responder that misbehaves next to a second one; failures are logged and never stop the server.
 */
import { hostname, networkInterfaces } from "node:os";
import { Effect, Layer } from "effect";
import { HttpServer } from "effect/http";
import { ServerConfig } from "../config.ts";

/** The DNS-SD service type, without the leading underscore and protocol. */
export const serviceType = "slipstream";

/** The first non-internal IPv4 address of this machine, if any. */
const lanAddress = (): string | undefined => {
  for (const addresses of Object.values(networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address.family === "IPv4" && !address.internal) return address.address;
    }
  }
  return undefined;
};

/** The URL clients should use: the public URL when configured, otherwise the LAN address. */
export const advertisedUrl = (
  publicUrl: string | undefined,
  port: number,
  address: string | undefined = lanAddress(),
): string => publicUrl ?? `http://${address ?? hostname()}:${port}`;

/** The service instance name people see in discovery lists. */
export const instanceName = (host: string = hostname()): string =>
  `Slipstream (${host.replace(/\.local\.?$/u, "")})`;

/** Announces the server while the layer is open, when `advertise` is on. */
export const AdvertiseLive = Layer.effectDiscard(
  Effect.gen(function* () {
    const config = yield* ServerConfig;
    if (!config.advertise) return;
    const server = yield* HttpServer.HttpServer;
    if (server.address._tag === "UnixPathAddress") return;
    const { port } = server.address;
    const url = advertisedUrl(config.publicUrl, port);
    // The library reports errors through callbacks; log them with this layer's logger.
    const runLogged = Effect.runForkWith(yield* Effect.context());
    const onError = (error: unknown) => {
      runLogged(Effect.logWarning("mDNS announcement failed", error));
    };
    yield* Effect.acquireRelease(
      Effect.tryPromise(() => import("bonjour-service")).pipe(
        Effect.map(({ default: Bonjour }) => {
          const bonjour = new Bonjour({}, onError);
          const service = bonjour.publish({
            name: instanceName(),
            type: serviceType,
            protocol: "tcp",
            port,
            txt: { url },
          });
          service.on("error", onError);
          return bonjour;
        }),
        Effect.tap(() =>
          Effect.logInfo("Announcing on the local network").pipe(
            Effect.annotateLogs({ service: `_${serviceType}._tcp`, url }),
          ),
        ),
      ),
      (bonjour) =>
        Effect.callback<void>((resume) => {
          bonjour.unpublishAll(() => {
            bonjour.destroy(() => resume(Effect.void));
          });
        }).pipe(Effect.timeoutOrElse({ duration: "2 seconds", orElse: () => Effect.void })),
    ).pipe(
      Effect.catchCause((cause) =>
        Effect.logWarning("mDNS announcement is off: it could not start", cause),
      ),
    );
  }),
);
