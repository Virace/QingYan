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
	`author_user_id` integer,
	`author_identity` text DEFAULT 'visitor' NOT NULL,
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
	`deleted_at` text,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`page_thread_id`) REFERENCES `page_threads`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`parent_id`) REFERENCES `comments`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`visitor_id`) REFERENCES `visitors`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`author_user_id`) REFERENCES `admin_users`(`id`) ON UPDATE no action ON DELETE no action
);--> statement-breakpoint
CREATE INDEX `comments_thread_idx` ON `comments` (`page_thread_id`);--> statement-breakpoint
CREATE INDEX `comments_parent_idx` ON `comments` (`parent_id`);--> statement-breakpoint
CREATE INDEX `comments_visitor_idx` ON `comments` (`visitor_id`);--> statement-breakpoint
CREATE TABLE `comment_request_metadata` (
	`comment_id` text PRIMARY KEY NOT NULL,
	`author_ip` text,
	`author_user_agent` text,
	`ip_country` text,
	`ip_region` text,
	`ip_city` text,
	`ip_isp` text,
	`ip_location_raw` text,
	`ip_location_source` text,
	`ip_location_db_hash` text,
	`ip_location_updated_at` text,
	`ip_location_error` text,
	`device_browser` text,
	`device_browser_version` text,
	`device_os` text,
	`device_os_version` text,
	`device_type` text,
	`device_icon` text,
	`device_source` text,
	`device_parser_version` text,
	`device_updated_at` text,
	`device_error` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`comment_id`) REFERENCES `comments`(`id`) ON UPDATE no action ON DELETE no action
);--> statement-breakpoint
CREATE TABLE `comment_moderation` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`comment_id` text NOT NULL,
	`provider` text DEFAULT 'none' NOT NULL,
	`mode` text NOT NULL,
	`decision` text NOT NULL,
	`status` text NOT NULL,
	`reason` text,
	`akismet_verdict` text,
	`akismet_pro_tip` text,
	`akismet_recheck_after_sec` integer,
	`akismet_debug_help` text,
	`checked_at` text,
	`request_snapshot_json` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`comment_id`) REFERENCES `comments`(`id`) ON UPDATE no action ON DELETE no action
);--> statement-breakpoint
CREATE UNIQUE INDEX `comment_moderation_comment_idx` ON `comment_moderation` (`comment_id`);--> statement-breakpoint
CREATE INDEX `comment_moderation_status_idx` ON `comment_moderation` (`status`);--> statement-breakpoint
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
CREATE TABLE `site_page_registry` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`site_id` integer NOT NULL,
	`page_key` text NOT NULL,
	`page_url` text NOT NULL,
	`title` text,
	`status` text DEFAULT 'active' NOT NULL,
	`title_refresh_attempted_at` text,
	`title_refreshed_at` text,
	`title_refresh_status_code` integer,
	`title_refresh_error` text,
	`first_seen_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`last_seen_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`trashed_at` text,
	`deleted_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE no action
);--> statement-breakpoint
CREATE UNIQUE INDEX `site_page_registry_site_page_key_idx` ON `site_page_registry` (`site_id`,`page_key`);--> statement-breakpoint
CREATE INDEX `site_page_registry_site_status_idx` ON `site_page_registry` (`site_id`,`status`);--> statement-breakpoint
CREATE TABLE `site_page_registry_sources` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`site_id` integer NOT NULL,
	`source_type` text NOT NULL,
	`source_url` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`mode` text DEFAULT 'append' NOT NULL,
	`refresh_interval_sec` integer,
	`last_attempt_at` text,
	`last_success_at` text,
	`last_success_hash` text,
	`last_error` text,
	`next_refresh_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE no action
);--> statement-breakpoint
CREATE UNIQUE INDEX `site_page_registry_sources_site_url_idx` ON `site_page_registry_sources` (`site_id`,`source_url`);--> statement-breakpoint
CREATE INDEX `site_page_registry_sources_site_enabled_idx` ON `site_page_registry_sources` (`site_id`,`enabled`);--> statement-breakpoint
CREATE INDEX `site_page_registry_sources_next_refresh_idx` ON `site_page_registry_sources` (`next_refresh_at`);--> statement-breakpoint
CREATE TABLE `site_page_registry_source_pages` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source_id` integer NOT NULL,
	`page_registry_id` integer NOT NULL,
	`first_seen_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`last_seen_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`source_id`) REFERENCES `site_page_registry_sources`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`page_registry_id`) REFERENCES `site_page_registry`(`id`) ON UPDATE no action ON DELETE no action
);--> statement-breakpoint
CREATE UNIQUE INDEX `site_page_registry_source_pages_source_page_idx` ON `site_page_registry_source_pages` (`source_id`,`page_registry_id`);--> statement-breakpoint
CREATE INDEX `site_page_registry_source_pages_page_idx` ON `site_page_registry_source_pages` (`page_registry_id`);--> statement-breakpoint
CREATE TABLE `pending_page_candidates` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`site_key` text NOT NULL,
	`page_key` text NOT NULL,
	`page_url` text NOT NULL,
	`first_seen_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`last_seen_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`hit_count` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`last_reject_reason` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX `pending_page_candidates_site_page_key_idx` ON `pending_page_candidates` (`site_key`,`page_key`);--> statement-breakpoint
CREATE INDEX `pending_page_candidates_site_status_idx` ON `pending_page_candidates` (`site_key`,`status`);--> statement-breakpoint
CREATE TABLE `pending_page_view_sessions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`site_key` text NOT NULL,
	`page_key` text NOT NULL,
	`fingerprint` text NOT NULL,
	`first_seen_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`last_seen_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`hit_count` integer DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX `pending_page_view_sessions_page_fingerprint_idx` ON `pending_page_view_sessions` (`site_key`,`page_key`,`fingerprint`);--> statement-breakpoint
