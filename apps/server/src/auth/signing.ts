/**
 * The server's signing key and what it signs: short-lived HLS URL tokens (players do not send
 * auth headers) and the CSRF token bound to a browser session.
 *
 * The key is derived (`SecretKey.derive`, HKDF-SHA256 under {@link SIGNING_LABEL}) from
 * `secret.key` in the config directory, the file that also seals source secrets, and never
 * stored: a copied database or backup cannot forge playlist links or CSRF tokens.
 */
import { Clock, Context, Effect, Layer, Schema } from "effect";
import { hmac, safeEqual } from "./crypto.ts";
import { SecretKey } from "./secret-key.ts";

/**
 * What an HLS token allows: one user reading one playlist family, inside a time window, until
 * `exp`, for as long as the sign-in it was issued under lasts.
 */
export const HlsGrant = Schema.Struct({
  /** User the playback belongs to. */
  u: Schema.String,
  /**
   * `live:<channelId>`, `range:<channelId>:<from>:<to>`, `rec:<recordingId>` for playlists, or
   * `cap:<captureId>` for segment files.
   */
  s: Schema.String,
  /** Expiry, epoch milliseconds. */
  exp: Schema.Number,
  /** The sign-in (session row) it was issued under; it dies with it (sign-out, revoked device). */
  sid: Schema.optionalKey(Schema.String),
  /** Start of the time window the grant opens, epoch ms; segments outside it are refused. */
  from: Schema.optionalKey(Schema.Number),
  /**
   * End of the window, epoch ms. Live playlist tokens have none (their window moves with the
   * live edge); every segment token has one, a live one a few target durations ahead.
   */
  to: Schema.optionalKey(Schema.Number),
});
export type HlsGrant = typeof HlsGrant.Type;

const decodeGrant = Schema.decodeUnknownOption(Schema.fromJsonString(HlsGrant));

/** The HKDF label: another label derives an unrelated key from the same file. */
export const SIGNING_LABEL = "slipstream signing key v1";

/** Signs and verifies tokens with a key derived from `secret.key`. */
export class Signing extends Context.Service<
  Signing,
  {
    /** A URL-safe token for `scope` (plus session and window), valid for `ttlMillis`. */
    readonly signHls: (
      grant: Omit<HlsGrant, "exp">,
      ttlMillis: number,
    ) => Effect.Effect<{ readonly token: string; readonly exp: number }>;
    /** Signs a grant with a fixed expiry, so a playlist's segment links expire with it. */
    readonly signGrant: (grant: HlsGrant) => string;
    /** The grant in a token if the signature holds and it has not expired. */
    readonly verifyHls: (token: string) => Effect.Effect<HlsGrant | undefined>;
    /** The CSRF token for a browser session; the web client echoes it in `x-csrf-token`. */
    readonly csrfFor: (sessionToken: string) => string;
  }
>()("@slipstream/server/Signing") {
  static readonly layer = Layer.effect(
    Signing,
    Effect.gen(function* () {
      const key = (yield* SecretKey).derive(SIGNING_LABEL);

      const signGrant = (grant: HlsGrant) => {
        const body = Buffer.from(JSON.stringify(grant)).toString("base64url");
        return `${body}.${hmac(key, `hls:${body}`)}`;
      };

      return Signing.of({
        signGrant,
        signHls: (grant, ttlMillis) =>
          Effect.map(Clock.currentTimeMillis, (now) => {
            const exp = now + ttlMillis;
            return { token: signGrant({ ...grant, exp }), exp };
          }),
        verifyHls: (token) =>
          Effect.map(Clock.currentTimeMillis, (now) => {
            const [body, signature] = token.split(".");
            if (body === undefined || signature === undefined) return undefined;
            if (!safeEqual(signature, hmac(key, `hls:${body}`))) return undefined;
            const grant = decodeGrant(Buffer.from(body, "base64url").toString("utf8"));
            return grant._tag === "Some" && grant.value.exp > now ? grant.value : undefined;
          }),
        csrfFor: (sessionToken) => hmac(key, `csrf:${sessionToken}`),
      });
    }),
  );
}
