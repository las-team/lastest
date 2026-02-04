/**
 * Setup System Exports
 *
 * Infrastructure for setting up target application environment before visual tests run.
 * Supports setup scripts (Playwright code) and API seeding at build, suite, and test levels.
 */

// Types
export type {
  SetupScript,
  SetupConfig,
  SetupAuthConfig,
  SetupContext,
  SetupResult,
  ApiScriptDefinition,
  SetupSource,
  ResolvedSetup,
  SetupLevel,
  SetupStatus,
  SetupInfo,
} from './types';

// Script Runner
export { runPlaywrightSetup, runTestAsSetup } from './script-runner';

// API Seeder
export { runApiSetup, validateApiScript } from './api-seeder';

// Orchestrator
export {
  SetupOrchestrator,
  getSetupOrchestrator,
  testNeedsSetup,
  getResolvedSetup,
} from './setup-orchestrator';