CREATE INDEX `pending_page_view_sessions_site_page_idx` ON `pending_page_view_sessions` (`site_key`,`page_key`);--> statement-breakpoint
CREATE TABLE `admin_users` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`username` text NOT NULL,
	`email` text NOT NULL,
	`password_hash` text NOT NULL,
	`display_name` text NOT NULL,
	`website` text,
	`avatar_url` text,
	`status` text DEFAULT 'active' NOT NULL,
	`is_initial_admin` integer DEFAULT false NOT NULL,
	`password_change_required` integer DEFAULT false NOT NULL,
	`login_blocked_until` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`password_rotated_at` text,
	`last_login_at` text,
	`deleted_at` text
);--> statement-breakpoint
CREATE UNIQUE INDEX `admin_users_username_idx` ON `admin_users` (`username`);--> statement-breakpoint
CREATE UNIQUE INDEX `admin_users_email_idx` ON `admin_users` (`email`);--> statement-breakpoint
CREATE INDEX `admin_users_status_idx` ON `admin_users` (`status`);--> statement-breakpoint
CREATE TABLE `admin_groups` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`key` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`kind` text DEFAULT 'system' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX `admin_groups_key_idx` ON `admin_groups` (`key`);--> statement-breakpoint
CREATE TABLE `admin_user_groups` (
	`user_id` integer NOT NULL,
	`group_id` integer NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`created_by_user_id` integer,
	FOREIGN KEY (`user_id`) REFERENCES `admin_users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`group_id`) REFERENCES `admin_groups`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `admin_users`(`id`) ON UPDATE no action ON DELETE no action
);--> statement-breakpoint
CREATE UNIQUE INDEX `admin_user_groups_user_idx` ON `admin_user_groups` (`user_id`);--> statement-breakpoint
CREATE INDEX `admin_user_groups_group_idx` ON `admin_user_groups` (`group_id`);--> statement-breakpoint
CREATE TABLE `admin_group_permissions` (
	`group_id` integer NOT NULL,
	`permission_key` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`created_by_user_id` integer,
	FOREIGN KEY (`group_id`) REFERENCES `admin_groups`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `admin_users`(`id`) ON UPDATE no action ON DELETE no action
);--> statement-breakpoint
CREATE UNIQUE INDEX `admin_group_permissions_group_permission_idx` ON `admin_group_permissions` (`group_id`,`permission_key`);--> statement-breakpoint
CREATE TABLE `admin_user_site_access` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`site_id` integer NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`created_by_user_id` integer,
	FOREIGN KEY (`user_id`) REFERENCES `admin_users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `admin_users`(`id`) ON UPDATE no action ON DELETE no action
);--> statement-breakpoint
CREATE UNIQUE INDEX `admin_user_site_access_user_site_idx` ON `admin_user_site_access` (`user_id`,`site_id`);--> statement-breakpoint
CREATE INDEX `admin_user_site_access_site_idx` ON `admin_user_site_access` (`site_id`);--> statement-breakpoint
CREATE TABLE `admin_profile_verification_tokens` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`purpose` text NOT NULL,
	`user_id` integer NOT NULL,
	`token_hash` text NOT NULL,
	`new_email` text,
	`pending_password_hash` text,
	`expires_at` text NOT NULL,
	`consumed_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `admin_users`(`id`) ON UPDATE no action ON DELETE no action
);--> statement-breakpoint
CREATE INDEX `admin_profile_verification_tokens_user_id_idx` ON `admin_profile_verification_tokens` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `admin_profile_verification_tokens_token_hash_idx` ON `admin_profile_verification_tokens` (`token_hash`);--> statement-breakpoint
CREATE TABLE `delayed_deletions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`resource_type` text NOT NULL,
	`resource_id` text NOT NULL,
	`site_id` integer,
	`requested_by_user_id` integer,
	`requested_at` text NOT NULL,
	`hard_delete_after` text NOT NULL,
	`restored_by_user_id` integer,
	`restored_at` text,
	`hard_deleted_at` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`metadata_json` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`requested_by_user_id`) REFERENCES `admin_users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`restored_by_user_id`) REFERENCES `admin_users`(`id`) ON UPDATE no action ON DELETE no action
);--> statement-breakpoint
CREATE INDEX `delayed_deletions_status_due_idx` ON `delayed_deletions` (`status`,`hard_delete_after`);--> statement-breakpoint
CREATE INDEX `delayed_deletions_site_id_idx` ON `delayed_deletions` (`site_id`);--> statement-breakpoint
CREATE INDEX `delayed_deletions_resource_idx` ON `delayed_deletions` (`resource_type`,`resource_id`);--> statement-breakpoint
CREATE TABLE `site_notification_recipients` (
	`id` text PRIMARY KEY NOT NULL,
	`site_id` integer NOT NULL,
	`user_id` integer NOT NULL,
	`channels_json` text DEFAULT '[]' NOT NULL,
	`events_json` text DEFAULT '[]' NOT NULL,
	`include_comment_content` text NOT NULL,
	`rate_limit_profile` text,
	`enabled` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `admin_users`(`id`) ON UPDATE no action ON DELETE no action
);--> statement-breakpoint
CREATE UNIQUE INDEX `site_notification_recipients_site_user_idx` ON `site_notification_recipients` (`site_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `site_notification_recipients_site_idx` ON `site_notification_recipients` (`site_id`);--> statement-breakpoint
CREATE INDEX `site_notification_recipients_user_idx` ON `site_notification_recipients` (`user_id`);--> statement-breakpoint
CREATE TABLE `notification_channel_configs` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`enabled` integer DEFAULT true NOT NULL,
	`config_json` text NOT NULL,
	`secret_config_json` text DEFAULT '{}' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);--> statement-breakpoint
