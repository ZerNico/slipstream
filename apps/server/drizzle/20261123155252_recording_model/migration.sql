CREATE TABLE `episode_history` (
	`id` text PRIMARY KEY,
	`user_id` text NOT NULL,
	`rule_id` text,
	`show_key` text NOT NULL,
	`season` integer,
	`episode` integer,
	`subtitle_key` text,
	`film_year` integer,
	`class` text NOT NULL,
	`aired_at` integer NOT NULL,
	`channel_id` text NOT NULL,
	`title` text NOT NULL,
	`created_at` integer NOT NULL,
	CONSTRAINT `fk_episode_history_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_episode_history_rule_id_rules_id_fk` FOREIGN KEY (`rule_id`) REFERENCES `rules`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
ALTER TABLE `collections` ADD `rule_id` text REFERENCES rules(id) ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE `recording_owners` ADD `added_by_rule_id` text REFERENCES rules(id) ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE `recordings` ADD `replaces_id` text REFERENCES recordings(id) ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE `recordings` ADD `replaced_by_id` text REFERENCES recordings(id) ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE `recordings` ADD `hidden_at` integer;--> statement-breakpoint
ALTER TABLE `recordings` ADD `rerun_outcome` text;--> statement-breakpoint
ALTER TABLE `recordings` ADD `rerun_until` integer;--> statement-breakpoint
ALTER TABLE `recordings` ADD `rerun_attempts` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `rules` ADD `skip_repeats` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `rules` ADD `offer_declined` integer DEFAULT false NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `collections_rule_unique` ON `collections` (`rule_id`);--> statement-breakpoint
CREATE INDEX `episode_history_user_show_idx` ON `episode_history` (`user_id`,`show_key`);--> statement-breakpoint
CREATE INDEX `episode_history_rule_idx` ON `episode_history` (`rule_id`);