/**
 * Barrel re-export for all query modules.
 *
 * This file was the original monolithic queries file (~4300 lines).
 * It has been split into domain-focused modules under ./queries/.
 * All exports are re-exported here for backward compatibility.
 */

export * from './queries/tests';
export * from './queries/builds';
export * from './queries/visual-diffs';
export * from './queries/repositories';
export * from './queries/settings';
export * from './queries/routes';
export * from './queries/suites';
export * from './queries/background-jobs';
export * from './queries/auth';
export * from './queries/setup';
export * from './queries/runners';
export * from './queries/integrations';
export * from './queries/misc';
export * from './queries/github-actions';
export * from './queries/analytics';
export * from './queries/fixtures';
export * from './queries/storage-states';
export * from './queries/schedules';
export * from './queries/activity-events';
export * from './queries/gamification';
export * from './queries/storage';
