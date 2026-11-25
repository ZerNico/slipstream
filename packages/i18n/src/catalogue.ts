/**
 * Catalogue types. A message is a string, or a function of typed parameters that formats
 * through {@link Formatters}, so plurals, dates and sizes follow the reader's locale.
 */
import { en } from "../messages/index.ts";
import type { Formatters } from "./format.ts";

/** One message: plain text, or text built from parameters. */
export type Message = string | ((params: never, f: Formatters) => string);

/** The shape every translation fills: the English keys with the same parameters. */
export type Catalogue = {
  readonly [K in keyof typeof en]: (typeof en)[K] extends string ? string : (typeof en)[K];
};

/** A message key. */
export type MessageKey = keyof Catalogue;

/** The parameters a message takes, or `undefined` for plain text. */
export type MessageParams<K extends MessageKey> = Catalogue[K] extends (
  params: infer P,
  f: Formatters,
) => string
  ? P
  : undefined;

type Bound<M> = M extends (params: infer P, f: Formatters) => string
  ? (params: P) => string
  : () => string;

/** Messages of a catalogue `C`, ready to call: `m.recordings_count({ count: 3 })`. */
export type MessagesOf<C> = { readonly [K in keyof C]: Bound<C[K]> };

/** The catalogue's messages, ready to call. */
export type Messages = MessagesOf<Catalogue>;

/** Every key, in source order. */
export const messageKeys = Object.keys(en) as MessageKey[];

/** Renders one message with its parameters and formatters. */
export const render = (message: Message, params: unknown, f: Formatters): string =>
  typeof message === "string" ? message : message(params as never, f);

/**
 * Binds every key of a catalogue to a lookup that runs on each call, so the messages always
 * speak the language in effect at the moment they are called.
 */
export const bindMessages = <K extends string, C extends Readonly<Record<K, Message>>>(
  keys: readonly K[],
  resolve: () => { readonly catalogue: C; readonly f: Formatters },
): MessagesOf<C> =>
  Object.fromEntries(
    keys.map((key) => [
      key,
      (params?: unknown) => {
        const { catalogue, f } = resolve();
        return render(catalogue[key], params, f);
      },
    ]),
  ) as MessagesOf<C>;
