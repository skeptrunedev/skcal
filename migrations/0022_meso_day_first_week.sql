-- The first week a training day is programmed. Days planned with the
-- mesocycle start in week 1; a day added mid-mesocycle starts in the week it
-- was added, so its earlier weeks don't read as skipped sessions.
ALTER TABLE `meso_days` ADD `first_week` integer DEFAULT 1 NOT NULL;
