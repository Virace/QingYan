CREATE TABLE `site_notification_event_recipients` (
	`id` text PRIMARY KEY NOT NULL,
	`site_id` integer NOT NULL,
	`event_type` text NOT NULL,
	`user_id` integer NOT NULL,
	`include_comment_content` text DEFAULT 'summary' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `admin_users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `site_notification_event_recipients_unique_idx` ON `site_notification_event_recipients` (`site_id`,`event_type`,`user_id`);
--> statement-breakpoint
CREATE INDEX `site_notification_event_recipients_site_idx` ON `site_notification_event_recipients` (`site_id`);
--> statement-breakpoint
CREATE INDEX `site_notification_event_recipients_event_idx` ON `site_notification_event_recipients` (`event_type`);
--> statement-breakpoint
CREATE INDEX `site_notification_event_recipients_user_idx` ON `site_notification_event_recipients` (`user_id`);
--> statement-breakpoint
CREATE TABLE `site_notification_event_channels` (
	`id` text PRIMARY KEY NOT NULL,
	`site_id` integer NOT NULL,
	`event_type` text NOT NULL,
	`channel_config_id` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`channel_config_id`) REFERENCES `notification_channel_configs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `site_notification_event_channels_unique_idx` ON `site_notification_event_channels` (`site_id`,`event_type`,`channel_config_id`);
--> statement-breakpoint
CREATE INDEX `site_notification_event_channels_site_idx` ON `site_notification_event_channels` (`site_id`);
--> statement-breakpoint
CREATE INDEX `site_notification_event_channels_event_idx` ON `site_notification_event_channels` (`event_type`);
--> statement-breakpoint
CREATE INDEX `site_notification_event_channels_config_idx` ON `site_notification_event_channels` (`channel_config_id`);
