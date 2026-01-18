import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema';
import path from 'path';
import fs from 'fs';

const DB_PATH = process.env.DATABASE_PATH || path.join(process.cwd(), 'lastest2.db');

// Ensure the directory exists
const dbDir = path.dirname(DB_PATH);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const sqlite = new Database(DB_PATH);
sqlite.pragma('journal_mode = WAL');

export const db = drizzle(sqlite, { schema });

export function initializeDatabase() {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS functional_areas (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT
    );

    CREATE TABLE IF NOT EXISTS tests (
      id TEXT PRIMARY KEY,
      functional_area_id TEXT REFERENCES functional_areas(id),
      name TEXT NOT NULL,
      path_type TEXT NOT NULL,
      code TEXT NOT NULL,
      target_url TEXT,
      created_at INTEGER,
      updated_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS test_runs (
      id TEXT PRIMARY KEY,
      git_branch TEXT NOT NULL,
      git_commit TEXT NOT NULL,
      started_at INTEGER,
      completed_at INTEGER,
      status TEXT
    );

    CREATE TABLE IF NOT EXISTS test_results (
      id TEXT PRIMARY KEY,
      test_run_id TEXT REFERENCES test_runs(id),
      test_id TEXT REFERENCES tests(id),
      status TEXT,
      screenshot_path TEXT,
      diff_path TEXT,
      error_message TEXT,
      duration_ms INTEGER
    );

    CREATE INDEX IF NOT EXISTS idx_tests_functional_area ON tests(functional_area_id);
    CREATE INDEX IF NOT EXISTS idx_test_results_run ON test_results(test_run_id);
    CREATE INDEX IF NOT EXISTS idx_test_results_test ON test_results(test_id);
    CREATE INDEX IF NOT EXISTS idx_test_runs_branch ON test_runs(git_branch);
  `);
}

// Initialize on first import
initializeDatabase();
