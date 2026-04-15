#!/usr/bin/env node
/**
 * Database migration script for Docker deployments.
 * Runs drizzle-kit push to sync schema with PostgreSQL.
 *
 * Pre-creates tables that drizzle-kit might confuse with renames
 * (e.g. user_consents vs suites) to avoid interactive prompts.
 */
const { execSync } = require('child_process');

// Tables drizzle-kit may wrongly interpret as renames of existing tables.
// Add CREATE TABLE IF NOT EXISTS statements here as needed.
const PRE_CREATE_SQL = `
  CREATE TABLE IF NOT EXISTS user_consents (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    consent_type TEXT NOT NULL,
    granted BOOLEAN NOT NULL,
    version TEXT NOT NULL,
    ip_address TEXT,
    user_agent TEXT,
    granted_at TIMESTAMP NOT NULL,
    revoked_at TIMESTAMP
  );
`;

async function preCreate() {
  if (!process.env.DATABASE_URL) return;
  let sql;
  try {
    sql = require('postgres')(process.env.DATABASE_URL);
    await sql.unsafe(PRE_CREATE_SQL);
    console.log('[migrate] Pre-create done');
  } catch (e) {
    console.log('[migrate] Pre-create skipped:', e.message);
  } finally {
    if (sql) await sql.end();
  }
}

async function main() {
  await preCreate();

  console.log('[migrate] Running drizzle-kit push...');
  try {
    execSync('./node_modules/.bin/drizzle-kit push --force 2>&1', { stdio: 'inherit' });
    console.log('[migrate] Done');
  } catch (e) {
    console.error('[migrate] Failed:', e.message);
    process.exit(1);
  }
}

main();
