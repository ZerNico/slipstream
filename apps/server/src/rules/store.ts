/**
 * Rule rows to domain rules.
 */
import { CollectionId, type Rule, RuleId, UserId } from "@slipstream/domain";
import { toInstant } from "../db/codec.ts";
import type { rules } from "../db/schema.ts";

/** A stored rule as the domain sees it. */
export const toRule = (row: typeof rules.$inferSelect): Rule => ({
  id: RuleId.make(row.id),
  name: row.name,
  enabled: row.enabled,
  ownerId: UserId.make(row.ownerId),
  matcher: row.matcher,
  padding: { beforeMinutes: row.paddingBeforeMinutes, afterMinutes: row.paddingAfterMinutes },
  retention: row.retention,
  ...(row.collectionId === null ? {} : { collectionId: CollectionId.make(row.collectionId) }),
  ...(row.exportTemplate === null ? {} : { exportTemplate: row.exportTemplate }),
  createdAt: toInstant(row.createdAt),
  skipRepeats: row.skipRepeats,
  offerDeclined: row.offerDeclined,
});
