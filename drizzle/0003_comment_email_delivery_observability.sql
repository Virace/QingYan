CREATE INDEX IF NOT EXISTS `task_runs_comment_subject_created_idx` ON `task_runs` (`category`,`subject_type`,`subject_id`,`created_at`);
