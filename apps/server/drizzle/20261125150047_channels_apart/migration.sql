CREATE TABLE `channels_apart` (
	`channel_a` text NOT NULL,
	`channel_b` text NOT NULL,
	`created_at` integer NOT NULL,
	CONSTRAINT `channels_apart_pk` PRIMARY KEY(`channel_a`, `channel_b`),
	CONSTRAINT `fk_channels_apart_channel_a_channels_id_fk` FOREIGN KEY (`channel_a`) REFERENCES `channels`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_channels_apart_channel_b_channels_id_fk` FOREIGN KEY (`channel_b`) REFERENCES `channels`(`id`) ON DELETE CASCADE
);
