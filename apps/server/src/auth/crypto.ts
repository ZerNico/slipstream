/**
 * Credential primitives on `node:crypto`: scrypt password hashes, random bearer secrets stored
 * only as SHA-256, HMAC signatures, and the short codes TVs show for device sign-in.
 */
import {
  createHash,
  createHmac,
  randomBytes,
  randomInt,
  scrypt,
  timingSafeEqual,
} from "node:crypto";
import { Effect } from "effect";
import { normaliseUserCode } from "@slipstream/api";

/** scrypt cost parameters: N = 2^15 (about 32 MiB, ~50 ms on a NAS-class CPU), r = 8, p = 1. */
const SCRYPT = { N: 32_768, r: 8, p: 1, keyLength: 32, saltLength: 16 } as const;
const MAX_MEMORY = 128 * SCRYPT.N * SCRYPT.r * 2;

const derive = (
  password: string,
  salt: Buffer,
  params: { N: number; r: number; p: number },
  keyLength: number,
) =>
  Effect.callback<Buffer>((resume) => {
    scrypt(
      password.normalize("NFKC"),
      salt,
      keyLength,
      { ...params, maxmem: MAX_MEMORY * 2 },
      (error, key) => {
        resume(error === null ? Effect.succeed(key) : Effect.die(error));
      },
    );
  });

/** Hashes a password as `scrypt$N$r$p$salt$hash` (salt and hash base64url). */
export const hashPassword = (password: string): Effect.Effect<string> =>
  Effect.gen(function* () {
    const salt = randomBytes(SCRYPT.saltLength);
    const key = yield* derive(password, salt, SCRYPT, SCRYPT.keyLength);
    return [
      "scrypt",
      SCRYPT.N,
      SCRYPT.r,
      SCRYPT.p,
      salt.toString("base64url"),
      key.toString("base64url"),
    ].join("$");
  });

/**
 * Checks a password against a stored hash in constant time. A malformed hash never verifies,
 * but still costs a full derivation so timing does not reveal it.
 */
export const verifyPassword = (password: string, stored: string): Effect.Effect<boolean> =>
  Effect.gen(function* () {
    const [scheme, n, r, p, salt, hash] = stored.split("$");
    const params = { N: Number(n), r: Number(r), p: Number(p) };
    const valid =
      scheme === "scrypt" &&
      salt !== undefined &&
      hash !== undefined &&
      Number.isInteger(params.N) &&
      Number.isInteger(params.r) &&
      Number.isInteger(params.p);
    if (!valid) {
      yield* derive(password, randomBytes(SCRYPT.saltLength), SCRYPT, SCRYPT.keyLength);
      return false;
    }
    const expected = Buffer.from(hash, "base64url");
    const actual = yield* derive(password, Buffer.from(salt, "base64url"), params, expected.length);
    return expected.length > 0 && timingSafeEqual(actual, expected);
  });

/** A hash to verify against when the username does not exist, so both paths take as long. */
export const decoyPasswordHash = hashPassword(randomBytes(16).toString("hex"));

/** A random bearer secret (256 bits, base64url). */
export const randomToken = (): string => randomBytes(32).toString("base64url");

/** SHA-256 hex of a bearer secret, the only form stored in the database. */
export const sha256 = (value: string): string => createHash("sha256").update(value).digest("hex");

/** HMAC-SHA256 of `value` under `key`, base64url. */
export const hmac = (key: Uint8Array, value: string): string =>
  createHmac("sha256", key).update(value).digest("base64url");

/** Compares two strings without leaking where they differ. */
export const safeEqual = (a: string, b: string): boolean => {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
};

/** Letters and digits that cannot be mistaken for each other on a TV: no 0/O, 1/I. */
export const userCodeAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** An eight-character device sign-in code shown as `XXXX-XXXX` (40 bits of entropy). */
export const randomUserCode = (): string => {
  const chars = Array.from(
    { length: 8 },
    () => userCodeAlphabet[randomInt(userCodeAlphabet.length)],
  );
  return `${chars.slice(0, 4).join("")}-${chars.slice(4).join("")}`;
};

/**
 * A user code as stored, from what someone typed or scanned: normalised like every client does
 * (`normaliseUserCode`), with the dash of `randomUserCode` back in.
 */
export const storedUserCode = (input: string): string => {
  const cleaned = normaliseUserCode(input);
  return cleaned.length === 8 ? `${cleaned.slice(0, 4)}-${cleaned.slice(4)}` : cleaned;
};
