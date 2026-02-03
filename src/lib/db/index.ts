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

/**
 * @deprecated Manual schema initialization is outdated. Use `pnpm db:push` instead.
 * This function is kept for reference but should not be called.
 * After a fresh database, always run: pnpm db:push
 */
export function initializeDatabase() {
  console.warn('WARNING: initializeDatabase() is deprecated. Run `pnpm db:push` instead.');
  // Skip manual table creation - use Drizzle schema push instead
  return;
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS repositories (
      id TEXT PRIMARY KEY,
      github_repo_id INTEGER NOT NULL,
      owner TEXT NOT NULL,
      name TEXT NOT NULL,
      full_name TEXT NOT NULL,
      default_branch TEXT,
      selected_branch TEXT,
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
      screenshots TEXT,
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
      base_url TEXT,
      elapsed_ms INTEGER,
      created_at INTEGER,
      completed_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS visual_diffs (
      id TEXT PRIMARY KEY,
      build_id TEXT NOT NULL REFERENCES builds(id),
      test_result_id TEXT NOT NULL REFERENCES test_results(id),
      test_id TEXT NOT NULL REFERENCES tests(id),
      step_label TEXT,
      baseline_image_path TEXT,
      current_image_path TEXT NOT NULL,
      diff_image_path TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      pixel_difference INTEGER DEFAULT 0,
      percentage_difference TEXT,
      classification TEXT,
      metadata TEXT,
      approved_by TEXT,
      approved_at INTEGER,
      created_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS baselines (
      id TEXT PRIMARY KEY,
      repository_id TEXT,
      test_id TEXT NOT NULL REFERENCES tests(id),
      step_label TEXT,
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
      headless_mode TEXT DEFAULT 'true',
      navigation_timeout INTEGER DEFAULT 30000,
      action_timeout INTEGER DEFAULT 5000,
      pointer_gestures INTEGER DEFAULT 0,
      cursor_fps INTEGER DEFAULT 30,
      created_at INTEGER,
      updated_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS routes (
      id TEXT PRIMARY KEY,
      repository_id TEXT REFERENCES repositories(id),
      path TEXT NOT NULL,
      type TEXT NOT NULL,
      description TEXT,
      file_path TEXT,
      framework TEXT,
      router_type TEXT,
      functional_area_id TEXT REFERENCES functional_areas(id),
      has_test INTEGER DEFAULT 0,
      scanned_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS route_test_suggestions (
      id TEXT PRIMARY KEY,
      route_id TEXT REFERENCES routes(id) ON DELETE CASCADE,
      suggestion TEXT NOT NULL,
      matched_test_id TEXT REFERENCES tests(id),
      created_at INTEGER
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

    CREATE TABLE IF NOT EXISTS environment_configs (
      id TEXT PRIMARY KEY,
      repository_id TEXT REFERENCES repositories(id),
      mode TEXT NOT NULL DEFAULT 'manual',
      base_url TEXT NOT NULL DEFAULT 'http://localhost:3000',
      start_command TEXT,
      health_check_url TEXT,
      health_check_timeout INTEGER DEFAULT 60000,
      reuse_existing_server INTEGER DEFAULT 1,
      created_at INTEGER,
      updated_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS diff_sensitivity_settings (
      id TEXT PRIMARY KEY,
      repository_id TEXT REFERENCES repositories(id),
      unchanged_threshold INTEGER DEFAULT 1,
      flaky_threshold INTEGER DEFAULT 10,
      created_at INTEGER,
      updated_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS ai_settings (
      id TEXT PRIMARY KEY,
      repository_id TEXT REFERENCES repositories(id),
      provider TEXT NOT NULL DEFAULT 'claude-cli',
      openrouter_api_key TEXT,
      openrouter_model TEXT DEFAULT 'anthropic/claude-sonnet-4',
      agent_sdk_permission_mode TEXT DEFAULT 'plan',
      agent_sdk_working_dir TEXT,
      custom_instructions TEXT,
      created_at INTEGER,
      updated_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS ai_prompt_logs (
      id TEXT PRIMARY KEY,
      repository_id TEXT REFERENCES repositories(id),
      action_type TEXT NOT NULL,
      provider TEXT NOT NULL,
      model TEXT,
      system_prompt TEXT,
      user_prompt TEXT NOT NULL,
      response TEXT,
      status TEXT NOT NULL,
      error_message TEXT,
      duration_ms INTEGER,
      created_at INTEGER
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
    CREATE TABLE IF NOT EXISTS background_jobs (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      progress INTEGER DEFAULT 0,
      total_steps INTEGER,
      completed_steps INTEGER DEFAULT 0,
      label TEXT NOT NULL,
      error TEXT,
      metadata TEXT,
      repository_id TEXT REFERENCES repositories(id),
      created_at INTEGER,
      started_at INTEGER,
      completed_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS test_versions (
      id TEXT PRIMARY KEY,
      test_id TEXT NOT NULL REFERENCES tests(id) ON DELETE CASCADE,
      version INTEGER NOT NULL,
      code TEXT NOT NULL,
      name TEXT NOT NULL,
      target_url TEXT,
      change_reason TEXT,
      created_at INTEGER
    );

    CREATE INDEX IF NOT EXISTS idx_routes_repository ON routes(repository_id);
    CREATE INDEX IF NOT EXISTS idx_test_versions_test ON test_versions(test_id);
    CREATE INDEX IF NOT EXISTS idx_route_test_suggestions_route ON route_test_suggestions(route_id);
    CREATE INDEX IF NOT EXISTS idx_background_jobs_status ON background_jobs(status);

    -- Auth tables
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      hashed_password TEXT,
      name TEXT,
      avatar_url TEXT,
      role TEXT NOT NULL DEFAULT 'member',
      email_verified INTEGER DEFAULT 0,
      created_at INTEGER,
      updated_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token TEXT NOT NULL UNIQUE,
      expires_at INTEGER NOT NULL,
      ip_address TEXT,
      user_agent TEXT,
      created_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS oauth_accounts (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      provider TEXT NOT NULL,
      provider_account_id TEXT NOT NULL,
      access_token TEXT,
      refresh_token TEXT,
      token_expires_at INTEGER,
      created_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS password_reset_tokens (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token TEXT NOT NULL UNIQUE,
      expires_at INTEGER NOT NULL,
      used_at INTEGER,
      created_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS email_verification_tokens (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token TEXT NOT NULL UNIQUE,
      expires_at INTEGER NOT NULL,
      created_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS user_invitations (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      invited_by_id TEXT REFERENCES users(id),
      token TEXT NOT NULL UNIQUE,
      role TEXT NOT NULL DEFAULT 'member',
      expires_at INTEGER NOT NULL,
      accepted_at INTEGER,
      created_at INTEGER
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token);
    CREATE INDEX IF NOT EXISTS idx_oauth_accounts_user ON oauth_accounts(user_id);
    CREATE INDEX IF NOT EXISTS idx_oauth_accounts_provider ON oauth_accounts(provider, provider_account_id);
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

  // Get existing columns in visual_diffs table
  const diffColumns = sqlite.prepare('PRAGMA table_info(visual_diffs)').all() as { name: string }[];
  const diffColumnNames = new Set(diffColumns.map(c => c.name));

  // Migration: Add classification to visual_diffs if missing
  if (!diffColumnNames.has('classification')) {
    sqlite.exec('ALTER TABLE visual_diffs ADD COLUMN classification TEXT');
  }

  // Migration: Add step_label to visual_diffs if missing
  if (!diffColumnNames.has('step_label')) {
    sqlite.exec('ALTER TABLE visual_diffs ADD COLUMN step_label TEXT');
  }

  // Get existing columns in baselines table
  const baselineColumns = sqlite.prepare('PRAGMA table_info(baselines)').all() as { name: string }[];
  const baselineColumnNames = new Set(baselineColumns.map(c => c.name));

  // Migration: Add step_label to baselines if missing
  if (!baselineColumnNames.has('step_label')) {
    sqlite.exec('ALTER TABLE baselines ADD COLUMN step_label TEXT');
  }

  // Get existing columns in routes table
  const routesColumns = sqlite.prepare('PRAGMA table_info(routes)').all() as { name: string }[];
  const routesColumnNames = new Set(routesColumns.map(c => c.name));

  // Migration: Add description to routes if missing
  if (!routesColumnNames.has('description')) {
    sqlite.exec('ALTER TABLE routes ADD COLUMN description TEXT');
  }

  // Get existing columns in builds table
  const buildColumns = sqlite.prepare('PRAGMA table_info(builds)').all() as { name: string }[];
  const buildColumnNames = new Set(buildColumns.map(c => c.name));

  // Migration: Add base_url to builds if missing
  if (!buildColumnNames.has('base_url')) {
    sqlite.exec('ALTER TABLE builds ADD COLUMN base_url TEXT');
  }

  // Get existing columns in playwright_settings table
  const pwColumns = sqlite.prepare('PRAGMA table_info(playwright_settings)').all() as { name: string }[];
  const pwColumnNames = new Set(pwColumns.map(c => c.name));

  // Migration: Add pointer_gestures to playwright_settings if missing
  if (!pwColumnNames.has('pointer_gestures')) {
    sqlite.exec('ALTER TABLE playwright_settings ADD COLUMN pointer_gestures INTEGER DEFAULT 0');
  }

  // Migration: Add cursor_fps to playwright_settings if missing
  if (!pwColumnNames.has('cursor_fps')) {
    sqlite.exec('ALTER TABLE playwright_settings ADD COLUMN cursor_fps INTEGER DEFAULT 30');
  }

  // Migration: Create route_test_suggestions table if missing
  const tables = sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='route_test_suggestions'").all();
  if (tables.length === 0) {
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS route_test_suggestions (
        id TEXT PRIMARY KEY,
        route_id TEXT REFERENCES routes(id) ON DELETE CASCADE,
        suggestion TEXT NOT NULL,
        matched_test_id TEXT REFERENCES tests(id),
        created_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_route_test_suggestions_route ON route_test_suggestions(route_id);
    `);
  }

  // Migration: Add screenshots to test_results if missing
  const testResultsColumns = sqlite.prepare('PRAGMA table_info(test_results)').all() as { name: string }[];
  const testResultsColumnNames = new Set(testResultsColumns.map(c => c.name));
  if (!testResultsColumnNames.has('screenshots')) {
    sqlite.exec('ALTER TABLE test_results ADD COLUMN screenshots TEXT');
  }

  // Migration: Add headless_mode to playwright_settings (replacing headless)
  if (!pwColumnNames.has('headless_mode')) {
    sqlite.exec('ALTER TABLE playwright_settings ADD COLUMN headless_mode TEXT DEFAULT \'true\'');
  }

  // Migration: Add agent_sdk columns to ai_settings
  const aiColumns = sqlite.prepare('PRAGMA table_info(ai_settings)').all() as { name: string }[];
  const aiColumnNames = new Set(aiColumns.map(c => c.name));
  if (!aiColumnNames.has('agent_sdk_permission_mode')) {
    sqlite.exec('ALTER TABLE ai_settings ADD COLUMN agent_sdk_permission_mode TEXT DEFAULT \'plan\'');
  }
  if (!aiColumnNames.has('agent_sdk_working_dir')) {
    sqlite.exec('ALTER TABLE ai_settings ADD COLUMN agent_sdk_working_dir TEXT');
  }

  // Migration: Create test_versions table if missing
  const testVersionsTables = sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='test_versions'").all();
  if (testVersionsTables.length === 0) {
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS test_versions (
        id TEXT PRIMARY KEY,
        test_id TEXT NOT NULL REFERENCES tests(id) ON DELETE CASCADE,
        version INTEGER NOT NULL,
        code TEXT NOT NULL,
        name TEXT NOT NULL,
        target_url TEXT,
        change_reason TEXT,
        created_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_test_versions_test ON test_versions(test_id);
    `);
  }
}

// Initialize on first import
initializeDatabase();
