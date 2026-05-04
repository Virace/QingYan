CREATE TABLE `admin_bootstrap_state` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`console_path` text NOT NULL,
	`username` text NOT NULL,
	`password_hash` text NOT NULL,
	`generated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`password_rotated_at` text
);
