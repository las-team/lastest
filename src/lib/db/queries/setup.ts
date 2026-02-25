import { db } from '../index';
import {
  setupScripts,
  setupConfigs,
  defaultSetupSteps,
  defaultTeardownSteps,
  tests,
  suites,
  repositories,
} from '../schema';
import type {
  NewSetupScript,
  NewSetupConfig,
  NewDefaultSetupStep,
  NewDefaultTeardownStep,
  SetupScriptType,
  TestSetupOverrides,
  TestTeardownOverrides,
  StabilizationSettings,
} from '../schema';
import { getTest } from './tests';
import { getRepository } from './repositories';
import { getSuite } from './suites';
import { eq, desc, and, isNull } from 'drizzle-orm';
import { v4 as uuid } from 'uuid';

// ============================================
// Setup Scripts
// ============================================

export async function getSetupScripts(repositoryId: string) {
  return db
    .select()
    .from(setupScripts)
    .where(eq(setupScripts.repositoryId, repositoryId))
    .orderBy(desc(setupScripts.createdAt))
    .all();
}

export async function getSetupScript(id: string) {
  return db.select().from(setupScripts).where(eq(setupScripts.id, id)).get();
}

export async function createSetupScript(data: Omit<NewSetupScript, 'id' | 'createdAt' | 'updatedAt'>) {
  const id = uuid();
  const now = new Date();
  await db.insert(setupScripts).values({
    ...data,
    id,
    createdAt: now,
    updatedAt: now,
  });
  return { id, ...data, createdAt: now, updatedAt: now };
}

export async function updateSetupScript(id: string, data: Partial<NewSetupScript>) {
  await db.update(setupScripts).set({ ...data, updatedAt: new Date() }).where(eq(setupScripts.id, id));
}

export async function deleteSetupScript(id: string) {
  await db.delete(setupScripts).where(eq(setupScripts.id, id));
}

export async function duplicateSetupScript(id: string) {
  const original = await getSetupScript(id);
  if (!original) return null;

  return createSetupScript({
    repositoryId: original.repositoryId ?? undefined,
    name: `${original.name} (Copy)`,
    type: original.type as SetupScriptType,
    code: original.code,
    description: original.description ?? undefined,
  });
}

// ============================================
// Setup Configs (API seeding configuration)
// ============================================

export async function getSetupConfigs(repositoryId: string) {
  return db
    .select()
    .from(setupConfigs)
    .where(eq(setupConfigs.repositoryId, repositoryId))
    .orderBy(desc(setupConfigs.createdAt))
    .all();
}

export async function getSetupConfig(id: string) {
  return db.select().from(setupConfigs).where(eq(setupConfigs.id, id)).get();
}

export async function createSetupConfig(data: Omit<NewSetupConfig, 'id' | 'createdAt' | 'updatedAt'>) {
  const id = uuid();
  const now = new Date();
  await db.insert(setupConfigs).values({
    ...data,
    id,
    createdAt: now,
    updatedAt: now,
  });
  return { id, ...data, createdAt: now, updatedAt: now };
}

export async function updateSetupConfig(id: string, data: Partial<NewSetupConfig>) {
  await db.update(setupConfigs).set({ ...data, updatedAt: new Date() }).where(eq(setupConfigs.id, id));
}

export async function deleteSetupConfig(id: string) {
  await db.delete(setupConfigs).where(eq(setupConfigs.id, id));
}

// ============================================
// Setup-related test/suite/build/repo queries
// ============================================

// Get test with its setup configuration resolved
export async function getTestWithSetup(testId: string) {
  const test = await getTest(testId);
  if (!test) return null;

  let setupTest = null;
  let setupScript = null;

  // Test's own setup takes precedence
  if (test.setupTestId) {
    setupTest = await getTest(test.setupTestId);
  } else if (test.setupScriptId) {
    setupScript = await getSetupScript(test.setupScriptId);
  } else if (test.repositoryId) {
    // Fall back to repository default
    const repo = await getRepository(test.repositoryId);
    if (repo?.defaultSetupTestId) {
      setupTest = await getTest(repo.defaultSetupTestId);
    } else if (repo?.defaultSetupScriptId) {
      setupScript = await getSetupScript(repo.defaultSetupScriptId);
    }
  }

  return { ...test, setupTest, setupScript };
}

