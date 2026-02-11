'use server';

import * as queries from '@/lib/db/queries';
import { requireTeamAccess, requireRepoAccess } from '@/lib/auth';
import { revalidatePath } from 'next/cache';
import type {
  AgentStepState,
  AgentStepId,
} from '@/lib/db/schema';
import { createAndRunBuild } from './builds';
import { getBuildSummary } from './builds';
import { startRemoteRouteScan } from './scanner';
import { applyTestingTemplate } from './repos';
import { discoverSpecFiles, extractUserStoriesFromFiles, generateTestsFromStories } from './spec-import';
import { testServerConnection } from './environment';
import { aiFixTest } from './ai';
import { getAISettings } from './ai-settings';
import { getEnvironmentConfig } from './environment';
import { createHash } from 'crypto';

// ============================================
// Constants
// ============================================

const STEP_DEFINITIONS: Array<{ id: AgentStepId; label: string; description: string }> = [
  { id: 'settings_check', label: 'Settings Check', description: 'Verify GitHub, AI, and environment configuration' },
  { id: 'select_repo', label: 'Select Repository', description: 'Ensure a repository is selected' },
  { id: 'scan_and_template', label: 'Scan & Template', description: 'Scan routes and apply testing template' },
  { id: 'discover', label: 'Discover Tests', description: 'Find specs and generate tests from user stories' },
  { id: 'url_check', label: 'URL Check', description: 'Verify target server is reachable' },
  { id: 'run_tests', label: 'Run Tests', description: 'Create and run initial build' },
  { id: 'fix_tests', label: 'Fix Failing Tests', description: 'AI-fix failing tests (max 3 attempts each)' },
  { id: 'rerun_tests', label: 'Re-run Tests', description: 'Re-run build after fixes' },
  { id: 'summary', label: 'Summary', description: 'Show results and pass/fail delta' },
];

const MAX_FIX_ATTEMPTS = 3;
const BUILD_POLL_INTERVAL_MS = 3000;

function buildInitialSteps(): AgentStepState[] {
  return STEP_DEFINITIONS.map((def) => ({
    id: def.id,
    status: 'pending' as const,
    label: def.label,
    description: def.description,
  }));
}

// ============================================
// Helpers
// ============================================

function hashCode(code: string): string {
  return createHash('sha256').update(code).digest('hex').slice(0, 16);
}

async function updateStep(
  sessionId: string,
  stepId: AgentStepId,
  update: Partial<AgentStepState>,
) {
  const session = await queries.getAgentSession(sessionId);
  if (!session) return;
  const steps = [...session.steps];
  const idx = steps.findIndex((s) => s.id === stepId);
  if (idx === -1) return;
  steps[idx] = { ...steps[idx], ...update };
  await queries.updateAgentSession(sessionId, {
    steps,
    currentStepId: update.status === 'active' ? stepId : session.currentStepId ?? undefined,
  });
}

async function setStepActive(sessionId: string, stepId: AgentStepId) {
  await updateStep(sessionId, stepId, {
    status: 'active',
    startedAt: new Date().toISOString(),
  });
  await queries.updateAgentSession(sessionId, { currentStepId: stepId });
}

async function setStepCompleted(sessionId: string, stepId: AgentStepId, result?: Record<string, unknown>) {
  await updateStep(sessionId, stepId, {
    status: 'completed',
    completedAt: new Date().toISOString(),
    result,
  });
}

async function setStepFailed(sessionId: string, stepId: AgentStepId, error: string) {
  await updateStep(sessionId, stepId, {
    status: 'failed',
    completedAt: new Date().toISOString(),
    error,
  });
  await queries.updateAgentSession(sessionId, { status: 'failed' });
}

async function setStepWaitingUser(sessionId: string, stepId: AgentStepId, userAction: string) {
  await updateStep(sessionId, stepId, {
    status: 'waiting_user',
    userAction,
  });
  await queries.updateAgentSession(sessionId, { status: 'paused' });
}

async function updateSubsteps(sessionId: string, stepId: AgentStepId, substeps: AgentStepState['substeps']) {
  await updateStep(sessionId, stepId, { substeps });
}

async function isCancelled(sessionId: string): Promise<boolean> {
  const session = await queries.getAgentSession(sessionId);
  return !session || session.status === 'cancelled';
}

