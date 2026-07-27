ALTER TABLE `site_settings` ADD `commenter_reply_email_default_checked` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `page_threads` ADD `kind` text DEFAULT 'public' NOT NULL;
