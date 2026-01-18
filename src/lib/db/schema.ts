import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

export const functionalAreas = sqliteTable('functional_areas', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description'),
});

export const tests = sqliteTable('tests', {
  id: text('id').primaryKey(),
  functionalAreaId: text('functional_area_id').references(() => functionalAreas.id),
  name: text('name').notNull(),
  pathType: text('path_type').notNull(), // 'happy' or 'unhappy'
  code: text('code').notNull(), // Playwright test code
  targetUrl: text('target_url'),
  createdAt: integer('created_at', { mode: 'timestamp' }),
  updatedAt: integer('updated_at', { mode: 'timestamp' }),
});

export const testRuns = sqliteTable('test_runs', {
  id: text('id').primaryKey(),
  gitBranch: text('git_branch').notNull(),
  gitCommit: text('git_commit').notNull(),
  startedAt: integer('started_at', { mode: 'timestamp' }),
  completedAt: integer('completed_at', { mode: 'timestamp' }),
  status: text('status'), // 'passed', 'failed', 'running'
});

export const testResults = sqliteTable('test_results', {
  id: text('id').primaryKey(),
  testRunId: text('test_run_id').references(() => testRuns.id),
  testId: text('test_id').references(() => tests.id),
  status: text('status'), // 'passed', 'failed', 'skipped'
  screenshotPath: text('screenshot_path'),
  diffPath: text('diff_path'),
  errorMessage: text('error_message'),
  durationMs: integer('duration_ms'),
});

export type FunctionalArea = typeof functionalAreas.$inferSelect;
export type NewFunctionalArea = typeof functionalAreas.$inferInsert;
export type Test = typeof tests.$inferSelect;
export type NewTest = typeof tests.$inferInsert;
export type TestRun = typeof testRuns.$inferSelect;
export type NewTestRun = typeof testRuns.$inferInsert;
export type TestResult = typeof testResults.$inferSelect;
export type NewTestResult = typeof testResults.$inferInsert;