// Get suite with its setup configuration
export async function getSuiteWithSetup(suiteId: string) {
  const suite = await getSuite(suiteId);
  if (!suite) return null;

  let setupTest = null;
  let setupScript = null;

  if (suite.setupTestId) {
    setupTest = await getTest(suite.setupTestId);
  } else if (suite.setupScriptId) {
    setupScript = await getSetupScript(suite.setupScriptId);
  }

  return { ...suite, setupTest, setupScript };
}

// Update test setup configuration
export async function updateTestSetup(testId: string, setupTestId: string | null, setupScriptId: string | null) {
  await db.update(tests).set({
    setupTestId,
    setupScriptId,
    updatedAt: new Date(),
  }).where(eq(tests.id, testId));
}

// Update suite setup configuration
export async function updateSuiteSetup(suiteId: string, setupTestId: string | null, setupScriptId: string | null) {
  await db.update(suites).set({
    setupTestId,
    setupScriptId,
    updatedAt: new Date(),
  }).where(eq(suites.id, suiteId));
}

// Update repository default setup configuration
export async function updateRepositoryDefaultSetup(
  repositoryId: string,
  defaultSetupTestId: string | null,
  defaultSetupScriptId: string | null
) {
  await db.update(repositories).set({
    defaultSetupTestId,
    defaultSetupScriptId,
  }).where(eq(repositories.id, repositoryId));
}

// Get tests that use a specific test as their setup
export async function getTestsUsingSetupTest(setupTestId: string) {
  return db
    .select()
    .from(tests)
    .where(and(eq(tests.setupTestId, setupTestId), isNull(tests.deletedAt)))
    .all();
}

// Get tests that use a specific setup script
export async function getTestsUsingSetupScript(setupScriptId: string) {
  return db
    .select()
    .from(tests)
    .where(and(eq(tests.setupScriptId, setupScriptId), isNull(tests.deletedAt)))
    .all();
}

// Get suites that use a specific test as their setup
export async function getSuitesUsingSetupTest(setupTestId: string) {
  return db
    .select()
    .from(suites)
    .where(eq(suites.setupTestId, setupTestId))
    .all();
}

// Get suites that use a specific setup script
export async function getSuitesUsingSetupScript(setupScriptId: string) {
  return db
    .select()
    .from(suites)
    .where(eq(suites.setupScriptId, setupScriptId))
    .all();
}

// ============================================
// Default Setup Steps (multi-step setup)
// ============================================

export async function getDefaultSetupSteps(repositoryId: string) {
  return db
    .select({
      id: defaultSetupSteps.id,
      repositoryId: defaultSetupSteps.repositoryId,
      stepType: defaultSetupSteps.stepType,
      testId: defaultSetupSteps.testId,
      scriptId: defaultSetupSteps.scriptId,
      orderIndex: defaultSetupSteps.orderIndex,
      createdAt: defaultSetupSteps.createdAt,
      // Join test name
      testName: tests.name,
      // Join script name
      scriptName: setupScripts.name,
    })
    .from(defaultSetupSteps)
    .leftJoin(tests, eq(defaultSetupSteps.testId, tests.id))
    .leftJoin(setupScripts, eq(defaultSetupSteps.scriptId, setupScripts.id))
    .where(eq(defaultSetupSteps.repositoryId, repositoryId))
    .orderBy(defaultSetupSteps.orderIndex)
    .all();
}

export async function createDefaultSetupStep(data: Omit<NewDefaultSetupStep, 'id' | 'createdAt'>) {
  const id = uuid();
  await db.insert(defaultSetupSteps).values({
    ...data,
    id,
    createdAt: new Date(),
  });
  return { id, ...data, createdAt: new Date() };
}