async function waitForBuild(buildId: string): Promise<Awaited<ReturnType<typeof getBuildSummary>>> {
  for (;;) {
    const summary = await getBuildSummary(buildId);
    if (!summary) return null;
    if (summary.completedAt) return summary;
    await new Promise((r) => setTimeout(r, BUILD_POLL_INTERVAL_MS));
  }
}

// ============================================
// Step Implementations
// ============================================

async function runSettingsCheck(sessionId: string, repositoryId: string, teamId: string) {
  await setStepActive(sessionId, 'settings_check');

  const missing: string[] = [];

  // Check GitHub
  const ghAccount = await queries.getGithubAccountByTeam(teamId);
  if (!ghAccount) missing.push('GitHub account');

  // Check AI settings
  const aiSettings = await getAISettings(repositoryId);
  const hasAI = aiSettings.provider && aiSettings.provider !== 'none';
  if (!hasAI) missing.push('AI provider');

  // Check base URL
  const envConfig = await getEnvironmentConfig(repositoryId);
  if (!envConfig?.baseUrl) missing.push('Base URL');

  if (missing.length > 0) {
    await setStepWaitingUser(
      sessionId,
      'settings_check',
      `Configure: ${missing.join(', ')}. Go to Settings to set them up.`,
    );
    return false;
  }

  await setStepCompleted(sessionId, 'settings_check', {
    hasGithub: true,
    hasAI: true,
    hasBaseUrl: true,
    baseUrl: envConfig?.baseUrl,
  });
  return true;
}

async function runSelectRepo(sessionId: string, repositoryId: string) {
  await setStepActive(sessionId, 'select_repo');

  const repo = await queries.getRepository(repositoryId);
  if (!repo) {
    await setStepWaitingUser(sessionId, 'select_repo', 'Select a repository in the sidebar');
    return false;
  }

  await setStepCompleted(sessionId, 'select_repo', { repoName: repo.name, repoId: repo.id });
  return true;
}

async function runScanAndTemplate(sessionId: string, repositoryId: string) {
  await setStepActive(sessionId, 'scan_and_template');
  if (await isCancelled(sessionId)) return false;

  const repo = await queries.getRepository(repositoryId);
  if (!repo) {
    await setStepFailed(sessionId, 'scan_and_template', 'Repository not found');
    return false;
  }

  const branch = repo.selectedBranch || repo.defaultBranch || 'main';

  // Substep 1: Scan routes
  await updateSubsteps(sessionId, 'scan_and_template', [
    { label: 'Scanning routes', status: 'running' },
    { label: 'Applying template', status: 'pending' },
  ]);

  const scanResult = await startRemoteRouteScan(repositoryId, branch);
  if (!scanResult.success) {
    await updateSubsteps(sessionId, 'scan_and_template', [
      { label: 'Scanning routes', status: 'error', detail: scanResult.error },
      { label: 'Applying template', status: 'pending' },
    ]);
    await setStepFailed(sessionId, 'scan_and_template', scanResult.error || 'Scan failed');
    return false;
  }

  if (await isCancelled(sessionId)) return false;

  // Substep 2: Auto-detect template from framework
  await updateSubsteps(sessionId, 'scan_and_template', [
    { label: 'Scanning routes', status: 'done', detail: `${scanResult.routesFound} routes found` },
    { label: 'Applying template', status: 'running' },
  ]);

  // Auto-detect template based on framework
  let templateId = 'saas'; // default
  const framework = scanResult.framework?.toLowerCase() || '';
  if (framework.includes('next') || framework.includes('react')) templateId = 'saas';
  else if (framework.includes('vue') || framework.includes('nuxt')) templateId = 'spa';
  else if (framework.includes('docs') || framework.includes('docusaurus') || framework.includes('mkdocs')) templateId = 'documentation';

  // Only apply if no template currently set
  if (!repo.testingTemplate) {
    await applyTestingTemplate(repositoryId, templateId);
  }

  await updateSubsteps(sessionId, 'scan_and_template', [
    { label: 'Scanning routes', status: 'done', detail: `${scanResult.routesFound} routes found` },
    { label: 'Applying template', status: 'done', detail: templateId },
  ]);

  await setStepCompleted(sessionId, 'scan_and_template', {
    routesFound: scanResult.routesFound,
    framework: scanResult.framework,
    templateApplied: templateId,
  });
  return true;
}

