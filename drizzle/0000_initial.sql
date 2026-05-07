CREATE TABLE `captcha_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`site_id` integer NOT NULL,
	`visitor_id` integer NOT NULL,
	`page_thread_id` integer,
	`triggered_by` text NOT NULL,
	`mode` text NOT NULL,
	`challenge_payload_json` text,
	`verified` integer DEFAULT false NOT NULL,
	`expires_at` text NOT NULL,
	`verified_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL, `provider_kind` text, `provider_state_json` text,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`visitor_id`) REFERENCES `visitors`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`page_thread_id`) REFERENCES `page_threads`(`id`) ON UPDATE no action ON DELETE no action
);--> statement-breakpoint
CREATE INDEX `captcha_sessions_visitor_page_idx` ON `captcha_sessions` (`visitor_id`,`page_thread_id`);--> statement-breakpoint
CREATE TABLE `comments` (
	`id` text PRIMARY KEY NOT NULL,
	`site_id` integer NOT NULL,
	`page_thread_id` integer NOT NULL,
	`parent_id` text,
	`visitor_id` integer,
	`status` text DEFAULT 'pending' NOT NULL,
	`author_name` text NOT NULL,
	`author_email` text,
	`author_email_hash` text,
	`author_website` text,
	`content_raw` text NOT NULL,
	`content_html` text,
	`is_pinned` integer DEFAULT false NOT NULL,
	`is_folded` integer DEFAULT false NOT NULL,
	`reply_count` integer DEFAULT 0 NOT NULL,
	`vote_up_count` integer DEFAULT 0 NOT NULL,
	`vote_down_count` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`deleted_at` text, `author_ip` text, `author_user_agent` text, `author_ip_country` text, `author_ip_region` text, `author_ip_city` text, `author_ip_isp` text, `author_ip_location_raw` text, `author_ip_location_source` text, `author_ip_location_db_hash` text, `author_ip_location_updated_at` text, `author_ip_location_error` text, `author_device_browser` text, `author_device_os` text, `author_device_type` text, `author_device_icon` text, `author_device_source` text, `author_device_parser_version` text, `author_device_updated_at` text, `author_device_error` text,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`page_thread_id`) REFERENCES `page_threads`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`parent_id`) REFERENCES `comments`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`visitor_id`) REFERENCES `visitors`(`id`) ON UPDATE no action ON DELETE no action
);--> statement-breakpoint
CREATE INDEX `comments_thread_idx` ON `comments` (`page_thread_id`);--> statement-breakpoint
CREATE INDEX `comments_parent_idx` ON `comments` (`parent_id`);--> statement-breakpoint
CREATE INDEX `comments_visitor_idx` ON `comments` (`visitor_id`);--> statement-breakpoint
CREATE TABLE `vote_records` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`comment_id` text NOT NULL,
	`visitor_id` integer NOT NULL,
	`choice` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`comment_id`) REFERENCES `comments`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`visitor_id`) REFERENCES `visitors`(`id`) ON UPDATE no action ON DELETE no action
);--> statement-breakpoint
CREATE UNIQUE INDEX `vote_records_comment_visitor_idx` ON `vote_records` (`comment_id`,`visitor_id`);--> statement-breakpoint
CREATE INDEX `vote_records_visitor_idx` ON `vote_records` (`visitor_id`);--> statement-breakpoint
CREATE TABLE `page_feedback_records` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`page_thread_id` integer NOT NULL,
	`visitor_id` integer NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`page_thread_id`) REFERENCES `page_threads`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`visitor_id`) REFERENCES `visitors`(`id`) ON UPDATE no action ON DELETE no action
);--> statement-breakpoint
CREATE UNIQUE INDEX `page_feedback_records_thread_visitor_idx` ON `page_feedback_records` (`page_thread_id`,`visitor_id`);--> statement-breakpoint
CREATE INDEX `page_feedback_records_visitor_idx` ON `page_feedback_records` (`visitor_id`);--> statement-breakpoint
CREATE TABLE `page_view_sessions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`page_thread_id` integer NOT NULL,
	`visitor_id` integer,
	`fingerprint` text NOT NULL,
	`seen_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`page_thread_id`) REFERENCES `page_threads`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`visitor_id`) REFERENCES `visitors`(`id`) ON UPDATE no action ON DELETE no action
);--> statement-breakpoint
CREATE UNIQUE INDEX `page_view_sessions_thread_fingerprint_idx` ON `page_view_sessions` (`page_thread_id`,`fingerprint`);--> statement-breakpoint
CREATE TABLE `page_threads` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`site_id` integer NOT NULL,
	`page_key` text NOT NULL,
	`page_title` text,
	`page_url` text,
	`comment_count` integer DEFAULT 0 NOT NULL,
	`root_comment_count` integer DEFAULT 0 NOT NULL,
	`page_view_count` integer DEFAULT 0 NOT NULL,
	`page_like_count` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE no action
);--> statement-breakpoint
CREATE UNIQUE INDEX `page_threads_site_page_key_idx` ON `page_threads` (`site_id`,`page_key`);--> statement-breakpoint
CREATE INDEX `page_threads_site_id_idx` ON `page_threads` (`site_id`);--> statement-breakpoint
CREATE TABLE `admin_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`token_hash` text NOT NULL,
	`ip` text,
	`user_agent` text,
	`expires_at` text NOT NULL,
	`last_seen_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);--> statement-breakpoint
