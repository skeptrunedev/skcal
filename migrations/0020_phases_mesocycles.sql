CREATE TABLE `phases` (
	`id` text PRIMARY KEY NOT NULL,
	`user_email` text NOT NULL,
	`kind` text NOT NULL,
	`start_date` text NOT NULL,
	`planned_end_date` text,
	`ended_date` text,
	`start_weight_kg` real,
	`goal_weight_kg` real,
	`rate_pct_per_week` real,
	`daily_kcal_target` integer,
	`protein_target_g` integer,
	`note` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `phases_user_idx` ON `phases` (`user_email`,`start_date`);
--> statement-breakpoint
CREATE TABLE `exercises` (
	`id` text PRIMARY KEY NOT NULL,
	`user_email` text NOT NULL,
	`name` text NOT NULL,
	`muscle` text NOT NULL,
	`equipment` text NOT NULL,
	`video_url` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `exercises_user_idx` ON `exercises` (`user_email`);
--> statement-breakpoint
CREATE TABLE `mesocycles` (
	`id` text PRIMARY KEY NOT NULL,
	`user_email` text NOT NULL,
	`name` text NOT NULL,
	`weeks` integer NOT NULL,
	`days_per_week` integer NOT NULL,
	`start_date` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`ended_date` text,
	`notes` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `mesocycles_user_idx` ON `mesocycles` (`user_email`,`status`);
--> statement-breakpoint
CREATE TABLE `meso_days` (
	`id` text PRIMARY KEY NOT NULL,
	`meso_id` text NOT NULL,
	`user_email` text NOT NULL,
	`position` integer NOT NULL,
	`label` text
);
--> statement-breakpoint
CREATE INDEX `meso_days_meso_idx` ON `meso_days` (`meso_id`);
--> statement-breakpoint
CREATE TABLE `meso_slots` (
	`id` text PRIMARY KEY NOT NULL,
	`meso_id` text NOT NULL,
	`day_id` text NOT NULL,
	`user_email` text NOT NULL,
	`position` integer NOT NULL,
	`muscle` text NOT NULL,
	`exercise_id` text NOT NULL,
	`exercise_name` text NOT NULL,
	`equipment` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `meso_slots_meso_idx` ON `meso_slots` (`meso_id`);
--> statement-breakpoint
CREATE TABLE `meso_sets` (
	`id` text PRIMARY KEY NOT NULL,
	`meso_id` text NOT NULL,
	`day_id` text NOT NULL,
	`slot_id` text NOT NULL,
	`user_email` text NOT NULL,
	`week` integer NOT NULL,
	`position` integer NOT NULL,
	`muscle` text NOT NULL,
	`exercise_name` text NOT NULL,
	`target_reps` integer,
	`target_weight_lb` real,
	`target_rir` integer,
	`weight_lb` real,
	`reps` integer,
	`logged_at` integer
);
--> statement-breakpoint
CREATE INDEX `meso_sets_meso_idx` ON `meso_sets` (`meso_id`,`week`);
--> statement-breakpoint
CREATE INDEX `meso_sets_user_idx` ON `meso_sets` (`user_email`,`logged_at`);
--> statement-breakpoint
CREATE TABLE `meso_feedback` (
	`meso_id` text NOT NULL,
	`day_id` text NOT NULL,
	`week` integer NOT NULL,
	`muscle` text NOT NULL,
	`user_email` text NOT NULL,
	`soreness` integer,
	`pump` integer,
	`joint_pain` integer,
	`workload` integer,
	PRIMARY KEY(`meso_id`, `day_id`, `week`, `muscle`)
);
--> statement-breakpoint
CREATE TABLE `meso_sessions` (
	`meso_id` text NOT NULL,
	`day_id` text NOT NULL,
	`week` integer NOT NULL,
	`user_email` text NOT NULL,
	`completed_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`workout_id` text,
	PRIMARY KEY(`meso_id`, `day_id`, `week`)
);
