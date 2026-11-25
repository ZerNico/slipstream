CREATE TABLE `capture_logs` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`capture_id` text NOT NULL,
	`at` integer NOT NULL,
	`level` text NOT NULL,
	`message` text NOT NULL,
	CONSTRAINT `fk_capture_logs_capture_id_captures_id_fk` FOREIGN KEY (`capture_id`) REFERENCES `captures`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `captures` (
	`id` text PRIMARY KEY,
	`channel_id` text NOT NULL,
	`source_stream_id` text NOT NULL,
	`started_at` integer NOT NULL,
	`ended_at` integer,
	`state` text NOT NULL,
	`error` text,
	`stats` text NOT NULL,
	`stream_info` text,
	`directory` text NOT NULL,
	CONSTRAINT `fk_captures_channel_id_channels_id_fk` FOREIGN KEY (`channel_id`) REFERENCES `channels`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `channel_streams` (
	`id` text PRIMARY KEY,
	`channel_id` text NOT NULL,
	`source_stream_id` text NOT NULL,
	`priority` integer NOT NULL,
	CONSTRAINT `fk_channel_streams_channel_id_channels_id_fk` FOREIGN KEY (`channel_id`) REFERENCES `channels`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_channel_streams_source_stream_id_source_streams_id_fk` FOREIGN KEY (`source_stream_id`) REFERENCES `source_streams`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `channels` (
	`id` text PRIMARY KEY,
	`name` text NOT NULL,
	`number` integer,
	`logo_url` text,
	`guide_channel_id` text,
	`favourite` integer NOT NULL,
	`hidden` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `collections` (
	`id` text PRIMARY KEY,
	`name` text NOT NULL,
	`rank` integer NOT NULL,
	`matcher` text NOT NULL,
	`labels` text NOT NULL,
	`layout` text NOT NULL,
	`retention` text
);
--> statement-breakpoint
CREATE TABLE `device_codes` (
	`device_code_hash` text PRIMARY KEY,
	`user_code` text NOT NULL,
	`device_name` text NOT NULL,
	`device_kind` text NOT NULL,
	`status` text NOT NULL,
	`user_id` text,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`last_polled_at` integer,
	CONSTRAINT `fk_device_codes_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `devices` (
	`id` text PRIMARY KEY,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`created_at` integer NOT NULL,
	`last_seen_at` integer,
	`revoked_at` integer,
	CONSTRAINT `fk_devices_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `guide_channels` (
	`source_id` text NOT NULL,
	`xmltv_id` text NOT NULL,
	`display_name` text NOT NULL,
	`icon_url` text,
	CONSTRAINT `guide_channels_pk` PRIMARY KEY(`source_id`, `xmltv_id`),
	CONSTRAINT `fk_guide_channels_source_id_sources_id_fk` FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `playback_states` (
	`user_id` text NOT NULL,
	`target_kind` text NOT NULL,
	`target_id` text NOT NULL,
	`position_millis` integer NOT NULL,
	`watched` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT `playback_states_pk` PRIMARY KEY(`user_id`, `target_kind`, `target_id`),
	CONSTRAINT `fk_playback_states_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `programmes` (
	`rowid` integer PRIMARY KEY AUTOINCREMENT,
	`id` text NOT NULL,
	`source_id` text NOT NULL,
	`guide_channel_id` text NOT NULL,
	`start` integer NOT NULL,
	`end` integer NOT NULL,
	`title` text NOT NULL,
	`subtitle` text,
	`description` text,
	`categories` text NOT NULL,
	`episode` text,
	`original_air_date` text,
	`repeat` integer NOT NULL,
	`live` integer NOT NULL,
	`image_url` text,
	CONSTRAINT `fk_programmes_source_id_sources_id_fk` FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `recording_labels` (
	`recording_id` text NOT NULL,
	`label` text NOT NULL,
	CONSTRAINT `recording_labels_pk` PRIMARY KEY(`recording_id`, `label`),
	CONSTRAINT `fk_recording_labels_recording_id_recordings_id_fk` FOREIGN KEY (`recording_id`) REFERENCES `recordings`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `recording_owners` (
	`recording_id` text NOT NULL,
	`user_id` text NOT NULL,
	`added_at` integer NOT NULL,
	CONSTRAINT `recording_owners_pk` PRIMARY KEY(`recording_id`, `user_id`),
	CONSTRAINT `fk_recording_owners_recording_id_recordings_id_fk` FOREIGN KEY (`recording_id`) REFERENCES `recordings`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_recording_owners_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `recordings` (
	`id` text PRIMARY KEY,
	`programme_id` text,
	`channel_id` text NOT NULL,
	`start` integer NOT NULL,
	`end` integer NOT NULL,
	`title` text NOT NULL,
	`subtitle` text,
	`description` text,
	`categories` text NOT NULL,
	`episode` text,
	`original_air_date` text,
	`repeat` integer NOT NULL,
	`live` integer NOT NULL,
	`image_url` text,
	`padding_before_minutes` integer NOT NULL,
	`padding_after_minutes` integer NOT NULL,
	`state` text NOT NULL,
	`problems` text NOT NULL,
	`rule_id` text,
	`protected` integer NOT NULL,
	`pinned_collection_id` text,
	`export_status` text NOT NULL,
	`stopped_at` integer,
	`created_at` integer NOT NULL,
	CONSTRAINT `fk_recordings_channel_id_channels_id_fk` FOREIGN KEY (`channel_id`) REFERENCES `channels`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_recordings_rule_id_rules_id_fk` FOREIGN KEY (`rule_id`) REFERENCES `rules`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_recordings_pinned_collection_id_collections_id_fk` FOREIGN KEY (`pinned_collection_id`) REFERENCES `collections`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
CREATE TABLE `rules` (
	`id` text PRIMARY KEY,
	`name` text NOT NULL,
	`enabled` integer NOT NULL,
	`owner_id` text NOT NULL,
	`matcher` text NOT NULL,
	`padding_before_minutes` integer NOT NULL,
	`padding_after_minutes` integer NOT NULL,
	`retention` text NOT NULL,
	`collection_id` text,
	`export_template` text,
	`created_at` integer NOT NULL,
	CONSTRAINT `fk_rules_owner_id_users_id_fk` FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_rules_collection_id_collections_id_fk` FOREIGN KEY (`collection_id`) REFERENCES `collections`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
CREATE TABLE `segments` (
	`capture_id` text NOT NULL,
	`sequence` integer NOT NULL,
	`run_id` text NOT NULL,
	`start_ms` integer NOT NULL,
	`duration_ms` integer NOT NULL,
	`bytes` integer NOT NULL,
	`path` text NOT NULL,
	CONSTRAINT `segments_pk` PRIMARY KEY(`capture_id`, `sequence`),
	CONSTRAINT `fk_segments_capture_id_captures_id_fk` FOREIGN KEY (`capture_id`) REFERENCES `captures`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY,
	`token_hash` text NOT NULL,
	`user_id` text NOT NULL,
	`device_id` text,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL,
	CONSTRAINT `fk_sessions_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_sessions_device_id_devices_id_fk` FOREIGN KEY (`device_id`) REFERENCES `devices`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `source_streams` (
	`id` text PRIMARY KEY,
	`source_id` text NOT NULL,
	`upstream_id` text NOT NULL,
	`name` text NOT NULL,
	`url` text NOT NULL,
	`tvg_id` text,
	`logo_url` text,
	`group` text,
	`channel_number` text,
	`last_seen_at` integer NOT NULL,
	CONSTRAINT `fk_source_streams_source_id_sources_id_fk` FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `sources` (
	`id` text PRIMARY KEY,
	`name` text NOT NULL,
	`config` text NOT NULL,
	`refresh_interval_minutes` integer NOT NULL,
	`max_streams` integer,
	`user_agent` text,
	`headers` text NOT NULL,
	`guide_cleanup` text NOT NULL,
	`enabled` integer NOT NULL,
	`health` text NOT NULL,
	`last_refresh_at` integer
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY,
	`username` text NOT NULL,
	`display_name` text NOT NULL,
	`role` text NOT NULL,
	`password_hash` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `capture_logs_capture_idx` ON `capture_logs` (`capture_id`,`at`);--> statement-breakpoint
CREATE INDEX `captures_channel_idx` ON `captures` (`channel_id`,`started_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `channel_streams_unique` ON `channel_streams` (`channel_id`,`source_stream_id`);--> statement-breakpoint
CREATE INDEX `channel_streams_stream_idx` ON `channel_streams` (`source_stream_id`);--> statement-breakpoint
CREATE INDEX `channels_guide_idx` ON `channels` (`guide_channel_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `device_codes_user_code_unique` ON `device_codes` (`user_code`);--> statement-breakpoint
CREATE INDEX `devices_user_idx` ON `devices` (`user_id`);--> statement-breakpoint
CREATE INDEX `playback_states_updated_idx` ON `playback_states` (`user_id`,`updated_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `programmes_id_unique` ON `programmes` (`id`);--> statement-breakpoint
CREATE INDEX `programmes_channel_time_idx` ON `programmes` (`guide_channel_id`,`start`);--> statement-breakpoint
CREATE INDEX `programmes_source_idx` ON `programmes` (`source_id`);--> statement-breakpoint
CREATE INDEX `programmes_end_idx` ON `programmes` (`end`);--> statement-breakpoint
CREATE INDEX `recording_labels_label_idx` ON `recording_labels` (`label`);--> statement-breakpoint
CREATE INDEX `recording_owners_user_idx` ON `recording_owners` (`user_id`);--> statement-breakpoint
CREATE INDEX `recordings_channel_time_idx` ON `recordings` (`channel_id`,`start`);--> statement-breakpoint
CREATE INDEX `recordings_state_idx` ON `recordings` (`state`);--> statement-breakpoint
CREATE INDEX `recordings_programme_idx` ON `recordings` (`programme_id`);--> statement-breakpoint
CREATE INDEX `rules_owner_idx` ON `rules` (`owner_id`);--> statement-breakpoint
CREATE INDEX `segments_capture_start_idx` ON `segments` (`capture_id`,`start_ms`);--> statement-breakpoint
CREATE UNIQUE INDEX `sessions_token_hash_unique` ON `sessions` (`token_hash`);--> statement-breakpoint
CREATE INDEX `sessions_user_idx` ON `sessions` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `source_streams_upstream_unique` ON `source_streams` (`source_id`,`upstream_id`);--> statement-breakpoint
CREATE INDEX `source_streams_tvg_idx` ON `source_streams` (`tvg_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `users_username_unique` ON `users` (`username`);