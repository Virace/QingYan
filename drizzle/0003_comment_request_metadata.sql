ALTER TABLE `comments` ADD `author_ip` text;--> statement-breakpoint
ALTER TABLE `comments` ADD `author_user_agent` text;--> statement-breakpoint
ALTER TABLE `comments` ADD `author_ip_country` text;--> statement-breakpoint
ALTER TABLE `comments` ADD `author_ip_region` text;--> statement-breakpoint
ALTER TABLE `comments` ADD `author_ip_city` text;--> statement-breakpoint
ALTER TABLE `comments` ADD `author_ip_isp` text;--> statement-breakpoint
ALTER TABLE `comments` ADD `author_ip_location_raw` text;--> statement-breakpoint
ALTER TABLE `comments` ADD `author_ip_location_source` text;--> statement-breakpoint
ALTER TABLE `comments` ADD `author_ip_location_db_hash` text;--> statement-breakpoint
ALTER TABLE `comments` ADD `author_ip_location_updated_at` text;--> statement-breakpoint
ALTER TABLE `comments` ADD `author_ip_location_error` text;--> statement-breakpoint
ALTER TABLE `comments` ADD `author_device_browser` text;--> statement-breakpoint
ALTER TABLE `comments` ADD `author_device_os` text;--> statement-breakpoint
ALTER TABLE `comments` ADD `author_device_type` text;--> statement-breakpoint
ALTER TABLE `comments` ADD `author_device_icon` text;--> statement-breakpoint
ALTER TABLE `comments` ADD `author_device_source` text;--> statement-breakpoint
ALTER TABLE `comments` ADD `author_device_parser_version` text;--> statement-breakpoint
ALTER TABLE `comments` ADD `author_device_updated_at` text;--> statement-breakpoint
ALTER TABLE `comments` ADD `author_device_error` text;--> statement-breakpoint
CREATE TABLE `ip_region_database_state` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`ip_version` text NOT NULL,
	`file_path` text NOT NULL,
	`file_hash` text NOT NULL,
	`source_url` text,
	`cache_policy` text NOT NULL,
	`activated_at` text NOT NULL,
	`updated_at` text NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX `ip_region_database_state_version_idx` ON `ip_region_database_state` (`ip_version`);--> statement-breakpoint
CREATE TABLE `ip_region_update_runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`ip_version` text NOT NULL,
	`source_url` text,
	`status` text NOT NULL,
	`previous_hash` text,
	`next_hash` text,
	`downloaded_at` text,
	`activated_at` text,
	`refreshed_comments` integer DEFAULT 0 NOT NULL,
	`error_message` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
