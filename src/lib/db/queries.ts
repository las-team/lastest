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
export * from './queries/areas';
export * from './queries/background-jobs';
export * from './queries/auth';
export * from './queries/setup';
export * from './queries/runners';
export * from './queries/integrations';
export * from './queries/csv-sources';
export * from './queries/misc';
export * from './queries/github-actions';
export * from './queries/gitlab-pipelines';
export * from './queries/analytics';
export * from './queries/fixtures';
export * from './queries/storage-states';
export * from './queries/schedules';
export * from './queries/activity-events';
export * from './queries/gamification';
export * from './queries/storage';
export * from './queries/public-shares';
export * from './queries/step-comparisons';
export * from './queries/inspector';
export * from './queries/change-maps';
export * from './queries/demo-notes';
export * from './queries/app-fixes';
export * from './queries/layer-baselines';
export * from './queries/layer-feedback';
export * from './queries/awards';
export * from './queries/launch';