CREATE INDEX `admin_sessions_expires_at_idx` ON `admin_sessions` (`expires_at`);--> statement-breakpoint
CREATE TABLE `audit_logs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`site_id` integer,
	`actor_type` text NOT NULL,
	`actor_id` text,
	`action` text NOT NULL,
	`target_type` text,
	`target_id` text,
	`payload_json` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE no action
);--> statement-breakpoint
CREATE INDEX `audit_logs_action_idx` ON `audit_logs` (`action`);--> statement-breakpoint
CREATE TABLE `blacklist_rules` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`site_id` integer,
	`scope` text DEFAULT 'post' NOT NULL,
	`target_type` text NOT NULL,
	`target_value` text NOT NULL,
	`match_mode` text DEFAULT 'exact' NOT NULL,
	`reason` text,
	`source` text DEFAULT 'manual' NOT NULL,
	`expires_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE no action
);--> statement-breakpoint
CREATE INDEX `blacklist_rules_target_idx` ON `blacklist_rules` (`target_type`,`target_value`);--> statement-breakpoint
CREATE TABLE `site_settings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`site_id` integer NOT NULL,
	`comments_enabled` integer DEFAULT true NOT NULL,
	`default_status` text DEFAULT 'pending' NOT NULL,
	`max_depth` integer DEFAULT 3 NOT NULL,
	`root_limit` integer DEFAULT 20 NOT NULL,
	`comment_require_json` text DEFAULT '["nickname","email"]' NOT NULL,
	`allow_website` integer DEFAULT true NOT NULL,
	`allow_page_like` integer DEFAULT true NOT NULL,
	`captcha_mode` text DEFAULT 'threshold' NOT NULL,
	`captcha_threshold_window_sec` integer DEFAULT 60 NOT NULL,
	`captcha_threshold_max_actions` integer DEFAULT 3 NOT NULL,
	`abuse_guard_enabled` integer DEFAULT true NOT NULL,
	`abuse_guard_window_sec` integer DEFAULT 600 NOT NULL,
	`abuse_guard_max_write_actions` integer DEFAULT 100 NOT NULL,
	`auto_blacklist_enabled` integer DEFAULT true NOT NULL,
	`auto_blacklist_scope` text DEFAULT 'post' NOT NULL,
	`auto_blacklist_ttl_sec` integer DEFAULT 1800 NOT NULL,
	`email_notifications_enabled` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL, `comment_metadata_json` text,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE no action
);--> statement-breakpoint
CREATE UNIQUE INDEX `site_settings_site_id_idx` ON `site_settings` (`site_id`);--> statement-breakpoint
CREATE TABLE `sites` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`site_key` text NOT NULL,
	`name` text NOT NULL,
	`allowed_origins_json` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX `sites_site_key_idx` ON `sites` (`site_key`);--> statement-breakpoint
CREATE TABLE `visitors` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`site_id` integer NOT NULL,
	`visitor_key` text NOT NULL,
	`ip_hash` text,
	`user_agent_hash` text,
	`last_seen_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE no action
);--> statement-breakpoint
CREATE UNIQUE INDEX `visitors_site_visitor_key_idx` ON `visitors` (`site_id`,`visitor_key`);--> statement-breakpoint
CREATE INDEX `visitors_site_id_idx` ON `visitors` (`site_id`);--> statement-breakpoint
CREATE TABLE `system_settings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`category` text NOT NULL,
	`key` text NOT NULL,
	`value_json` text NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX `system_settings_category_key_idx` ON `system_settings` (`category`,`key`);--> statement-breakpoint
CREATE TABLE `__qingyan_upgrades` (
	`name` text PRIMARY KEY NOT NULL,
	`from_version` text,
	`to_version` text,
	`applied_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`summary_json` text NOT NULL
);--> statement-breakpoint
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
);--> statement-breakpoint
CREATE TABLE `admin_bootstrap_state` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`console_path` text NOT NULL,
	`username` text NOT NULL,
	`password_hash` text NOT NULL,
	`generated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`password_rotated_at` text
);--> statement-breakpoint
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
	`backup_json` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`applied_at` text,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE no action
);--> statement-breakpoint
CREATE INDEX `import_batches_site_status_idx` ON `import_batches` (`site_id`,`status`);--> statement-breakpoint
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
);--> statement-breakpoint
CREATE UNIQUE INDEX `import_records_site_source_key_idx` ON `import_records` (`site_id`,`source_type`,`source_key`);--> statement-breakpoint
CREATE INDEX `import_records_batch_idx` ON `import_records` (`batch_id`);
