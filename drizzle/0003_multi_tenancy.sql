-- Multi-tenancy migration: Add teams table and teamId to relevant tables

-- Create teams table
CREATE TABLE IF NOT EXISTS `teams` (
  `id` text PRIMARY KEY NOT NULL,
  `name` text NOT NULL,
  `slug` text NOT NULL,
  `created_at` integer,
  `updated_at` integer
);

-- Add unique constraint on teams.slug
CREATE UNIQUE INDEX IF NOT EXISTS `teams_slug_unique` ON `teams` (`slug`);

-- Add teamId column to users (nullable for migration)
ALTER TABLE `users` ADD COLUMN `team_id` text REFERENCES `teams`(`id`);

-- Add teamId column to repositories
ALTER TABLE `repositories` ADD COLUMN `team_id` text;

-- Add teamId column to github_accounts
ALTER TABLE `github_accounts` ADD COLUMN `team_id` text;

-- Add teamId column to user_invitations
ALTER TABLE `user_invitations` ADD COLUMN `team_id` text REFERENCES `teams`(`id`);
