/**
 * Source secrets at rest (PLAN 6.1): source configs and secret headers are sealed with
 * AES-256-GCM before they reach SQLite, so a copied database or backup does not hand out IPTV
 * credentials. The key is the server's `SecretKey` (`secret.key` in the config directory); keep it
 * with the database when restoring a backup.
 *
 * Sealed values look like `v1:<iv>:<tag>:<ciphertext>` (base64url). Every stored secret is
 * sealed; a value without the prefix is refused like one sealed with another key.
 *
 * `v1:` values are sealed with the raw key bytes (`SecretKey.raw`), as they always were, so every
 * stored secret keeps opening without a migration. The raw bytes serve only this purpose:
 * everything else (signing) uses a key derived under its own label, so no key doubles as
 * another. A future `v2:` with a derived sealing key would re-seal `v1:` values as they are read;
 * nothing needs it yet.
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { Context, Effect, Layer, Schema } from "effect";
import { SecretKey, secretKeyFile } from "../auth/secret-key.ts";

const prefix = "v1:";
const IV_BYTES = 12;

/** A sealed value does not open (another key, or not sealed at all). */
export class SecretBoxError extends Schema.TaggedError<SecretBoxError>()("SecretBoxError", {
  message: Schema.String,
}) {}

/** True for values written by {@link SecretBox}'s `seal`. */
export const isSealed = (value: string): boolean => value.startsWith(prefix);

/** Seals `plain` with `key`. Exported for tests; use the service. */
export const sealWith = (key: Buffer, plain: string): string => {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return `${prefix}${iv.toString("base64url")}:${cipher.getAuthTag().toString("base64url")}:${body.toString("base64url")}`;
};

/** Opens a value from {@link sealWith}. Throws when it does not open or is not sealed. */
export const openWith = (key: Buffer, value: string): string => {
  if (!isSealed(value)) throw new Error("not a sealed value");
  const [iv = "", tag = "", body = ""] = value.slice(prefix.length).split(":");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(body, "base64url")),
    decipher.final(),
  ]).toString("utf8");
};

/** Seals and opens source secrets. */
export class SecretBox extends Context.Service<
  SecretBox,
  {
    /** Seals a JSON value for storage. */
    readonly seal: (value: unknown) => string;
    /** Opens a stored value and parses its JSON. Dies when the key does not fit: a setup error. */
    readonly open: (stored: string) => Effect.Effect<unknown>;
    /** `open` for a value the caller can do without: fails instead of dying. */
    readonly tryOpen: (stored: string) => Effect.Effect<unknown, SecretBoxError>;
  }
>()("@slipstream/server/SecretBox") {
  /** Seals with the raw bytes of the server's `SecretKey`. */
  static readonly layer = Layer.effect(
    SecretBox,
    Effect.gen(function* () {
      const key = (yield* SecretKey).raw;
      const tryOpen = (stored: string) =>
        Effect.try({
          try: (): unknown => JSON.parse(openWith(key, stored)),
          catch: () =>
            new SecretBoxError({
              message: `a stored source secret does not open with ${secretKeyFile}; was the key replaced?`,
            }),
        });
      return SecretBox.of({
        seal: (value) => sealWith(key, JSON.stringify(value)),
        open: (stored) => Effect.orDie(tryOpen(stored)),
        tryOpen,
      });
    }),
  );
}
