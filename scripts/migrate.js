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

// Null out orphan FK references that would block drizzle-kit push --force
// when it re-applies FK constraints (e.g. routes / tests pointing at a
// functional_area_id that was hard-deleted before onDelete:'set null' existed).
async function nullOrphans() {
  if (!process.env.DATABASE_URL) return;
  let sql;
  try {
    sql = require('postgres')(process.env.DATABASE_URL);
    const targets = [
      { table: 'routes', col: 'functional_area_id', refTable: 'functional_areas', refCol: 'id' },
      { table: 'tests',  col: 'functional_area_id', refTable: 'functional_areas', refCol: 'id' },
    ];
    for (const t of targets) {
      try {
        const r = await sql.unsafe(`
          UPDATE "${t.table}"
          SET "${t.col}" = NULL
          WHERE "${t.col}" IS NOT NULL
            AND "${t.col}" NOT IN (SELECT "${t.refCol}" FROM "${t.refTable}")
        `);
        const c = (r && r.count) || 0;
        if (c > 0) {
          console.warn(`[migrate] nulled ${c} orphan(s) in ${t.table}.${t.col}`);
        }
      } catch (e) {
        console.warn(`[migrate] orphan-null skipped for ${t.table}.${t.col}:`, e.message);
      }
    }
  } catch (e) {
    console.log('[migrate] orphan cleanup skipped:', e.message);
  } finally {
    if (sql) await sql.end();
  }
}

// Bump pool capacity on the existing global playwright_settings row to the
// new defaults. Schema defaults only apply to fresh rows, so without this
// the old prod values (maxParallelEBs=10, ebPoolMax=30) stick forever. Uses
// GREATEST() so user-customized higher values are never reduced.
async function bumpPoolDefaults() {
  if (!process.env.DATABASE_URL) return;
  let sql;
  try {
    sql = require('postgres')(process.env.DATABASE_URL);
    const r = await sql.unsafe(`
      UPDATE "playwright_settings"
      SET "max_parallel_ebs" = GREATEST(COALESCE("max_parallel_ebs", 0), 30),
          "eb_pool_max"      = GREATEST(COALESCE("eb_pool_max", 0), 50)
      WHERE "repository_id" IS NULL
        AND (COALESCE("max_parallel_ebs", 0) < 30 OR COALESCE("eb_pool_max", 0) < 50)
    `);
    const c = (r && r.count) || 0;
    if (c > 0) {
      console.log(`[migrate] bumped pool defaults on global playwright_settings (rows=${c})`);
    }
  } catch (e) {
    console.warn('[migrate] pool default bump skipped:', e.message);
  } finally {
    if (sql) await sql.end();
  }
}

async function main() {
  await preCreate();
  await nullOrphans();
  await bumpPoolDefaults();

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