export async function deleteDefaultSetupStep(id: string) {
  await db.delete(defaultSetupSteps).where(eq(defaultSetupSteps.id, id));
}

export async function deleteAllDefaultSetupSteps(repositoryId: string) {
  await db.delete(defaultSetupSteps).where(eq(defaultSetupSteps.repositoryId, repositoryId));
}

export async function updateDefaultSetupStepOrder(id: string, orderIndex: number) {
  await db.update(defaultSetupSteps).set({ orderIndex }).where(eq(defaultSetupSteps.id, id));
}

export async function replaceDefaultSetupSteps(
  repositoryId: string,
  steps: Array<{ stepType: 'test' | 'script'; testId?: string | null; scriptId?: string | null }>
) {
  // Delete all existing steps
  await deleteAllDefaultSetupSteps(repositoryId);

  // Insert new steps with order
  const results = [];
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const result = await createDefaultSetupStep({
      repositoryId,
      stepType: step.stepType,
      testId: step.testId ?? null,
      scriptId: step.scriptId ?? null,
      orderIndex: i,
    });
    results.push(result);
  }

  return results;
}

// ============================================
// Per-Test Setup Overrides
// ============================================

export async function updateTestSetupOverrides(testId: string, overrides: TestSetupOverrides | null) {
  await db.update(tests).set({ setupOverrides: overrides, updatedAt: new Date() }).where(eq(tests.id, testId));
}

export async function getResolvedSetupStepsForTest(test: { id: string; repositoryId: string | null; setupOverrides: TestSetupOverrides | null }) {
  if (!test.repositoryId) return [];

  const defaults = await getDefaultSetupSteps(test.repositoryId);
  const overrides = test.setupOverrides;

  // Filter out skipped defaults
  const skippedIds = new Set(overrides?.skippedDefaultStepIds ?? []);
  const activeDefaults = defaults
    .filter((s) => !skippedIds.has(s.id))
    .map((s) => ({
      source: 'default' as const,
      id: s.id,
      stepType: s.stepType as 'test' | 'script',
      testId: s.testId,
      scriptId: s.scriptId,
      name: s.testName || s.scriptName || 'Unknown',
    }));

  // Resolve extra steps names
  const extras: Array<{
    source: 'extra';
    id: string;
    stepType: 'test' | 'script';
    testId: string | null | undefined;
    scriptId: string | null | undefined;
    name: string;
  }> = [];

  if (overrides?.extraSteps) {
    for (let i = 0; i < overrides.extraSteps.length; i++) {
      const step = overrides.extraSteps[i];
      let name = 'Unknown';
      if (step.stepType === 'test' && step.testId) {
        const t = await getTest(step.testId);
        name = t?.name || 'Deleted test';
      } else if (step.stepType === 'script' && step.scriptId) {
        const s = await getSetupScript(step.scriptId);
        name = s?.name || 'Deleted script';
      }
      extras.push({
        source: 'extra',
        id: `extra-${i}`,
        stepType: step.stepType,
        testId: step.testId,
        scriptId: step.scriptId,
        name,
      });
    }
  }

  return [...activeDefaults, ...extras];
}

// ============================================
// Default Teardown Steps (multi-step teardown)
// ============================================

export async function getDefaultTeardownSteps(repositoryId: string) {
  return db
    .select({
      id: defaultTeardownSteps.id,
      repositoryId: defaultTeardownSteps.repositoryId,
      stepType: defaultTeardownSteps.stepType,
      testId: defaultTeardownSteps.testId,
      scriptId: defaultTeardownSteps.scriptId,
      orderIndex: defaultTeardownSteps.orderIndex,
      createdAt: defaultTeardownSteps.createdAt,
      testName: tests.name,
      scriptName: setupScripts.name,
    })
    .from(defaultTeardownSteps)
    .leftJoin(tests, eq(defaultTeardownSteps.testId, tests.id))
    .leftJoin(setupScripts, eq(defaultTeardownSteps.scriptId, setupScripts.id))
    .where(eq(defaultTeardownSteps.repositoryId, repositoryId))
    .orderBy(defaultTeardownSteps.orderIndex)
    .all();
}