async function runDiscover(sessionId: string, repositoryId: string) {
  await setStepActive(sessionId, 'discover');
  if (await isCancelled(sessionId)) return false;

  const repo = await queries.getRepository(repositoryId);
  if (!repo) {
    await setStepFailed(sessionId, 'discover', 'Repository not found');
    return false;
  }

  const branch = repo.selectedBranch || repo.defaultBranch || 'main';

  // Substep 1: Discover spec files
  await updateSubsteps(sessionId, 'discover', [
    { label: 'Finding spec files', status: 'running' },
    { label: 'Extracting user stories', status: 'pending' },
    { label: 'Generating tests', status: 'pending' },
  ]);

  const specResult = await discoverSpecFiles(repositoryId, branch);

  if (!specResult.success || !specResult.files || specResult.files.length === 0) {
    // No specs found — skip gracefully
    await updateSubsteps(sessionId, 'discover', [
      { label: 'Finding spec files', status: 'done', detail: 'No spec files found' },
      { label: 'Extracting user stories', status: 'done', detail: 'Skipped' },
      { label: 'Generating tests', status: 'done', detail: 'Skipped' },
    ]);
    await setStepCompleted(sessionId, 'discover', { skipped: true, reason: 'No spec files found' });
    return true;
  }

  if (await isCancelled(sessionId)) return false;

  // Substep 2: Extract user stories
  await updateSubsteps(sessionId, 'discover', [
    { label: 'Finding spec files', status: 'done', detail: `${specResult.files.length} files` },
    { label: 'Extracting user stories', status: 'running' },
    { label: 'Generating tests', status: 'pending' },
  ]);

  const filePaths = specResult.files.map((f) => f.path);
  const storiesResult = await extractUserStoriesFromFiles(repositoryId, branch, filePaths);

  if (!storiesResult.success || !storiesResult.stories || storiesResult.stories.length === 0) {
    await updateSubsteps(sessionId, 'discover', [
      { label: 'Finding spec files', status: 'done', detail: `${specResult.files.length} files` },
      { label: 'Extracting user stories', status: 'done', detail: 'No stories extracted' },
      { label: 'Generating tests', status: 'done', detail: 'Skipped' },
    ]);
    await setStepCompleted(sessionId, 'discover', { skipped: true, reason: 'No user stories extracted' });
    return true;
  }

  if (await isCancelled(sessionId)) return false;

  // Substep 3: Generate tests
  await updateSubsteps(sessionId, 'discover', [
    { label: 'Finding spec files', status: 'done', detail: `${specResult.files.length} files` },
    { label: 'Extracting user stories', status: 'done', detail: `${storiesResult.stories.length} stories` },
    { label: 'Generating tests', status: 'running' },
  ]);

  const envConfig = await getEnvironmentConfig(repositoryId);
  const genResult = await generateTestsFromStories(
    repositoryId,
    storiesResult.importId ?? null,
    storiesResult.stories,
    branch,
    { targetUrl: envConfig?.baseUrl || undefined },
  );

  // Update session metadata with tests created
  const session = await queries.getAgentSession(sessionId);
  if (session) {
    await queries.updateAgentSession(sessionId, {
      metadata: { ...session.metadata, testsCreated: genResult.testsCreated },
    });
  }

  await updateSubsteps(sessionId, 'discover', [
    { label: 'Finding spec files', status: 'done', detail: `${specResult.files.length} files` },
    { label: 'Extracting user stories', status: 'done', detail: `${storiesResult.stories.length} stories` },
    { label: 'Generating tests', status: 'done', detail: `${genResult.testsCreated} tests` },
  ]);

  await setStepCompleted(sessionId, 'discover', {
    specsFound: specResult.files.length,
    storiesExtracted: storiesResult.stories.length,
    testsCreated: genResult.testsCreated,
    areasCreated: genResult.areasCreated,
  });
  return true;
}

async function runUrlCheck(sessionId: string, repositoryId: string) {
  await setStepActive(sessionId, 'url_check');

  const envConfig = await getEnvironmentConfig(repositoryId);
  const baseUrl = envConfig?.baseUrl || 'http://localhost:3000';

  const result = await testServerConnection(baseUrl);
  if (!result.success) {
    await setStepWaitingUser(
      sessionId,
      'url_check',
      `Server unreachable at ${baseUrl}. Start your app and retry.`,
    );
    return false;
  }

  await setStepCompleted(sessionId, 'url_check', {
    url: baseUrl,
    statusCode: result.statusCode,
    responseTime: result.responseTime,
  });
  return true;
}

