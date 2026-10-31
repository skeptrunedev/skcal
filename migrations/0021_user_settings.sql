-- Per-user app preferences that follow the account across platforms. A missing
-- row means the defaults (mode 'full').
CREATE TABLE `user_settings` (
	`user_email` text PRIMARY KEY NOT NULL,
	`mode` text DEFAULT 'full' NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
