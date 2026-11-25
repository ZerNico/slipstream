-- Full-text guide search (PLAN 6.4). An external-content FTS5 table over programmes, kept in
-- sync by triggers so guide imports need no extra work. `remove_diacritics 2` makes "Ubersicht"
-- find "Übersicht".
CREATE VIRTUAL TABLE `programmes_fts` USING fts5(
	title,
	subtitle,
	description,
	content='programmes',
	content_rowid='rowid',
	tokenize='unicode61 remove_diacritics 2'
);
--> statement-breakpoint
CREATE TRIGGER `programmes_fts_insert` AFTER INSERT ON `programmes` BEGIN
	INSERT INTO `programmes_fts`(rowid, title, subtitle, description)
	VALUES (new.rowid, new.title, new.subtitle, new.description);
END;
--> statement-breakpoint
CREATE TRIGGER `programmes_fts_delete` AFTER DELETE ON `programmes` BEGIN
	INSERT INTO `programmes_fts`(`programmes_fts`, rowid, title, subtitle, description)
	VALUES ('delete', old.rowid, old.title, old.subtitle, old.description);
END;
--> statement-breakpoint
CREATE TRIGGER `programmes_fts_update` AFTER UPDATE ON `programmes` BEGIN
	INSERT INTO `programmes_fts`(`programmes_fts`, rowid, title, subtitle, description)
	VALUES ('delete', old.rowid, old.title, old.subtitle, old.description);
	INSERT INTO `programmes_fts`(rowid, title, subtitle, description)
	VALUES (new.rowid, new.title, new.subtitle, new.description);
END;
