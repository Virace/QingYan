CREATE TABLE `import_batches` (
	`id` text PRIMARY KEY NOT NULL,
	`site_id` integer NOT NULL,
	`source_type` text NOT NULL,
	`source_file_name` text NOT NULL,
	`source_hash` text NOT NULL,
	`format` text NOT NULL,
	`format_version` integer NOT NULL,
	`status` text NOT NULL,
	`summary_json` text NOT NULL,
	`options_json` text NOT NULL,
	`error_json` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`applied_at` text,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `import_batches_site_status_idx` ON `import_batches` (`site_id`,`status`);
--> statement-breakpoint
CREATE TABLE `import_records` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`batch_id` text NOT NULL,
	`site_id` integer NOT NULL,
	`source_type` text NOT NULL,
	`source_key` text NOT NULL,
	`source_parent_key` text,
	`target_type` text NOT NULL,
	`target_id` text NOT NULL,
	`metadata_json` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`batch_id`) REFERENCES `import_batches`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `import_records_site_source_key_idx` ON `import_records` (`site_id`,`source_type`,`source_key`);
--> statement-breakpoint
CREATE INDEX `import_records_batch_idx` ON `import_records` (`batch_id`);
