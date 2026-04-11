import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHash } from 'crypto';

// Mock dependencies BEFORE importing executor
vi.mock('./mode', () => ({
  getExecutionMode: vi.fn(() => 'local'),
  shouldUseLocalRunner: vi.fn((forceLocal?: boolean) => forceLocal ?? true),
  isLocalMode: vi.fn(() => true),
  isRunnerMode: vi.fn(() => false),
  isEmbeddedMode: vi.fn(() => false),
  isLocalDisabled: vi.fn(() => false),
}));

vi.mock('@/lib/playwright/runner', () => ({
  getRunner: vi.fn(() => ({
    setEnvironmentConfig: vi.fn(),
    setSettings: vi.fn(),
    runTests: vi.fn().mockResolvedValue([
      { testId: 'test-1', status: 'passed', durationMs: 100, screenshots: [] },
    ]),
  })),
}));

vi.mock('@/app/api/ws/runner/route', () => ({
  queueCommandToDB: vi.fn().mockResolvedValue(undefined),
  queueCancelCommandToDB: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/ws/runner-registry', () => ({
  runnerRegistry: {
    getAvailableRunner: vi.fn(() => null),
    getRunner: vi.fn(() => null),
  },
}));

vi.mock('@/lib/db', () => {
  // PG Drizzle returns arrays — queries are thennable promises resolving to arrays
  const mockLimit = vi.fn(() => Promise.resolve([]));
  const mockWhere = vi.fn(() => ({ limit: mockLimit, then: (resolve: (v: unknown[]) => void) => resolve([]) }));
  const mockFrom = vi.fn(() => ({ where: mockWhere }));
  return {
    db: {
      select: vi.fn(() => ({ from: mockFrom })),
      query: {
        backgroundJobs: {
          findFirst: vi.fn().mockResolvedValue(null),
        },
        tests: {
          findFirst: vi.fn().mockResolvedValue(null),
        },
      },
    },
  };
});

vi.mock('@/lib/db/schema', () => ({
  runners: {},
  tests: {},
  backgroundJobs: {},
  DEFAULT_STABILIZATION_SETTINGS: {
    freezeTimestamps: true,
    frozenTimestamp: '2024-01-01T12:00:00Z',
    freezeRandomValues: true,
    randomSeed: 12345,
    crossOsConsistency: false,
    waitForNetworkIdle: true,
    networkIdleTimeout: 2000,
    waitForDomStable: true,
    domStableTimeout: 500,
    waitForFonts: true,
    waitForImages: true,
    waitForImagesTimeout: 2000,
    waitForCanvasStable: false,
    canvasStableTimeout: 2000,
    canvasStableThreshold: 0.5,
    disableImageSmoothing: false,
    roundCanvasCoordinates: false,
    reseedRandomOnInput: false,
  },
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((...args: unknown[]) => args),
  and: vi.fn((...args: unknown[]) => args),
}));

vi.mock('@/lib/db/queries', () => ({
  getCommandsByTestRun: vi.fn().mockResolvedValue([]),
  getUnacknowledgedResults: vi.fn().mockResolvedValue([]),
  acknowledgeResults: vi.fn().mockResolvedValue(undefined),
  getRunnerCommandById: vi.fn().mockResolvedValue(null),
  getTestFixtures: vi.fn().mockResolvedValue([]),
}));

vi.mock('@/lib/ws/protocol', () => ({
  createMessage: vi.fn((type: string, payload: unknown) => ({
    id: 'mock-msg-id',
    type,
    timestamp: Date.now(),
    payload,
  })),
}));

vi.mock('@/lib/storage/paths', () => ({
  STORAGE_DIRS: { screenshots: '/tmp/test-screenshots' },
}));

vi.mock('@lastest/shared', () => ({
  getCrossOsFontCSS: vi.fn(() => '/* mock cross-os font CSS */'),
}));

import { executeTests, getExecutionModeInfo, hasAvailableRunner } from './executor';
import type { ExecutionOptions } from './executor';
import type { Test } from '@/lib/db/schema';
import { getRunner } from '@/lib/playwright/runner';
import { getExecutionMode, shouldUseLocalRunner } from './mode';
import { runnerRegistry } from '@/lib/ws/runner-registry';
import { queueCommandToDB } from '@/app/api/ws/runner/route';
import { db } from '@/lib/db';

