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
    CREATE TABLE IF NOT EXISTS repositories (
      id TEXT PRIMARY KEY,
      github_repo_id INTEGER NOT NULL,
      owner TEXT NOT NULL,
      name TEXT NOT NULL,
      full_name TEXT NOT NULL,
      default_branch TEXT,
      selected_baseline TEXT,
      local_path TEXT,
      created_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS github_accounts (
      id TEXT PRIMARY KEY,
      github_user_id TEXT NOT NULL,
      github_username TEXT NOT NULL,
      access_token TEXT NOT NULL,
      refresh_token TEXT,
      token_expires_at INTEGER,
      selected_repository_id TEXT REFERENCES repositories(id),
      created_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS functional_areas (
      id TEXT PRIMARY KEY,
      repository_id TEXT,
      name TEXT NOT NULL,
      description TEXT
    );

    CREATE TABLE IF NOT EXISTS tests (
      id TEXT PRIMARY KEY,
      repository_id TEXT,
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
      repository_id TEXT,
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
      duration_ms INTEGER,
      viewport TEXT,
      browser TEXT DEFAULT 'chromium',
      console_errors TEXT,
      network_requests TEXT
    );

    CREATE TABLE IF NOT EXISTS pull_requests (
      id TEXT PRIMARY KEY,
      github_pr_number INTEGER NOT NULL,
      repo_owner TEXT NOT NULL,
      repo_name TEXT NOT NULL,
      head_branch TEXT NOT NULL,
      base_branch TEXT NOT NULL,
      head_commit TEXT NOT NULL,
      title TEXT,
      status TEXT,
      created_at INTEGER,
      updated_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS builds (
      id TEXT PRIMARY KEY,
      test_run_id TEXT REFERENCES test_runs(id),
      pull_request_id TEXT REFERENCES pull_requests(id),
      trigger_type TEXT NOT NULL,
      overall_status TEXT NOT NULL,
      total_tests INTEGER DEFAULT 0,
      changes_detected INTEGER DEFAULT 0,
      flaky_count INTEGER DEFAULT 0,
      failed_count INTEGER DEFAULT 0,
      passed_count INTEGER DEFAULT 0,
      elapsed_ms INTEGER,
      created_at INTEGER,
      completed_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS visual_diffs (
      id TEXT PRIMARY KEY,
      build_id TEXT NOT NULL REFERENCES builds(id),
      test_result_id TEXT NOT NULL REFERENCES test_results(id),
      test_id TEXT NOT NULL REFERENCES tests(id),
      baseline_image_path TEXT,
      current_image_path TEXT NOT NULL,
      diff_image_path TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      pixel_difference INTEGER DEFAULT 0,
      percentage_difference TEXT,
      metadata TEXT,
      approved_by TEXT,
      approved_at INTEGER,
      created_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS baselines (
      id TEXT PRIMARY KEY,
      repository_id TEXT,
      test_id TEXT NOT NULL REFERENCES tests(id),
      image_path TEXT NOT NULL,
      image_hash TEXT NOT NULL,
      approved_from_diff_id TEXT REFERENCES visual_diffs(id),
      branch TEXT NOT NULL,
      is_active INTEGER DEFAULT 1,
      created_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS ignore_regions (
      id TEXT PRIMARY KEY,
      test_id TEXT NOT NULL REFERENCES tests(id),
      x INTEGER NOT NULL,
      y INTEGER NOT NULL,
      width INTEGER NOT NULL,
      height INTEGER NOT NULL,
      reason TEXT,
      created_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS playwright_settings (
      id TEXT PRIMARY KEY,
      repository_id TEXT REFERENCES repositories(id),
      selector_priority TEXT,
      browser TEXT DEFAULT 'chromium',
      viewport_width INTEGER DEFAULT 1280,
      viewport_height INTEGER DEFAULT 720,
      headless INTEGER DEFAULT 0,
      navigation_timeout INTEGER DEFAULT 30000,
      action_timeout INTEGER DEFAULT 5000,
      created_at INTEGER,
      updated_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS routes (
      id TEXT PRIMARY KEY,
      repository_id TEXT REFERENCES repositories(id),
      path TEXT NOT NULL,
      type TEXT NOT NULL,
      file_path TEXT,
      framework TEXT,
      router_type TEXT,
      functional_area_id TEXT REFERENCES functional_areas(id),
      has_test INTEGER DEFAULT 0,
      scanned_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS scan_status (
      id TEXT PRIMARY KEY,
      repository_id TEXT REFERENCES repositories(id),
      status TEXT NOT NULL,
      progress INTEGER DEFAULT 0,
      routes_found INTEGER DEFAULT 0,
      framework TEXT,
      error_message TEXT,
      started_at INTEGER,
      completed_at INTEGER
    );

    CREATE INDEX IF NOT EXISTS idx_tests_functional_area ON tests(functional_area_id);
    CREATE INDEX IF NOT EXISTS idx_tests_repository ON tests(repository_id);
    CREATE INDEX IF NOT EXISTS idx_test_results_run ON test_results(test_run_id);
    CREATE INDEX IF NOT EXISTS idx_test_results_test ON test_results(test_id);
    CREATE INDEX IF NOT EXISTS idx_test_runs_branch ON test_runs(git_branch);
    CREATE INDEX IF NOT EXISTS idx_test_runs_repository ON test_runs(repository_id);
    CREATE INDEX IF NOT EXISTS idx_baselines_test ON baselines(test_id);
    CREATE INDEX IF NOT EXISTS idx_baselines_repository ON baselines(repository_id);
    CREATE INDEX IF NOT EXISTS idx_visual_diffs_build ON visual_diffs(build_id);
    CREATE INDEX IF NOT EXISTS idx_routes_repository ON routes(repository_id);
  `);

  // Run migrations for existing databases (add columns that may be missing)
  runMigrations();
}

function runMigrations() {
  // Get existing columns in repositories table
  const repoColumns = sqlite.prepare('PRAGMA table_info(repositories)').all() as { name: string }[];
  const repoColumnNames = new Set(repoColumns.map(c => c.name));

  // Migration: Add local_path to repositories if missing
  if (!repoColumnNames.has('local_path')) {
    sqlite.exec('ALTER TABLE repositories ADD COLUMN local_path TEXT');
  }
}

// Initialize on first import
initializeDatabase();
