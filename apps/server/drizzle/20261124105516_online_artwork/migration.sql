CREATE TABLE `online_artwork` (
	`title_key` text PRIMARY KEY,
	`image_url` text,
	`looked_up_at` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `programmes` ADD `online_image_url` text;--> statement-breakpoint
ALTER TABLE `recordings` ADD `online_image_url` text;