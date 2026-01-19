CREATE TABLE `baselines` (
	`id` text PRIMARY KEY NOT NULL,
	`test_id` text NOT NULL,
	`image_path` text NOT NULL,
	`image_hash` text NOT NULL,
	`approved_from_diff_id` text,
	`branch` text NOT NULL,
	`is_active` integer DEFAULT true,
	`created_at` integer,
	FOREIGN KEY (`test_id`) REFERENCES `tests`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`approved_from_diff_id`) REFERENCES `visual_diffs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `builds` (
	`id` text PRIMARY KEY NOT NULL,
	`test_run_id` text,
	`pull_request_id` text,
	`trigger_type` text NOT NULL,
	`overall_status` text NOT NULL,
	`total_tests` integer DEFAULT 0,
	`changes_detected` integer DEFAULT 0,
	`flaky_count` integer DEFAULT 0,
	`failed_count` integer DEFAULT 0,
	`passed_count` integer DEFAULT 0,
	`elapsed_ms` integer,
	`created_at` integer,
	`completed_at` integer,
	FOREIGN KEY (`test_run_id`) REFERENCES `test_runs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`pull_request_id`) REFERENCES `pull_requests`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `functional_areas` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text
);
--> statement-breakpoint
CREATE TABLE `github_accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`github_user_id` text NOT NULL,
	`github_username` text NOT NULL,
	`access_token` text NOT NULL,
	`refresh_token` text,
	`token_expires_at` integer,
	`created_at` integer
);
--> statement-breakpoint
CREATE TABLE `ignore_regions` (
	`id` text PRIMARY KEY NOT NULL,
	`test_id` text NOT NULL,
	`x` integer NOT NULL,
	`y` integer NOT NULL,
	`width` integer NOT NULL,
	`height` integer NOT NULL,
	`reason` text,
	`created_at` integer,
	FOREIGN KEY (`test_id`) REFERENCES `tests`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `pull_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`github_pr_number` integer NOT NULL,
	`repo_owner` text NOT NULL,
	`repo_name` text NOT NULL,
	`head_branch` text NOT NULL,
	`base_branch` text NOT NULL,
	`head_commit` text NOT NULL,
	`title` text,
	`status` text,
	`created_at` integer,
	`updated_at` integer
);
--> statement-breakpoint
CREATE TABLE `test_results` (
	`id` text PRIMARY KEY NOT NULL,
	`test_run_id` text,
	`test_id` text,
	`status` text,
	`screenshot_path` text,
	`diff_path` text,
	`error_message` text,
	`duration_ms` integer,
	`viewport` text,
	`browser` text DEFAULT 'chromium',
	`console_errors` text,
	`network_requests` text,
	FOREIGN KEY (`test_run_id`) REFERENCES `test_runs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`test_id`) REFERENCES `tests`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `test_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`git_branch` text NOT NULL,
	`git_commit` text NOT NULL,
	`started_at` integer,
	`completed_at` integer,
	`status` text
);
--> statement-breakpoint
CREATE TABLE `tests` (
	`id` text PRIMARY KEY NOT NULL,
	`functional_area_id` text,
	`name` text NOT NULL,
	`path_type` text NOT NULL,
	`code` text NOT NULL,
	`target_url` text,
	`created_at` integer,
	`updated_at` integer,
	FOREIGN KEY (`functional_area_id`) REFERENCES `functional_areas`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `visual_diffs` (
	`id` text PRIMARY KEY NOT NULL,
	`build_id` text NOT NULL,
	`test_result_id` text NOT NULL,
	`test_id` text NOT NULL,
	`baseline_image_path` text,
	`current_image_path` text NOT NULL,
	`diff_image_path` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`pixel_difference` integer DEFAULT 0,
	`percentage_difference` text,
	`metadata` text,
	`approved_by` text,
	`approved_at` integer,
	`created_at` integer,
	FOREIGN KEY (`build_id`) REFERENCES `builds`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`test_result_id`) REFERENCES `test_results`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`test_id`) REFERENCES `tests`(`id`) ON UPDATE no action ON DELETE no action
);
