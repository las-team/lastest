-- Agents migration: Add agents table for remote test execution
-- Note: This migration is idempotent (safe to run multiple times)

-- Create agents table
CREATE TABLE IF NOT EXISTS `agents` (
  `id` text PRIMARY KEY NOT NULL,
  `team_id` text NOT NULL REFERENCES `teams`(`id`),
  `created_by_id` text NOT NULL REFERENCES `users`(`id`),
  `name` text NOT NULL,
  `token_hash` text NOT NULL,
  `status` text DEFAULT 'offline' NOT NULL,
  `last_seen` integer,
  `capabilities` text DEFAULT '["run","record"]',
  `created_at` integer
);

-- Add unique constraint on token_hash (IF NOT EXISTS)
CREATE UNIQUE INDEX IF NOT EXISTS `agents_token_hash_unique` ON `agents` (`token_hash`);

-- Add agentId column to test_runs (nullable - null for local runs)
-- SQLite doesn't support IF NOT EXISTS for ALTER TABLE, so this needs to be run manually if missing
