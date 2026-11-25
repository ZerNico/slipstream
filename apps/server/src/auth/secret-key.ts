/**
 * The server's one secret: `secret.key` in the config directory, 32 random bytes (base64),
 * created on first start in a 0700 directory with mode 0600 and read once per start. Everything
 * secret the server keeps or hands out hangs off it:
 *
 * - `derive(label)`: an HKDF-SHA256 key per purpose (signing uses "slipstream signing key v1"),
 *   so one purpose's key never doubles as another's;
 * - `raw`: the file's bytes, which seal source secrets (`v1:` values, see `SecretBox`).
 *
 * Keep the file with the database when restoring a backup: without it sealed source secrets do
 * not open, and every playlist link and CSRF token signed before is void.
 */
import { hkdfSync, randomBytes } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Context, Effect, Layer, Schema } from "effect";
import { ServerConfig } from "../config.ts";

/** File name of the key inside the config directory. */
export const secretKeyFile = "secret.key";

const SECRET_KEY_BYTES = 32;

/** The key file could not be created or read, or does not hold a key. */
export class SecretKeyError extends Schema.TaggedError<SecretKeyError>()("SecretKeyError", {
  message: Schema.String,
}) {}

/**
 * The bytes of `<configDir>/secret.key`, creating it when this is the first start. The exclusive
 * create (`wx`) makes a race with another process safe: whoever loses reads the winner's key.
 */
export const readSecretKey = (configDir: string): Buffer => {
  mkdirSync(configDir, { recursive: true, mode: 0o700 });
  const path = join(configDir, secretKeyFile);
  try {
    writeFileSync(path, randomBytes(SECRET_KEY_BYTES).toString("base64"), {
      mode: 0o600,
      flag: "wx",
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  // A key restored from a backup may have come back readable by others.
  chmodSync(path, 0o600);
  const key = Buffer.from(readFileSync(path, "utf8").trim(), "base64");
  if (key.length !== SECRET_KEY_BYTES) {
    throw new Error(`${path} must hold ${SECRET_KEY_BYTES} base64-encoded bytes`);
  }
  return key;
};

/** A 32-byte key for `label` from the secret's bytes (HKDF-SHA256, no salt). */
export const deriveKey = (secret: Buffer, label: string): Buffer =>
  Buffer.from(hkdfSync("sha256", secret, Buffer.alloc(0), label, 32));

/** The server's secret key, read once per start. */
export class SecretKey extends Context.Service<
  SecretKey,
  {
    /** The file's bytes. Only `SecretBox` uses them directly; everything else derives. */
    readonly raw: Buffer;
    /** A key for one purpose; another label gives an unrelated key. */
    readonly derive: (label: string) => Buffer;
  }
>()("@slipstream/server/SecretKey") {
  /** The key from `<configDir>/secret.key`, created on first start. */
  static readonly layer = Layer.effect(
    SecretKey,
    Effect.gen(function* () {
      const config = yield* ServerConfig;
      const raw = yield* Effect.try({
        try: () => readSecretKey(config.configDir),
        catch: (cause) => new SecretKeyError({ message: String(cause) }),
      });
      return SecretKey.of({ raw, derive: (label) => deriveKey(raw, label) });
    }).pipe(Effect.orDie),
  );
}