const makeTest = (overrides: Partial<Test> = {}): Test =>
  ({
    id: 'test-1',
    name: 'Test One',
    code: 'export async function test(page) { await page.goto("/"); }',
    repositoryId: 'repo-1',
    ...overrides,
  }) as Test;

describe('Executor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('executeTests() routing', () => {
    it('routes to local when runnerId="local"', async () => {
      const tests = [makeTest()];
      const options: ExecutionOptions = { runnerId: 'local' };

      const results = await executeTests(tests, 'run-1', options);

      expect(getRunner).toHaveBeenCalledWith(undefined);
      expect(results).toHaveLength(1);
      expect(results[0].status).toBe('passed');
    });

    it('routes to local with environment config', async () => {
      const mockRunner = {
        setEnvironmentConfig: vi.fn(),
        setSettings: vi.fn(),
        runTests: vi.fn().mockResolvedValue([{ testId: 'test-1', status: 'passed', durationMs: 50, screenshots: [] }]),
      };
      vi.mocked(getRunner).mockReturnValue(mockRunner as ReturnType<typeof getRunner>);

      const tests = [makeTest()];
      const envConfig = { baseUrl: 'http://localhost:4000', id: 'env-1', repositoryId: 'repo-1' };
      const options: ExecutionOptions = {
        runnerId: 'local',
        repositoryId: 'repo-1',
        environmentConfig: envConfig as ExecutionOptions['environmentConfig'],
      };

      await executeTests(tests, 'run-1', options);

      expect(getRunner).toHaveBeenCalledWith('repo-1');
      expect(mockRunner.setEnvironmentConfig).toHaveBeenCalledWith(envConfig);
    });

    it('falls back to local when runnerId is UUID but no teamId provided', async () => {
      const tests = [makeTest()];
      const options: ExecutionOptions = { runnerId: 'some-runner-uuid' };

      const results = await executeTests(tests, 'run-1', options);

      // Falls back to local — getRunner should be called
      expect(getRunner).toHaveBeenCalled();
      expect(results).toHaveLength(1);
    });

    it('falls back to local when runner is not available', async () => {
      vi.mocked(runnerRegistry.getRunner).mockReturnValue(null);

      const tests = [makeTest()];
      const options: ExecutionOptions = { runnerId: 'dead-runner', teamId: 'team-1' };

      const results = await executeTests(tests, 'run-1', options);

      expect(getRunner).toHaveBeenCalled();
      expect(results).toHaveLength(1);
    });

    it('routes to runner when runner is available via registry', async () => {
      vi.mocked(runnerRegistry.getRunner).mockReturnValue({
        runnerId: 'runner-1',
        teamId: 'team-1',
        status: 'idle',
      } as ReturnType<typeof runnerRegistry.getRunner>);

      // Mock DB test lookup for the executeViaRunner flow
      vi.mocked(db.query.tests.findFirst).mockResolvedValue({
        id: 'test-1',
        code: 'export async function test(page) { await page.goto("/"); }',
      } as Awaited<ReturnType<typeof db.query.tests.findFirst>>);

      const tests = [makeTest()];
      const options: ExecutionOptions = {
        runnerId: 'runner-1',
        teamId: 'team-1',
        environmentConfig: { baseUrl: 'http://app:3000' } as ExecutionOptions['environmentConfig'],
      };

      // Since runner execution polls indefinitely, we need it to complete.
      // Mock getCommandsByTestRun to return a completed command.
      const { getCommandsByTestRun, getUnacknowledgedResults } = await import('@/lib/db/queries');
      vi.mocked(getCommandsByTestRun).mockResolvedValue([
        { id: 'mock-msg-id', status: 'completed' },
      ] as Awaited<ReturnType<typeof getCommandsByTestRun>>);
      vi.mocked(getUnacknowledgedResults).mockResolvedValue([
        {
          id: 'result-1',
          type: 'response:test_result',
          payload: { testId: 'test-1', status: 'passed', durationMs: 200, screenshotCount: 0 },
        },
      ] as Awaited<ReturnType<typeof getUnacknowledgedResults>>);

      const results = await executeTests(tests, 'run-1', options);

      expect(queueCommandToDB).toHaveBeenCalledWith('runner-1', expect.objectContaining({
        type: 'command:run_test',
      }));
      expect(results).toHaveLength(1);
      expect(results[0].testId).toBe('test-1');
      expect(results[0].status).toBe('passed');
    });

    it('uses auto-detection mode when no runnerId provided', async () => {
      vi.mocked(shouldUseLocalRunner).mockReturnValue(true);

      const tests = [makeTest()];
      const results = await executeTests(tests, 'run-1', {});

      expect(shouldUseLocalRunner).toHaveBeenCalled();
      expect(getRunner).toHaveBeenCalled();
      expect(results).toHaveLength(1);
    });

    it('falls back to local in auto-detect runner mode without teamId', async () => {
      vi.mocked(shouldUseLocalRunner).mockReturnValue(false);

      const tests = [makeTest()];
      const results = await executeTests(tests, 'run-1', {});

      // No teamId → falls back to local
      expect(getRunner).toHaveBeenCalled();
      expect(results).toHaveLength(1);
    });
  });

  describe('hashCode() — via command payload', () => {
    it('produces consistent SHA256 hashes in queued commands', async () => {
      vi.mocked(runnerRegistry.getRunner).mockReturnValue({
        runnerId: 'runner-1',
        teamId: 'team-1',
        status: 'idle',
      } as ReturnType<typeof runnerRegistry.getRunner>);

      const code = 'export async function test(page) { await page.goto("/"); }';
      vi.mocked(db.query.tests.findFirst).mockResolvedValue({
        id: 'test-1',
        code,
      } as Awaited<ReturnType<typeof db.query.tests.findFirst>>);

      const { getCommandsByTestRun, getUnacknowledgedResults } = await import('@/lib/db/queries');
      vi.mocked(getCommandsByTestRun).mockResolvedValue([
        { id: 'mock-msg-id', status: 'completed' },
      ] as Awaited<ReturnType<typeof getCommandsByTestRun>>);
      vi.mocked(getUnacknowledgedResults).mockResolvedValue([
        { id: 'r1', type: 'response:test_result', payload: { testId: 'test-1', status: 'passed', durationMs: 100, screenshotCount: 0 } },
      ] as Awaited<ReturnType<typeof getUnacknowledgedResults>>);

      const tests = [makeTest({ code })];
      await executeTests(tests, 'run-1', { runnerId: 'runner-1', teamId: 'team-1' });

      const { createMessage } = await import('@/lib/ws/protocol');
      const expectedHash = createHash('sha256').update(code).digest('hex');

      expect(createMessage).toHaveBeenCalledWith('command:run_test', expect.objectContaining({
        codeHash: expectedHash,
      }));
    });
  });

  describe('buildStabilizationPayload() — via command payload', () => {
    beforeEach(async () => {
      vi.mocked(runnerRegistry.getRunner).mockReturnValue({
        runnerId: 'runner-1',
        teamId: 'team-1',
        status: 'idle',
      } as ReturnType<typeof runnerRegistry.getRunner>);

      const { getCommandsByTestRun, getUnacknowledgedResults } = await import('@/lib/db/queries');
      vi.mocked(getCommandsByTestRun).mockResolvedValue([
        { id: 'mock-msg-id', status: 'completed' },
      ] as Awaited<ReturnType<typeof getCommandsByTestRun>>);
      vi.mocked(getUnacknowledgedResults).mockResolvedValue([
        { id: 'r1', type: 'response:test_result', payload: { testId: 'test-1', status: 'passed', durationMs: 100, screenshotCount: 0 } },
      ] as Awaited<ReturnType<typeof getUnacknowledgedResults>>);
    });

    it('passes undefined stabilization when no settings', async () => {
      const code = 'export async function test(page) { await page.goto("/"); }';
      vi.mocked(db.query.tests.findFirst).mockResolvedValue({ id: 'test-1', code } as Awaited<ReturnType<typeof db.query.tests.findFirst>>);

      const tests = [makeTest({ code })];
      await executeTests(tests, 'run-1', {
        runnerId: 'runner-1',
        teamId: 'team-1',
        // No playwrightSettings
      });

      const { createMessage } = await import('@/lib/ws/protocol');
      expect(createMessage).toHaveBeenCalledWith('command:run_test', expect.objectContaining({
        stabilization: undefined,
      }));
    });

    it('includes crossOsFontCSS when crossOsConsistency enabled', async () => {
      const code = 'export async function test(page) { await page.goto("/"); }';
      vi.mocked(db.query.tests.findFirst).mockResolvedValue({ id: 'test-1', code } as Awaited<ReturnType<typeof db.query.tests.findFirst>>);

      const tests = [makeTest({ code })];
      await executeTests(tests, 'run-1', {
        runnerId: 'runner-1',
        teamId: 'team-1',
        playwrightSettings: {
          stabilization: {
            crossOsConsistency: true,
            freezeTimestamps: true,
            frozenTimestamp: '2024-01-01T12:00:00Z',
            freezeRandomValues: false,
            randomSeed: 0,
            waitForNetworkIdle: false,
            networkIdleTimeout: 0,
            waitForDomStable: false,
            domStableTimeout: 0,
            waitForFonts: false,
            waitForImages: false,
            waitForImagesTimeout: 0,
          },
        } as ExecutionOptions['playwrightSettings'],
      });

      const { createMessage } = await import('@/lib/ws/protocol');
      expect(createMessage).toHaveBeenCalledWith('command:run_test', expect.objectContaining({
        stabilization: expect.objectContaining({
          crossOsConsistency: true,
          crossOsFontCSS: '/* mock cross-os font CSS */',
        }),
      }));
    });

    it('builds stabilization payload from settings', async () => {
      const code = 'export async function test(page) { await page.goto("/"); }';
      vi.mocked(db.query.tests.findFirst).mockResolvedValue({ id: 'test-1', code } as Awaited<ReturnType<typeof db.query.tests.findFirst>>);

      const tests = [makeTest({ code })];
      await executeTests(tests, 'run-1', {
        runnerId: 'runner-1',
        teamId: 'team-1',
        playwrightSettings: {
          stabilization: {
            freezeTimestamps: true,
            frozenTimestamp: '2024-01-01T12:00:00Z',
            freezeRandomValues: true,
            randomSeed: 42,
            crossOsConsistency: false,
            waitForNetworkIdle: true,
            networkIdleTimeout: 3000,
            waitForDomStable: true,
            domStableTimeout: 1000,
            waitForFonts: true,
            waitForImages: true,
            waitForImagesTimeout: 5000,
          },
          freezeAnimations: true,
        } as ExecutionOptions['playwrightSettings'],
      });

      const { createMessage } = await import('@/lib/ws/protocol');
      expect(createMessage).toHaveBeenCalledWith('command:run_test', expect.objectContaining({
        stabilization: expect.objectContaining({
          freezeTimestamps: true,
          freezeRandomValues: true,
          randomSeed: 42,
          freezeAnimations: true,
          waitForNetworkIdle: true,
          networkIdleTimeout: 3000,
        }),
      }));
    });
  });

  describe('getExecutionModeInfo()', () => {
    it('returns local mode info', () => {
      vi.mocked(getExecutionMode).mockReturnValue('local');
      const info = getExecutionModeInfo();
      expect(info.mode).toBe('local');
      expect(info.description).toContain('directly');
    });

    it('returns runner mode info', () => {
      vi.mocked(getExecutionMode).mockReturnValue('runner');
      const info = getExecutionModeInfo();
      expect(info.mode).toBe('runner');
      expect(info.description).toContain('remote runner');
    });

    it('returns embedded mode info', () => {
      vi.mocked(getExecutionMode).mockReturnValue('embedded');
      const info = getExecutionModeInfo();
      expect(info.mode).toBe('embedded');
      expect(info.description).toContain('embedded');
    });
  });

  describe('hasAvailableRunner()', () => {
    it('returns false when no runner available', async () => {
      vi.mocked(runnerRegistry.getAvailableRunner).mockReturnValue(null);
      const result = await hasAvailableRunner('team-1');
      expect(result).toBe(false);
    });

    it('returns true when WS runner available', async () => {
      vi.mocked(runnerRegistry.getAvailableRunner).mockReturnValue({
        runnerId: 'runner-1',
        teamId: 'team-1',
        status: 'idle',
      } as ReturnType<typeof runnerRegistry.getAvailableRunner>);

      const result = await hasAvailableRunner('team-1');
      expect(result).toBe(true);
    });
  });
});
