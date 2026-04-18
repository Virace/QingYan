ALTER TABLE `captcha_sessions` ADD `provider_kind` text;
--> statement-breakpoint
ALTER TABLE `captcha_sessions` ADD `provider_state_json` text;