CREATE INDEX `notification_channel_configs_type_idx` ON `notification_channel_configs` (`type`);--> statement-breakpoint
CREATE INDEX `notification_channel_configs_enabled_idx` ON `notification_channel_configs` (`enabled`);--> statement-breakpoint
CREATE TABLE `site_notification_recipient_routes` (
	`id` text PRIMARY KEY NOT NULL,
	`recipient_id` text NOT NULL,
	`event_type` text NOT NULL,
	`channel_config_id` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`recipient_id`) REFERENCES `site_notification_recipients`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`channel_config_id`) REFERENCES `notification_channel_configs`(`id`) ON UPDATE no action ON DELETE no action
);--> statement-breakpoint
CREATE INDEX `site_notification_recipient_routes_recipient_idx` ON `site_notification_recipient_routes` (`recipient_id`);--> statement-breakpoint
CREATE INDEX `site_notification_recipient_routes_config_idx` ON `site_notification_recipient_routes` (`channel_config_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `site_notification_recipient_routes_unique_idx` ON `site_notification_recipient_routes` (`recipient_id`,`event_type`,`channel_config_id`);--> statement-breakpoint
INSERT INTO `notification_channel_configs` (`id`, `type`, `name`, `description`, `enabled`, `config_json`, `secret_config_json`) VALUES ('email:default', 'email', '默认邮件', '使用系统 SMTP 设置发送邮件通知。', true, '{}', '{}');--> statement-breakpoint
CREATE TABLE `admin_user_notification_preferences` (
	`user_id` integer NOT NULL,
	`channel` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`digest_mode` text DEFAULT 'off' NOT NULL,
	`digest_interval_minutes` integer,
	`digest_times_json` text,
	`paused_until` text,
	`channel_config_ref` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `admin_users`(`id`) ON UPDATE no action ON DELETE no action
);--> statement-breakpoint
CREATE UNIQUE INDEX `admin_user_notification_preferences_user_config_idx` ON `admin_user_notification_preferences` (`user_id`,`channel_config_ref`);--> statement-breakpoint
CREATE TABLE `commenter_notification_preferences` (
	`id` text PRIMARY KEY NOT NULL,
	`site_id` integer NOT NULL,
	`email` text NOT NULL,
	`email_hash` text NOT NULL,
	`notify_on_reply` integer DEFAULT false NOT NULL,
	`unsubscribed_at` text,
	`source` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE no action
);--> statement-breakpoint
CREATE UNIQUE INDEX `commenter_notification_preferences_site_email_idx` ON `commenter_notification_preferences` (`site_id`,`email_hash`);--> statement-breakpoint
CREATE INDEX `commenter_notification_preferences_site_idx` ON `commenter_notification_preferences` (`site_id`);--> statement-breakpoint
CREATE TABLE `email_delivery_reputation` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`site_id` integer NOT NULL,
	`email` text NOT NULL,
	`email_hash` text NOT NULL,
	`failure_score` integer DEFAULT 0 NOT NULL,
	`last_failure_at` text,
	`last_success_at` text,
	`suppressed_until` text,
	`suppressed_reason` text,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE no action
);--> statement-breakpoint
CREATE UNIQUE INDEX `email_delivery_reputation_site_email_idx` ON `email_delivery_reputation` (`site_id`,`email_hash`);--> statement-breakpoint
CREATE INDEX `email_delivery_reputation_site_idx` ON `email_delivery_reputation` (`site_id`);--> statement-breakpoint
CREATE TABLE `unsubscribe_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`site_id` integer NOT NULL,
	`email_hash` text NOT NULL,
	`token_hash` text NOT NULL,
	`purpose` text NOT NULL,
	`expires_at` text,
	`consumed_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE no action
);--> statement-breakpoint
CREATE UNIQUE INDEX `unsubscribe_tokens_token_hash_idx` ON `unsubscribe_tokens` (`token_hash`);--> statement-breakpoint
CREATE INDEX `unsubscribe_tokens_site_email_idx` ON `unsubscribe_tokens` (`site_id`,`email_hash`);--> statement-breakpoint
CREATE TABLE `notification_templates` (
	`key` text PRIMARY KEY NOT NULL,
	`channel` text NOT NULL,
	`event_type` text NOT NULL,
	`format` text NOT NULL,
	`subject_template` text,
	`body_template` text NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_by_user_id` integer,
	FOREIGN KEY (`updated_by_user_id`) REFERENCES `admin_users`(`id`) ON UPDATE no action ON DELETE no action
);--> statement-breakpoint
CREATE INDEX `notification_templates_channel_event_idx` ON `notification_templates` (`channel`,`event_type`);--> statement-breakpoint
CREATE TABLE `admin_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` integer,
	`token_hash` text NOT NULL,
	`csrf_token_hash` text,
	`csrf_issued_at` text,
	`ip` text,
	`user_agent` text,
	`expires_at` text NOT NULL,
	`revoked_at` text,
	`revoked_by_user_id` integer,
	`revocation_reason` text,
	`last_seen_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `admin_users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`revoked_by_user_id`) REFERENCES `admin_users`(`id`) ON UPDATE no action ON DELETE no action
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
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL, `comment_metadata_json` text, `engagement_json` text, `verified_author_json` text, `staff_display_json` text, `moderation_json` text,
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
	`last_ip` text,
	`last_user_agent` text,
	`last_seen_page_key` text,
	`last_seen_page_url` text,
	`last_seen_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE no action
);--> statement-breakpoint
CREATE UNIQUE INDEX `visitors_site_visitor_key_idx` ON `visitors` (`site_id`,`visitor_key`);--> statement-breakpoint
CREATE INDEX `visitors_site_id_idx` ON `visitors` (`site_id`);--> statement-breakpoint
CREATE TABLE `visitor_request_metadata` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`site_id` integer NOT NULL,
	`visitor_id` integer NOT NULL,
	`ip` text,
	`ip_hash` text,
	`user_agent` text,
	`user_agent_hash` text,
	`ip_country` text,
	`ip_region` text,
	`ip_city` text,
	`ip_isp` text,
	`ip_location_raw` text,
	`ip_location_source` text,
	`ip_location_db_hash` text,
	`ip_location_updated_at` text,
	`ip_location_error` text,
	`device_browser` text,
	`device_browser_version` text,
	`device_os` text,
	`device_os_version` text,
	`device_type` text,
	`device_icon` text,
	`device_source` text,
	`device_parser_version` text,
	`device_updated_at` text,
	`device_error` text,
	`first_seen_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`last_seen_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`seen_count` integer DEFAULT 1 NOT NULL,
	`last_seen_page_key` text,
	`last_seen_page_url` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`visitor_id`) REFERENCES `visitors`(`id`) ON UPDATE no action ON DELETE no action
);--> statement-breakpoint
CREATE INDEX `visitor_request_metadata_site_id_idx` ON `visitor_request_metadata` (`site_id`);--> statement-breakpoint
CREATE INDEX `visitor_request_metadata_visitor_id_idx` ON `visitor_request_metadata` (`visitor_id`);--> statement-breakpoint
CREATE INDEX `visitor_request_metadata_last_seen_at_idx` ON `visitor_request_metadata` (`last_seen_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `visitor_request_metadata_identity_idx` ON `visitor_request_metadata` (`visitor_id`,`ip_hash`,`user_agent_hash`);--> statement-breakpoint
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
CREATE TABLE `maintenance_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`status` text NOT NULL,
	`site_key` text,
	`scope_json` text NOT NULL,
	`progress_json` text,
	`result_json` text,
	`error_json` text,
	`run_after` text,
	`attempts` integer DEFAULT 0 NOT NULL,
	`max_attempts` integer DEFAULT 1 NOT NULL,
	`retry_delay_sec` integer DEFAULT 0 NOT NULL,
	`priority` integer DEFAULT 0 NOT NULL,
	`concurrency_key` text,
	`last_heartbeat_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`started_at` text,
	`finished_at` text,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);--> statement-breakpoint
