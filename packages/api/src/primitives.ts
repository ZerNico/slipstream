import { Schema } from "effect";

/*
 * The limits every request schema shares: how long names, labels and secrets may be. The server
 * reads no more than these (hashing a secret is not free), and forms hint with the same numbers.
 */

/** The shortest password the server accepts, for hints like "At least 10 characters". */
export const passwordMinLength = 10;

/** The longest password, PIN or switch secret the server reads (hashing is not free). */
export const secretMaxLength = 1024;

/** The longest name: usernames, display and profile names, device names and labels. */
export const nameMaxLength = 128;

/** A secret someone types to prove who they are: at most {@link secretMaxLength} characters. */
export const Secret = Schema.String.check(Schema.isMaxLength(secretMaxLength));

/** A non-empty name of at most {@link nameMaxLength} characters. */
export const Name = Schema.NonEmptyString.check(Schema.isMaxLength(nameMaxLength));

/** A recording or collection label: at most {@link nameMaxLength} characters. */
export const Label = Schema.String.check(Schema.isMaxLength(nameMaxLength));

/** A new password: {@link passwordMinLength} to {@link secretMaxLength} characters. */
export const Password = Schema.String.check(
  Schema.isMinLength(passwordMinLength),
  Schema.isMaxLength(secretMaxLength),
);