async function runTests(sessionId: string, repositoryId: string) {
  await setStepActive(sessionId, 'run_tests');
  if (await isCancelled(sessionId)) return false;

  try {
    const buildResult = await createAndRunBuild('manual', undefined, repositoryId);

    if (!buildResult.buildId) {
      await setStepFailed(sessionId, 'run_tests', 'Build was queued — please wait and retry');
      return false;
    }

    const buildId = buildResult.buildId;

    // Store build ID in metadata
    const session = await queries.getAgentSession(sessionId);
    if (session) {
      const buildIds: string[] = [...(session.metadata.buildIds || []), buildId];
      await queries.updateAgentSession(sessionId, {
        metadata: { ...session.metadata, buildIds },
      });
    }

    await updateSubsteps(sessionId, 'run_tests', [
      { label: `Running ${buildResult.testCount} tests`, status: 'running' },
    ]);

    // Wait for build to complete
    const summary = await waitForBuild(buildId);
    if (!summary) {
      await setStepFailed(sessionId, 'run_tests', 'Build not found after creation');
      return false;
    }

    if (await isCancelled(sessionId)) return false;

    // Store initial results in metadata
    const sess = await queries.getAgentSession(sessionId);
    if (sess) {
      await queries.updateAgentSession(sessionId, {
        metadata: {
          ...sess.metadata,
          initialPassedCount: summary.passedCount,
          initialFailedCount: summary.failedCount,
        },
      });
    }

    await updateSubsteps(sessionId, 'run_tests', [
      {
        label: `${summary.passedCount} passed, ${summary.failedCount} failed`,
        status: summary.failedCount > 0 ? 'error' : 'done',
      },
    ]);

    await setStepCompleted(sessionId, 'run_tests', {
      buildId,
      passedCount: summary.passedCount,
      failedCount: summary.failedCount,
      totalTests: summary.totalTests,
    });
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to run tests';
    await setStepFailed(sessionId, 'run_tests', message);
    return false;
  }
}

async function runFixTests(sessionId: string, repositoryId: string) {
  await setStepActive(sessionId, 'fix_tests');
  if (await isCancelled(sessionId)) return false;

  // Get the latest build summary
  const session = await queries.getAgentSession(sessionId);
  if (!session) return false;

  const buildIds = session.metadata.buildIds || [];
  const lastBuildId = buildIds[buildIds.length - 1];
  if (!lastBuildId) {
    await setStepFailed(sessionId, 'fix_tests', 'No build found to fix');
    return false;
  }

  const summary = await getBuildSummary(lastBuildId);
  if (!summary || summary.failedCount === 0) {
    // No failures — skip
    await setStepCompleted(sessionId, 'fix_tests', { skipped: true, reason: 'No failing tests' });
    return true;
  }

  // Get failing test results from the build's test run
  const build = await queries.getBuild(lastBuildId);
  if (!build?.testRunId) {
    await setStepCompleted(sessionId, 'fix_tests', { skipped: true, reason: 'No test run found' });
    return true;
  }

  const testResultsList = await queries.getTestResultsByRun(build.testRunId);
  const failedResults = testResultsList.filter(
    (r) => r.status === 'failed' && r.errorMessage && r.testId,
  );

  if (failedResults.length === 0) {
    await setStepCompleted(sessionId, 'fix_tests', { skipped: true, reason: 'No test errors to fix' });
    return true;
  }

  const fixAttempts: Record<string, number> = { ...session.metadata.fixAttempts };
  const codeHashes: Record<string, string[]> = { ...session.metadata.codeHashes };
  let fixedCount = 0;
  let unfixableCount = 0;

  for (let i = 0; i < failedResults.length; i++) {
    if (await isCancelled(sessionId)) return false;

    const result = failedResults[i];
    const testId = result.testId!;
    const errorMessage = result.errorMessage!;

    const attempts = fixAttempts[testId] || 0;
    if (attempts >= MAX_FIX_ATTEMPTS) {
      unfixableCount++;
      continue;
    }

    const test = await queries.getTest(testId);

    await updateSubsteps(sessionId, 'fix_tests', [
      {
        label: `Fixing test ${i + 1}/${failedResults.length}: ${test?.name || testId}`,
        status: 'running',
        detail: `Attempt ${attempts + 1}/${MAX_FIX_ATTEMPTS}`,
      },
    ]);

    const fixResult = await aiFixTest(repositoryId, testId, errorMessage);
    fixAttempts[testId] = attempts + 1;

    if (fixResult.success && fixResult.code) {
      // Check for oscillation
      const hashes = codeHashes[testId] || [];
      const newHash = hashCode(fixResult.code);

      if (hashes.includes(newHash)) {
        // Oscillation detected — mark as unfixable
        unfixableCount++;
        continue;
      }

      hashes.push(newHash);
      codeHashes[testId] = hashes;

      // Apply the fix
      await queries.updateTest(testId, { code: fixResult.code });
      if (test) {
        const versions = await queries.getTestVersions(testId);
        await queries.createTestVersion({
          testId,
          name: test.name,
          code: fixResult.code,
          version: (versions.length || 0) + 1,
          changeReason: 'ai_fix',
        });
      }
      fixedCount++;
    }

    // Update metadata periodically
    const currentSession = await queries.getAgentSession(sessionId);
    if (currentSession) {
      await queries.updateAgentSession(sessionId, {
        metadata: { ...currentSession.metadata, fixAttempts, codeHashes },
      });
    }
  }

  await updateSubsteps(sessionId, 'fix_tests', [
    {
      label: `${fixedCount} fixed, ${unfixableCount} unfixable`,
      status: fixedCount > 0 ? 'done' : unfixableCount > 0 ? 'error' : 'done',
    },
  ]);

  await setStepCompleted(sessionId, 'fix_tests', { fixedCount, unfixableCount });
  return true;
}