CREATE TABLE `task_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`queue_backend` text NOT NULL,
	`queue_message_id` text,
	`type` text NOT NULL,
	`category` text NOT NULL,
	`status` text NOT NULL,
	`site_id` integer,
	`site_key` text,
	`actor_type` text,
	`actor_id` text,
	`subject_type` text,
	`subject_id` text,
	`payload_summary_json` text NOT NULL,
	`payload_json` text NOT NULL,
	`progress_json` text,
	`result_json` text,
	`error_json` text,
	`idempotency_key` text,
	`run_after` text,
	`attempts` integer DEFAULT 0 NOT NULL,
	`max_attempts` integer DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`started_at` text,
	`finished_at` text,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE no action
);--> statement-breakpoint
CREATE INDEX `task_runs_status_run_after_idx` ON `task_runs` (`status`,`run_after`);--> statement-breakpoint
CREATE INDEX `task_runs_category_created_idx` ON `task_runs` (`category`,`created_at`);--> statement-breakpoint
CREATE INDEX `task_runs_site_idx` ON `task_runs` (`site_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `task_runs_idempotency_idx` ON `task_runs` (`idempotency_key`);--> statement-breakpoint
CREATE TABLE `notification_deliveries` (
	`id` text PRIMARY KEY NOT NULL,
	`task_run_id` text NOT NULL,
	`channel` text NOT NULL,
	`channel_config_ref` text,
	`channel_config_name_snapshot` text,
	`recipient_type` text NOT NULL,
	`recipient_user_id` integer,
	`recipient_address_snapshot` text NOT NULL,
	`recipient_identity_key` text NOT NULL,
	`event_family` text NOT NULL,
	`template_key` text NOT NULL,
	`status` text NOT NULL,
	`provider_message_id` text,
	`last_error_json` text,
	`sent_at` text,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`task_run_id`) REFERENCES `task_runs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`recipient_user_id`) REFERENCES `admin_users`(`id`) ON UPDATE no action ON DELETE no action
);--> statement-breakpoint
CREATE INDEX `notification_deliveries_task_run_idx` ON `notification_deliveries` (`task_run_id`);--> statement-breakpoint
CREATE INDEX `notification_deliveries_recipient_idx` ON `notification_deliveries` (`recipient_type`,`recipient_identity_key`);--> statement-breakpoint
CREATE INDEX `notification_deliveries_status_idx` ON `notification_deliveries` (`status`);--> statement-breakpoint
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
