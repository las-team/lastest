#!/usr/bin/env node
/**
 * Database migration script for Docker deployments.
 * Runs drizzle-kit push to sync schema with PostgreSQL.
 */
const { execSync } = require('child_process');

console.log('[migrate] Running drizzle-kit push...');
try {
  execSync('./node_modules/.bin/drizzle-kit push --force 2>&1', { stdio: 'inherit' });
  console.log('[migrate] Done');
} catch (e) {
  console.error('[migrate] Failed:', e.message);
  process.exit(1);
}
