/**
 * The shape a translation of one message group fills: the English keys, with plain text for
 * plain text and the same parameters for messages that take them.
 */
export type Translation<Source> = {
  readonly [K in keyof Source]: Source[K] extends string ? string : Source[K];
};
