import { seriesCardLine } from "@slipstream/i18n";
import type { ChannelId, Matcher } from "@slipstream/domain";

/* The plain-language lines of the series recording screens. Pure, so tests read them. */

/** A series recording's card line: its channels and, when it has some, its days. */
export const cardSummary = (
  rule: { readonly matcher: Matcher },
  channelName: (id: ChannelId) => string | undefined,
): string =>
  seriesCardLine(
    rule.matcher.channels.map((id) => channelName(id) ?? id),
    rule.matcher.weekdays,
  );