async function runRerunTests(sessionId: string, repositoryId: string) {
  // Check if fixes were made
  const session = await queries.getAgentSession(sessionId);
  if (!session) return false;

  const fixStep = session.steps.find((s) => s.id === 'fix_tests');
  if (fixStep?.result?.skipped || (fixStep?.result?.fixedCount === 0)) {
    // No fixes were made — skip rerun
    await updateStep(sessionId, 'rerun_tests', {
      status: 'skipped',
      completedAt: new Date().toISOString(),
    });
    return true;
  }

  await setStepActive(sessionId, 'rerun_tests');
  if (await isCancelled(sessionId)) return false;

  try {
    const buildResult = await createAndRunBuild('manual', undefined, repositoryId);

    if (!buildResult.buildId) {
      await setStepFailed(sessionId, 'rerun_tests', 'Build was queued — please wait and retry');
      return false;
    }

    const buildId = buildResult.buildId;

    const sess = await queries.getAgentSession(sessionId);
    if (sess) {
      const buildIds: string[] = [...(sess.metadata.buildIds || []), buildId];
      await queries.updateAgentSession(sessionId, {
        metadata: { ...sess.metadata, buildIds },
      });
    }

    await updateSubsteps(sessionId, 'rerun_tests', [
      { label: `Re-running ${buildResult.testCount} tests`, status: 'running' },
    ]);

    const summary = await waitForBuild(buildId);
    if (!summary) {
      await setStepFailed(sessionId, 'rerun_tests', 'Build not found');
      return false;
    }

    if (await isCancelled(sessionId)) return false;

    // Store final results
    const finalSess = await queries.getAgentSession(sessionId);
    if (finalSess) {
      await queries.updateAgentSession(sessionId, {
        metadata: {
          ...finalSess.metadata,
          finalPassedCount: summary.passedCount,
          finalFailedCount: summary.failedCount,
        },
      });
    }

    await updateSubsteps(sessionId, 'rerun_tests', [
      {
        label: `${summary.passedCount} passed, ${summary.failedCount} failed`,
        status: summary.failedCount > 0 ? 'error' : 'done',
      },
    ]);

    await setStepCompleted(sessionId, 'rerun_tests', {
      buildId,
      passedCount: summary.passedCount,
      failedCount: summary.failedCount,
    });
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to re-run tests';
    await setStepFailed(sessionId, 'rerun_tests', message);
    return false;
  }
}

async function runSummary(sessionId: string) {
  await setStepActive(sessionId, 'summary');

  const session = await queries.getAgentSession(sessionId);
  if (!session) return;

  const meta = session.metadata;
  const result: Record<string, unknown> = {
    testsCreated: meta.testsCreated || 0,
    initialPassed: meta.initialPassedCount || 0,
    initialFailed: meta.initialFailedCount || 0,
    finalPassed: meta.finalPassedCount ?? meta.initialPassedCount ?? 0,
    finalFailed: meta.finalFailedCount ?? meta.initialFailedCount ?? 0,
    buildIds: meta.buildIds || [],
    fixAttempts: meta.fixAttempts || {},
  };

  await setStepCompleted(sessionId, 'summary', result);
  await queries.updateAgentSession(sessionId, {
    status: 'completed',
    completedAt: new Date(),
  });
}

