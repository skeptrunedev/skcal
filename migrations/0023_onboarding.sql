-- Agent-led onboarding. user_settings.onboarded_at marks accounts that are
-- done with the first-run interview; every account that exists today is
-- treated as onboarded. targets.birth_year gives the agent an age for
-- Mifflin-St Jeor.
ALTER TABLE `user_settings` ADD `onboarded_at` integer;
--> statement-breakpoint
ALTER TABLE `targets` ADD `birth_year` integer;
--> statement-breakpoint
INSERT INTO `user_settings` (`user_email`, `mode`, `updated_at`, `onboarded_at`)
SELECT `email`, 'full', unixepoch() * 1000, unixepoch() * 1000 FROM `user` WHERE true
ON CONFLICT (`user_email`) DO UPDATE SET `onboarded_at` = excluded.`onboarded_at`;
