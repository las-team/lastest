import { describe, it, expect, vi, beforeEach } from 'vitest';

// `vi.mock` is hoisted above all top-level `const`s — module factories that
// reference outer `vi.fn()` instances must use `vi.hoisted` to keep the same
// hoist order. Otherwise vitest errors with "Cannot access X before init".
const { mockQueries, mockResolveSetupCodeForRunner } = vi.hoisted(() => ({
  mockQueries: {
    getDefaultSetupSteps: vi.fn(),
    getStorageState: vi.fn(),
    getTest: vi.fn(),
    getSetupScript: vi.fn(),
    getRepository: vi.fn(),
  },
  mockResolveSetupCodeForRunner: vi.fn(),
}));

vi.mock('@/lib/db/queries', () => mockQueries);
vi.mock('@/lib/execution/setup-capture', () => ({
  resolveSetupCodeForRunner: mockResolveSetupCodeForRunner,
}));

import { resolveBuildSetup } from './resolve-build-setup';
import type { Test } from '@/lib/db/schema';

function makeTest(overrides: Partial<Test> = {}): Test {
  return {
    id: 't1',
    name: 'Some Test',
    code: 'export async function test(){}',
    repositoryId: 'repo1',
    functionalAreaId: null,
    targetUrl: null,
    quarantined: false,
    setupTestId: null,
    setupScriptId: null,
    setupOverrides: null,
    executionMode: null,
    viewportOverride: null,
    playwrightOverrides: null,
    diffOverrides: null,
    stabilizationOverrides: null,
    deletedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as unknown as Test;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockQueries.getDefaultSetupSteps.mockResolvedValue([]);
  mockQueries.getStorageState.mockResolvedValue(null);
  mockQueries.getTest.mockResolvedValue(null);
  mockQueries.getSetupScript.mockResolvedValue(null);
  mockQueries.getRepository.mockResolvedValue(null);
  mockResolveSetupCodeForRunner.mockResolvedValue(undefined);
});

describe('resolveBuildSetup', () => {
  it('pre-loads first matching storage_state default step into setupContext', async () => {
    mockQueries.getDefaultSetupSteps.mockResolvedValue([
      { id: 's1', stepType: 'storage_state', storageStateId: 'ss-1' },
      { id: 's2', stepType: 'storage_state', storageStateId: 'ss-2' },
    ]);
    mockQueries.getStorageState.mockResolvedValueOnce({
      id: 'ss-1',
      name: 'logged-in',
      storageStateJson: '{"cookies":[]}',
    });

    const out = await resolveBuildSetup({
      tests: [makeTest()],
      repositoryId: 'repo1',
      build: null,
    });

    expect(out.setupContext.storageState).toBe('{"cookies":[]}');
    // Second storage_state is never queried — first match wins
    expect(mockQueries.getStorageState).toHaveBeenCalledTimes(1);
  });

  it('build.buildSetupTestId takes precedence over per-test fallback', async () => {
    mockQueries.getTest.mockResolvedValue({
      id: 'setup-test-id',
      code: 'BUILD_SETUP_CODE',
    });

    const out = await resolveBuildSetup({
      tests: [makeTest()],
      repositoryId: 'repo1',
      build: { buildSetupTestId: 'setup-test-id', buildSetupScriptId: null },
    });

    expect(out.setupInfo).toEqual({ code: 'BUILD_SETUP_CODE', setupId: 'setup-test-id' });
    expect(out.buildSetupResolved).toBe(true);
    // Per-test fallback must NOT run when build-level resolved
    expect(mockResolveSetupCodeForRunner).not.toHaveBeenCalled();
  });

  it('build.buildSetupScriptId resolves a playwright script', async () => {
    mockQueries.getSetupScript.mockResolvedValue({
      id: 'setup-script-id',
      type: 'playwright',
      code: 'BUILD_SETUP_SCRIPT_CODE',
    });

    const out = await resolveBuildSetup({
      tests: [makeTest()],
      repositoryId: 'repo1',
      build: { buildSetupTestId: null, buildSetupScriptId: 'setup-script-id' },
    });

    expect(out.setupInfo).toEqual({ code: 'BUILD_SETUP_SCRIPT_CODE', setupId: 'setup-script-id' });
    expect(out.buildSetupResolved).toBe(true);
    expect(mockResolveSetupCodeForRunner).not.toHaveBeenCalled();
  });

  it('non-playwright build-level script is rejected and falls through to per-test fallback', async () => {
    mockQueries.getSetupScript.mockResolvedValue({
      id: 'api-script-id',
      type: 'api',
      code: 'API_SCRIPT',
    });
    mockResolveSetupCodeForRunner.mockResolvedValue({
      code: 'FALLBACK_CODE',
      setupId: 'fallback-id',
    });

    const out = await resolveBuildSetup({
      tests: [makeTest()],
      repositoryId: 'repo1',
      build: { buildSetupTestId: null, buildSetupScriptId: 'api-script-id' },
    });

    expect(out.setupInfo).toEqual({ code: 'FALLBACK_CODE', setupId: 'fallback-id' });
    expect(out.buildSetupResolved).toBe(false);
  });

  it('falls back to resolveSetupCodeForRunner when no build-level setup', async () => {
    mockResolveSetupCodeForRunner.mockResolvedValue({
      code: 'PER_TEST_CODE',
      setupId: 'per-test-id',
    });

    const out = await resolveBuildSetup({
      tests: [makeTest()],
      repositoryId: 'repo1',
      build: null,
    });

    expect(out.setupInfo).toEqual({ code: 'PER_TEST_CODE', setupId: 'per-test-id' });
    expect(out.buildSetupResolved).toBe(false);
    expect(mockResolveSetupCodeForRunner).toHaveBeenCalledOnce();
  });

  it('returns no setupInfo when nothing resolves; setupContext.variables is empty', async () => {
    const out = await resolveBuildSetup({
      tests: [makeTest()],
      repositoryId: 'repo1',
      build: null,
    });

    expect(out.setupInfo).toBeUndefined();
    expect(out.setupContext.storageState).toBeUndefined();
    expect(out.setupContext.variables).toEqual({});
    expect(out.buildSetupResolved).toBe(false);
  });

  it('storage_state pre-load + per-test fallback coexist on the same build', async () => {
    mockQueries.getDefaultSetupSteps.mockResolvedValue([
      { id: 's1', stepType: 'storage_state', storageStateId: 'ss-1' },
    ]);
    mockQueries.getStorageState.mockResolvedValue({
      id: 'ss-1',
      name: 'logged-in',
      storageStateJson: '{"cookies":[]}',
    });
    mockResolveSetupCodeForRunner.mockResolvedValue({
      code: 'PER_TEST_CODE',
      setupId: 'per-test-id',
    });

    const out = await resolveBuildSetup({
      tests: [makeTest()],
      repositoryId: 'repo1',
      build: null,
    });

    expect(out.setupContext.storageState).toBe('{"cookies":[]}');
    expect(out.setupInfo).toEqual({ code: 'PER_TEST_CODE', setupId: 'per-test-id' });
  });

  it('skips storage_state pre-load when repositoryId is null', async () => {
    const out = await resolveBuildSetup({
      tests: [makeTest({ repositoryId: null })],
      repositoryId: null,
      build: null,
    });

    expect(mockQueries.getDefaultSetupSteps).not.toHaveBeenCalled();
    expect(out.setupContext.storageState).toBeUndefined();
  });
});
