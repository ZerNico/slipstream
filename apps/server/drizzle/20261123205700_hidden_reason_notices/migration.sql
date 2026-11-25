CREATE TABLE `user_notices` (
	`user_id` text NOT NULL,
	`notice_id` text NOT NULL,
	`created_at` integer NOT NULL,
	CONSTRAINT `user_notices_pk` PRIMARY KEY(`user_id`, `notice_id`),
	CONSTRAINT `fk_user_notices_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
ALTER TABLE `recordings` ADD `hidden_reason` text;--> statement-breakpoint
-- Why already hidden rows are hidden: replaced by a repeat, else deleted while the chain runs.
UPDATE `recordings` SET `hidden_reason` = CASE WHEN `replaced_by_id` IS NOT NULL THEN 'replaced' ELSE 'deleted' END WHERE `hidden_at` IS NOT NULL;--> statement-breakpoint
-- One-time notices move from `notice:<id>:<userId>` settings rows to their own table.
INSERT OR IGNORE INTO `user_notices` (`user_id`, `notice_id`, `created_at`)
SELECT `user_id`, `notice_id`, CAST(strftime('%s', 'now') AS INTEGER) * 1000 FROM (
	SELECT
		substr(`key`, 8, instr(substr(`key`, 8), ':') - 1) AS `notice_id`,
		substr(`key`, 8 + instr(substr(`key`, 8), ':')) AS `user_id`
	FROM `settings`
	WHERE `key` LIKE 'notice:%:%'
) AS `moved`
WHERE `notice_id` <> '' AND EXISTS (SELECT 1 FROM `users` WHERE `users`.`id` = `moved`.`user_id`);--> statement-breakpoint
DELETE FROM `settings` WHERE `key` LIKE 'notice:%:%';
