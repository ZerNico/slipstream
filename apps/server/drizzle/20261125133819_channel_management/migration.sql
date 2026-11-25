ALTER TABLE `channels` ADD `removed_at` integer;--> statement-breakpoint
ALTER TABLE `channels` ADD `merged_into` text;--> statement-breakpoint
ALTER TABLE `source_streams` ADD `first_seen_at` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `source_streams` ADD `ignored_at` integer;--> statement-breakpoint
ALTER TABLE `sources` ADD `reviewed_at` integer;--> statement-breakpoint
ALTER TABLE `sources` ADD `auto_add_new` integer DEFAULT false NOT NULL;--> statement-breakpoint
-- Streams from before were first seen no later than they were last seen, and sources that
-- refreshed before count as reviewed then, so upgrading flags no stream as new.
UPDATE `source_streams` SET `first_seen_at` = `last_seen_at`;--> statement-breakpoint
UPDATE `sources` SET `reviewed_at` = `last_refresh_at`;