export async function createDefaultTeardownStep(data: Omit<NewDefaultTeardownStep, 'id' | 'createdAt'>) {
  const id = uuid();
  await db.insert(defaultTeardownSteps).values({
    ...data,
    id,
    createdAt: new Date(),
  });
  return { id, ...data, createdAt: new Date() };
}

export async function deleteDefaultTeardownStep(id: string) {
  await db.delete(defaultTeardownSteps).where(eq(defaultTeardownSteps.id, id));
}

export async function deleteAllDefaultTeardownSteps(repositoryId: string) {
  await db.delete(defaultTeardownSteps).where(eq(defaultTeardownSteps.repositoryId, repositoryId));
}

export async function updateDefaultTeardownStepOrder(id: string, orderIndex: number) {
  await db.update(defaultTeardownSteps).set({ orderIndex }).where(eq(defaultTeardownSteps.id, id));
}

export async function replaceDefaultTeardownSteps(
  repositoryId: string,
  steps: Array<{ stepType: 'test' | 'script'; testId?: string | null; scriptId?: string | null }>
) {
  await deleteAllDefaultTeardownSteps(repositoryId);
  const results = [];
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const result = await createDefaultTeardownStep({
      repositoryId,
      stepType: step.stepType,
      testId: step.testId ?? null,
      scriptId: step.scriptId ?? null,
      orderIndex: i,
    });
    results.push(result);
  }
  return results;
}

// ============================================
// Per-Test Teardown Overrides
// ============================================

export async function updateTestTeardownOverrides(testId: string, overrides: TestTeardownOverrides | null) {
  await db.update(tests).set({ teardownOverrides: overrides, updatedAt: new Date() }).where(eq(tests.id, testId));
}

export async function getResolvedTeardownStepsForTest(test: { id: string; repositoryId: string | null; teardownOverrides: TestTeardownOverrides | null }) {
  if (!test.repositoryId) return [];

  const defaults = await getDefaultTeardownSteps(test.repositoryId);
  const overrides = test.teardownOverrides;

  const skippedIds = new Set(overrides?.skippedDefaultStepIds ?? []);
  const activeDefaults = defaults
    .filter((s) => !skippedIds.has(s.id))
    .map((s) => ({
      source: 'default' as const,
      id: s.id,
      stepType: s.stepType as 'test' | 'script',
      testId: s.testId,
      scriptId: s.scriptId,
      name: s.testName || s.scriptName || 'Unknown',
    }));

  const extras: Array<{
    source: 'extra';
    id: string;
    stepType: 'test' | 'script';
    testId: string | null | undefined;
    scriptId: string | null | undefined;
    name: string;
  }> = [];

  if (overrides?.extraSteps) {
    for (let i = 0; i < overrides.extraSteps.length; i++) {
      const step = overrides.extraSteps[i];
      let name = 'Unknown';
      if (step.stepType === 'test' && step.testId) {
        const t = await getTest(step.testId);
        name = t?.name || 'Deleted test';
      } else if (step.stepType === 'script' && step.scriptId) {
        const s = await getSetupScript(step.scriptId);
        name = s?.name || 'Deleted script';
      }
      extras.push({
        source: 'extra',
        id: `extra-${i}`,
        stepType: step.stepType,
        testId: step.testId,
        scriptId: step.scriptId,
        name,
      });
    }
  }

  return [...activeDefaults, ...extras];
}

// ============================================
// Per-Test Stabilization Overrides
// ============================================

export async function updateTestStabilizationOverrides(testId: string, overrides: Partial<StabilizationSettings> | null) {
  await db.update(tests).set({ stabilizationOverrides: overrides, updatedAt: new Date() }).where(eq(tests.id, testId));
}
