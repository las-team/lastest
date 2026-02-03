-- Rename agents → runners migration
-- Renames the agents table to runners and updates the test_runs foreign key column

-- Rename agents table to runners
ALTER TABLE `agents` RENAME TO `runners`;

-- Rename the unique index (SQLite recreates indexes automatically on table rename)
DROP INDEX IF EXISTS `agents_token_hash_unique`;
CREATE UNIQUE INDEX IF NOT EXISTS `runners_token_hash_unique` ON `runners` (`token_hash`);

-- Rename agent_id to runner_id in test_runs (if column exists)
-- Note: SQLite doesn't support direct column rename in older versions,
-- but RENAME COLUMN is supported in SQLite 3.25.0+ (2018)
-- If using older SQLite, this migration will need manual adjustment
ALTER TABLE `test_runs` RENAME COLUMN `agent_id` TO `runner_id`;
