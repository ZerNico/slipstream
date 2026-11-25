CREATE TABLE `invites` (
	`id` text PRIMARY KEY,
	`token_hash` text NOT NULL,
	`sealed_token` text NOT NULL,
	`name` text NOT NULL,
	`access` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer,
	`used_at` integer,
	`revoked_at` integer,
	`accepted_by` text,
	CONSTRAINT `fk_invites_created_by_users_id_fk` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_invites_accepted_by_users_id_fk` FOREIGN KEY (`accepted_by`) REFERENCES `users`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
ALTER TABLE `device_codes` ADD `household` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `devices` ADD `household` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `recordings` ADD `frame_at` integer;--> statement-breakpoint
ALTER TABLE `recordings` ADD `frame_failures` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `sources` ADD `kept_for_recordings` integer;--> statement-breakpoint
ALTER TABLE `users` ADD `kind` text DEFAULT 'household' NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `avatar_tone` text DEFAULT 'amber' NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `pin_hash` text;--> statement-breakpoint
ALTER TABLE `users` ADD `access` text;--> statement-breakpoint
ALTER TABLE `users` ADD `last_seen_at` integer;--> statement-breakpoint
ALTER TABLE `users` ADD `last_seen_from` text;--> statement-breakpoint
CREATE UNIQUE INDEX `invites_token_hash_unique` ON `invites` (`token_hash`);