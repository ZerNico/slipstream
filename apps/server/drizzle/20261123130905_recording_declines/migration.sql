CREATE TABLE `recording_declines` (
	`recording_id` text NOT NULL,
	`user_id` text NOT NULL,
	`declined_at` integer NOT NULL,
	CONSTRAINT `recording_declines_pk` PRIMARY KEY(`recording_id`, `user_id`),
	CONSTRAINT `fk_recording_declines_recording_id_recordings_id_fk` FOREIGN KEY (`recording_id`) REFERENCES `recordings`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_recording_declines_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
-- The signing key now derives from secret.key; drop the old row that held it.
DELETE FROM `settings` WHERE `key` = 'signingKey';
