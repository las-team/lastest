CREATE TABLE `repositories` (
	`id` text PRIMARY KEY NOT NULL,
	`github_repo_id` integer NOT NULL,
	`owner` text NOT NULL,
	`name` text NOT NULL,
	`full_name` text NOT NULL,
	`default_branch` text,
	`selected_baseline` text,
	`created_at` integer
);
--> statement-breakpoint
ALTER TABLE `baselines` ADD `repository_id` text;--> statement-breakpoint
ALTER TABLE `functional_areas` ADD `repository_id` text;--> statement-breakpoint
ALTER TABLE `github_accounts` ADD `selected_repository_id` text REFERENCES repositories(id);--> statement-breakpoint
ALTER TABLE `test_runs` ADD `repository_id` text;--> statement-breakpoint
ALTER TABLE `tests` ADD `repository_id` text;