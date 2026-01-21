CREATE TABLE `playwright_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`repository_id` text,
	`selector_priority` text,
	`browser` text DEFAULT 'chromium',
	`viewport_width` integer DEFAULT 1280,
	`viewport_height` integer DEFAULT 720,
	`headless` integer DEFAULT false,
	`navigation_timeout` integer DEFAULT 30000,
	`action_timeout` integer DEFAULT 5000,
	`created_at` integer,
	`updated_at` integer,
	FOREIGN KEY (`repository_id`) REFERENCES `repositories`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `routes` (
	`id` text PRIMARY KEY NOT NULL,
	`repository_id` text,
	`path` text NOT NULL,
	`type` text NOT NULL,
	`file_path` text,
	`framework` text,
	`router_type` text,
	`functional_area_id` text,
	`has_test` integer DEFAULT false,
	`scanned_at` integer,
	FOREIGN KEY (`repository_id`) REFERENCES `repositories`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`functional_area_id`) REFERENCES `functional_areas`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `scan_status` (
	`id` text PRIMARY KEY NOT NULL,
	`repository_id` text,
	`status` text NOT NULL,
	`progress` integer DEFAULT 0,
	`routes_found` integer DEFAULT 0,
	`framework` text,
	`error_message` text,
	`started_at` integer,
	`completed_at` integer,
	FOREIGN KEY (`repository_id`) REFERENCES `repositories`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `repositories` ADD `local_path` text;