// ============================================
// Orchestrator
// ============================================

type StepRunner = (sessionId: string, repositoryId: string, teamId: string) => Promise<boolean>;

const STEP_ORDER: Array<{ id: AgentStepId; run: StepRunner }> = [
  { id: 'settings_check', run: (sid, rid, tid) => runSettingsCheck(sid, rid, tid) },
  { id: 'select_repo', run: (sid, rid) => runSelectRepo(sid, rid) },
  { id: 'scan_and_template', run: (sid, rid) => runScanAndTemplate(sid, rid) },
  { id: 'discover', run: (sid, rid) => runDiscover(sid, rid) },
  { id: 'url_check', run: (sid, rid) => runUrlCheck(sid, rid) },
  { id: 'run_tests', run: (sid, rid) => runTests(sid, rid) },
  { id: 'fix_tests', run: (sid, rid) => runFixTests(sid, rid) },
  { id: 'rerun_tests', run: (sid, rid) => runRerunTests(sid, rid) },
  {
    id: 'summary',
    run: async (sid) => {
      await runSummary(sid);
      return true;
    },
  },
];

async function executeFromStep(sessionId: string, repositoryId: string, teamId: string, startStepId: AgentStepId) {
  const startIdx = STEP_ORDER.findIndex((s) => s.id === startStepId);
  if (startIdx === -1) return;

  for (let i = startIdx; i < STEP_ORDER.length; i++) {
    if (await isCancelled(sessionId)) return;

    const step = STEP_ORDER[i];
    const success = await step.run(sessionId, repositoryId, teamId);

    if (!success) {
      // Step paused or failed — stop execution
      return;
    }
  }

  revalidatePath('/run');
}

// ============================================
// Public API
// ============================================

export async function startPlayAgent(repositoryId: string): Promise<{ sessionId: string }> {
  const { team } = await requireRepoAccess(repositoryId);

  // Cancel any existing active session for this repo
  const existing = await queries.getActiveAgentSession(repositoryId);
  if (existing) {
    await queries.updateAgentSession(existing.id, {
      status: 'cancelled',
      completedAt: new Date(),
    });
  }

  const session = await queries.createAgentSession({
    repositoryId,
    teamId: team?.id ?? null,
    status: 'active',
    currentStepId: 'settings_check',
    steps: buildInitialSteps(),
    metadata: {},
  });

  // Fire-and-forget: run steps
  executeFromStep(session.id, repositoryId, team?.id ?? '', 'settings_check').catch((err) => {
    console.error('[PlayAgent] Unhandled error:', err);
    queries.updateAgentSession(session.id, { status: 'failed' }).catch(() => {});
  });

  return { sessionId: session.id };
}

export async function resumePlayAgent(sessionId: string): Promise<{ success: boolean }> {
  await requireTeamAccess();

  const session = await queries.getAgentSession(sessionId);
  if (!session || session.status === 'cancelled' || session.status === 'completed') {
    return { success: false };
  }

  // Find the step that needs resuming
  const waitingStep = session.steps.find((s) => s.status === 'waiting_user' || s.status === 'failed');
  if (!waitingStep) return { success: false };

  // Reset step status
  await updateStep(sessionId, waitingStep.id, {
    status: 'pending',
    error: undefined,
    userAction: undefined,
  });
  await queries.updateAgentSession(sessionId, { status: 'active' });

  const { team } = await requireRepoAccess(session.repositoryId);

  // Fire-and-forget: resume from the waiting step
  executeFromStep(sessionId, session.repositoryId, team?.id ?? '', waitingStep.id).catch((err) => {
    console.error('[PlayAgent] Resume error:', err);
    queries.updateAgentSession(sessionId, { status: 'failed' }).catch(() => {});
  });

  return { success: true };
}

export async function cancelPlayAgent(sessionId: string): Promise<{ success: boolean }> {
  await requireTeamAccess();

  const session = await queries.getAgentSession(sessionId);
  if (!session) return { success: false };

  await queries.updateAgentSession(sessionId, {
    status: 'cancelled',
    completedAt: new Date(),
  });

  revalidatePath('/run');
  return { success: true };
}

export async function getPlayAgentSession(sessionId: string) {
  return queries.getAgentSession(sessionId);
}

export async function getActivePlayAgentSession(repositoryId: string) {
  return queries.getActiveAgentSession(repositoryId);
}
