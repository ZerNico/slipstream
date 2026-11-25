/**
 * The web kitchen sink's words (`/dev/kitchen-sink`), apart from the catalogue so no client
 * ships them. They follow the language in effect like `m` does.
 *
 * ```ts
 * import { ks } from "@slipstream/i18n/kitchen-sink"
 * ks.title() // "Components" or "Komponenten"
 * ```
 */
import { kitchenSink } from "../messages/kitchen-sink.ts";
import { bindMessages } from "./catalogue.ts";
import { formatters, getLocale } from "./runtime.ts";

/** The kitchen sink's messages in the language in effect at each call. */
export const ks = bindMessages(
  Object.keys(kitchenSink.en) as (keyof typeof kitchenSink.en)[],
  () => ({ catalogue: kitchenSink[getLocale()], f: formatters() }),
);
