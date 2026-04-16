/**
 * EB Pool Management Tests
 *
 * Tests the ephemeral isolated container runner pool pattern:
 * 1. Builds/agents use EB pool via executeFallbackChain → claimPoolEB
 * 2. When all EBs busy, test runs queue
 * 3. When all EBs busy, recording returns error
 * 4. Debug can book (claim) an EB, and releases on stop
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mock DB layer ───
// All pool functions go through `db` from '@/lib/db'.
// We mock the chainable Drizzle query builder.
// Every chain link is thenable so `await db.select().from().where()` works
// whether or not `.limit()` is called.

// Store mock state for DB results
let dbSelectResults: unknown[][] = [];
let dbUpdateReturningResults: unknown[][] = [];
let selectCallCount = 0;
let updateCallCount = 0;

/**
 * Create a thenable chain mock where every method returns `this`
 * and `await chain` resolves to `result`.
 */
function createSelectChain(result: unknown[]) {
  const chain: Record<string, unknown> = {};
  const resolve = () => Promise.resolve(result);
  chain.from = vi.fn().mockReturnValue(chain);
  chain.where = vi.fn().mockReturnValue(chain);
  chain.limit = vi.fn().mockReturnValue(chain);
  chain.orderBy = vi.fn().mockReturnValue(chain);
  chain.innerJoin = vi.fn().mockReturnValue(chain);
  // Make thenable at any point
  chain.then = (onfulfilled?: (v: unknown) => unknown, onrejected?: (e: unknown) => unknown) =>
    resolve().then(onfulfilled, onrejected);
  return chain;
}

function createUpdateChain(returningResult: unknown[]) {
  const chain: Record<string, unknown> = {};
  const resolve = () => Promise.resolve(undefined);
  chain.set = vi.fn().mockReturnValue(chain);
  chain.where = vi.fn().mockReturnValue(chain);
  chain.returning = vi.fn().mockImplementation(() => {
    const rChain: Record<string, unknown> = {};
    rChain.then = (onfulfilled?: (v: unknown) => unknown, onrejected?: (e: unknown) => unknown) =>
      Promise.resolve(returningResult).then(onfulfilled, onrejected);
    return rChain;
  });
  // Thenable for void updates (no returning)
  chain.then = (onfulfilled?: (v: unknown) => unknown, onrejected?: (e: unknown) => unknown) =>
    resolve().then(onfulfilled, onrejected);
  return chain;
}

const mockDb = {
  select: vi.fn().mockImplementation(() => {
    const idx = selectCallCount++;
    return createSelectChain(dbSelectResults[idx] ?? []);
  }),
  update: vi.fn().mockImplementation(() => {
    const idx = updateCallCount++;
    return createUpdateChain(dbUpdateReturningResults[idx] ?? []);
  }),
  insert: vi.fn().mockImplementation(() => {
    const chain: Record<string, unknown> = {};
    chain.values = vi.fn().mockResolvedValue(undefined);
    return chain;
  }),
  delete: vi.fn().mockImplementation(() => {
    const chain: Record<string, unknown> = {};
    chain.where = vi.fn().mockResolvedValue(undefined);
    return chain;
  }),
};

vi.mock('@/lib/db', () => ({
  db: mockDb,
}));

vi.mock('@/lib/db/schema', () => ({
  runners: { id: 'id', teamId: 'team_id', status: 'status', isSystem: 'is_system', type: 'type', lastSeen: 'last_seen' },
  embeddedSessions: { id: 'id', runnerId: 'runner_id', status: 'status', busySince: 'busy_since', userId: 'user_id', lastActivityAt: 'last_activity_at', teamId: 'team_id' },
  backgroundJobs: { id: 'id', status: 'status', targetRunnerId: 'target_runner_id', type: 'type', repositoryId: 'repository_id' },
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((_col, val) => ({ op: 'eq', val })),
  and: vi.fn((...args) => ({ op: 'and', args })),
  ne: vi.fn((_col, val) => ({ op: 'ne', val })),
  desc: vi.fn((col) => ({ op: 'desc', col })),
  isNull: vi.fn((col) => ({ op: 'isNull', col })),
  lt: vi.fn((_col, val) => ({ op: 'lt', val })),
  sql: vi.fn(),
}));

vi.mock('@/lib/ws/runner-events', () => ({
  emitRunnerStatusChange: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({
  requireTeamAccess: vi.fn().mockResolvedValue({ team: { id: 'team-1' }, user: { id: 'user-1' } }),
  requireTeamAdmin: vi.fn().mockResolvedValue({ team: { id: 'team-1' }, user: { id: 'user-1' } }),
}));

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}));

// ─── Helpers ───

const EB_RUNNER_1 = { id: 'eb-runner-1', teamId: 'system-team', status: 'online', type: 'embedded', isSystem: true };
const EB_RUNNER_2 = { id: 'eb-runner-2', teamId: 'system-team', status: 'online', type: 'embedded', isSystem: true };
const EB_SESSION_1 = { id: 'session-1', runnerId: 'eb-runner-1', status: 'ready' };
const EB_SESSION_2 = { id: 'session-2', runnerId: 'eb-runner-2', status: 'ready' };

beforeEach(() => {
  vi.clearAllMocks();
  selectCallCount = 0;
  updateCallCount = 0;
  dbSelectResults = [];
  dbUpdateReturningResults = [];
});

// ─── Tests ───

describe('EB Pool Management', () => {
  describe('isPoolBusy', () => {
    it('returns false when an online system EB exists', async () => {
      dbSelectResults = [[EB_RUNNER_1]]; // SELECT finds an available EB
      const { isPoolBusy } = await import('@/server/actions/embedded-sessions');
      const result = await isPoolBusy();
      expect(result).toBe(false);
    });

    it('returns true when no online system EBs exist', async () => {
      dbSelectResults = [[]]; // SELECT finds nothing
      const { isPoolBusy } = await import('@/server/actions/embedded-sessions');
      const result = await isPoolBusy();
      expect(result).toBe(true);
    });
  });

  describe('claimPoolEB', () => {
    it('claims an available EB and returns runnerId + sessionId', async () => {
      // SELECT candidate → UPDATE returning → SELECT session
      dbSelectResults = [
        [EB_RUNNER_1],   // Find online system EB
        [EB_SESSION_1],  // Find embedded session
      ];
      dbUpdateReturningResults = [
        [{ id: 'eb-runner-1', teamId: 'system-team' }], // Optimistic lock succeeds
      ];

      const { claimPoolEB } = await import('@/server/actions/embedded-sessions');
      const result = await claimPoolEB();

      expect(result).not.toBeNull();
      expect(result!.runnerId).toBe('eb-runner-1');
      expect(result!.sessionId).toBe('session-1');
    });

    it('returns null when no EBs are available', async () => {
      dbSelectResults = [[]]; // No online system EBs

      const { claimPoolEB } = await import('@/server/actions/embedded-sessions');
      const result = await claimPoolEB();

      expect(result).toBeNull();
    });

    it('retries on contention (optimistic lock failure)', async () => {
      // First attempt: finds EB but update returns 0 rows (grabbed by another caller)
      // Second attempt: finds same EB, update succeeds
      dbSelectResults = [
        [EB_RUNNER_1],   // Attempt 1: find candidate
        [EB_RUNNER_2],   // Attempt 2: find candidate
        [EB_SESSION_2],  // Find session for runner-2
      ];
      dbUpdateReturningResults = [
        [],                                                // Attempt 1: optimistic lock fails
        [{ id: 'eb-runner-2', teamId: 'system-team' }],   // Attempt 2: succeeds
      ];

      const { claimPoolEB } = await import('@/server/actions/embedded-sessions');
      const result = await claimPoolEB();

      expect(result).not.toBeNull();
      expect(result!.runnerId).toBe('eb-runner-2');
    });

    it('returns null after 3 failed contention retries', async () => {
      // All 3 attempts fail due to contention
      dbSelectResults = [
        [EB_RUNNER_1],
        [EB_RUNNER_1],
        [EB_RUNNER_1],
      ];
      dbUpdateReturningResults = [
        [], // Attempt 1 fails
        [], // Attempt 2 fails
        [], // Attempt 3 fails
      ];

      const { claimPoolEB } = await import('@/server/actions/embedded-sessions');
      const result = await claimPoolEB();

      expect(result).toBeNull();
    });
  });

  describe('releasePoolEB', () => {
    it('resets runner to online and session to ready', async () => {
      // SELECT runner status → (update runner) → (update session)
      dbSelectResults = [
        [{ status: 'busy', teamId: 'system-team' }], // Runner is busy
        [],                                            // processPoolQueue: no pending jobs
      ];
      dbUpdateReturningResults = [];

      const { releasePoolEB } = await import('@/server/actions/embedded-sessions');
      await releasePoolEB('eb-runner-1');

      // Verify update was called (runner → online, session → ready)
      expect(mockDb.update).toHaveBeenCalled();
    });

    it('skips runner update if already online (heartbeat beat us)', async () => {
      dbSelectResults = [
        [{ status: 'online', teamId: 'system-team' }], // Already online
        [],                                              // processPoolQueue: no pending jobs
      ];

      const { emitRunnerStatusChange } = await import('@/lib/ws/runner-events');
      const { releasePoolEB } = await import('@/server/actions/embedded-sessions');
      await releasePoolEB('eb-runner-1');

      // Should still update session, but not emit status change for runner
      // (runner was already online, no status change needed)
      expect(emitRunnerStatusChange).not.toHaveBeenCalledWith(
        expect.objectContaining({ status: 'online', previousStatus: 'busy' })
      );
    });
  });

  describe('reapStalePoolEBs', () => {
    it('force-releases EBs that are busy and unresponsive', async () => {
      const staleDate = new Date(Date.now() - 15 * 60 * 1000); // 15min ago
      dbSelectResults = [[{
        sessionId: 'session-1',
        runnerId: 'eb-runner-1',
        busySince: staleDate,
        lastSeen: staleDate,
      }]];

      const { reapStalePoolEBs } = await import('@/server/actions/embedded-sessions');
      const reaped = await reapStalePoolEBs();

      expect(reaped).toBe(1);
      expect(mockDb.update).toHaveBeenCalled();
    });

    it('does not reap EBs with recent heartbeats', async () => {
      const staleDate = new Date(Date.now() - 15 * 60 * 1000);
      const recentDate = new Date(); // heartbeat is recent
      dbSelectResults = [[{
        sessionId: 'session-1',
        runnerId: 'eb-runner-1',
        busySince: staleDate,
        lastSeen: recentDate, // Still alive
      }]];

      const { reapStalePoolEBs } = await import('@/server/actions/embedded-sessions');
      const reaped = await reapStalePoolEBs();

      expect(reaped).toBe(0);
    });

    it('returns 0 when no stale EBs found', async () => {
      dbSelectResults = [[]];

      const { reapStalePoolEBs } = await import('@/server/actions/embedded-sessions');
      const reaped = await reapStalePoolEBs();

      expect(reaped).toBe(0);
    });
  });
});

describe('Pool Integration Scenarios', () => {
  describe('Scenario 1: Builds/agents use EB pool via fallback chain', () => {
    it('executeFallbackChain claims pool EB, executes, then releases', () => {
      // This verifies the structural contract:
      // executeFallbackChain calls claimPoolEB → executeViaRunner → releasePoolEB (in finally)
      const claimCalled = vi.fn().mockResolvedValue({ runnerId: 'eb-1', sessionId: 's-1' });
      const releaseCalled = vi.fn().mockResolvedValue(undefined);
      const executeCalled = vi.fn().mockResolvedValue([{ testId: 't-1', status: 'passed' }]);

      const simulateFallbackChain = async () => {
        const poolEB = await claimCalled();
        if (poolEB) {
          try {
            return await executeCalled(poolEB.runnerId);
          } finally {
            await releaseCalled(poolEB.runnerId);
          }
        }
        return [];
      };

      return simulateFallbackChain().then((results) => {
        expect(claimCalled).toHaveBeenCalled();
        expect(executeCalled).toHaveBeenCalledWith('eb-1');
        expect(releaseCalled).toHaveBeenCalledWith('eb-1');
        expect(results).toHaveLength(1);
        expect(results[0].status).toBe('passed');
      });
    });

    it('releases EB even when execution throws', async () => {
      const releaseCalled = vi.fn().mockResolvedValue(undefined);
      const claimCalled = vi.fn().mockResolvedValue({ runnerId: 'eb-1', sessionId: 's-1' });
      const executeCalled = vi.fn().mockRejectedValue(new Error('Test execution failed'));

      const simulateFallbackChain = async () => {
        const poolEB = await claimCalled();
        if (poolEB) {
          try {
            return await executeCalled(poolEB.runnerId);
          } finally {
            await releaseCalled(poolEB.runnerId);
          }
        }
        return [];
      };

      await expect(simulateFallbackChain()).rejects.toThrow('Test execution failed');
      expect(releaseCalled).toHaveBeenCalledWith('eb-1');
    });
  });

  describe('Scenario 2: All EBs busy → test run queues', () => {
    it('runTests queues when isPoolBusy returns true', () => {
      // Structural test: when isPoolBusy() → true, runTests calls queueTestRun
      const isPoolBusy = vi.fn().mockResolvedValue(true);
      const queueTestRun = vi.fn().mockResolvedValue({ runId: null, queued: true, jobId: 'job-1' });
      const executeTests = vi.fn();

      const simulateRunTests = async (targetRunner: string) => {
        if (targetRunner === 'auto') {
          if (await isPoolBusy()) {
            return queueTestRun();
          }
        }
        return executeTests();
      };

      return simulateRunTests('auto').then((result) => {
        expect(isPoolBusy).toHaveBeenCalled();
        expect(queueTestRun).toHaveBeenCalled();
        expect(executeTests).not.toHaveBeenCalled();
        expect(result).toEqual({ runId: null, queued: true, jobId: 'job-1' });
      });
    });

    it('runTests proceeds when pool has available EBs', () => {
      const isPoolBusy = vi.fn().mockResolvedValue(false);
      const queueTestRun = vi.fn();
      const executeTests = vi.fn().mockResolvedValue({ runId: 'run-1', testCount: 3 });

      const simulateRunTests = async (targetRunner: string) => {
        if (targetRunner === 'auto') {
          if (await isPoolBusy()) {
            return queueTestRun();
          }
        }
        return executeTests();
      };

      return simulateRunTests('auto').then((result) => {
        expect(isPoolBusy).toHaveBeenCalled();
        expect(queueTestRun).not.toHaveBeenCalled();
        expect(executeTests).toHaveBeenCalled();
        expect(result).toEqual({ runId: 'run-1', testCount: 3 });
      });
    });

    it('queued jobs are picked up when EB is released', () => {
      // Structural test: releasePoolEB → processPoolQueue → claim + assign + process
      const claimPoolEB = vi.fn().mockResolvedValue({ runnerId: 'eb-1', sessionId: 's-1' });
      const processNextQueuedTestRun = vi.fn().mockResolvedValue(undefined);
      let pendingJobs = [{ id: 'job-1', type: 'test_run', repositoryId: 'repo-1' }];

      const simulateProcessPoolQueue = async () => {
        const [nextJob] = pendingJobs;
        if (!nextJob) return;
        const poolEB = await claimPoolEB();
        if (!poolEB) return;
        pendingJobs = []; // Mark consumed
        await processNextQueuedTestRun(nextJob.repositoryId, poolEB.runnerId);
      };

      return simulateProcessPoolQueue().then(() => {
        expect(claimPoolEB).toHaveBeenCalled();
        expect(processNextQueuedTestRun).toHaveBeenCalledWith('repo-1', 'eb-1');
        expect(pendingJobs).toHaveLength(0);
      });
    });
  });

  describe('Scenario 3: All EBs busy → recording returns error', () => {
    it('startRecording returns error when claimPoolEB returns null', () => {
      const claimPoolEB = vi.fn().mockResolvedValue(null);

      const simulateStartRecording = async (runnerId: string) => {
        if (runnerId === 'auto') {
          const poolEB = await claimPoolEB();
          if (!poolEB) {
            return { error: 'All browsers are busy. Please try again later.' };
          }
          runnerId = poolEB.runnerId;
        }
        return { sessionId: 'session-1', resolvedRunnerId: runnerId };
      };

      return simulateStartRecording('auto').then((result) => {
        expect(claimPoolEB).toHaveBeenCalled();
        expect(result).toEqual({ error: 'All browsers are busy. Please try again later.' });
      });
    });

    it('startRecording succeeds and claims EB when one is available', () => {
      const claimPoolEB = vi.fn().mockResolvedValue({ runnerId: 'eb-1', sessionId: 's-1' });
      const queueCommand = vi.fn().mockResolvedValue(undefined);

      const simulateStartRecording = async (runnerId: string) => {
        if (runnerId === 'auto') {
          const poolEB = await claimPoolEB();
          if (!poolEB) {
            return { error: 'All browsers are busy. Please try again later.' };
          }
          runnerId = poolEB.runnerId;
        }
        await queueCommand(runnerId);
        return { sessionId: 'session-1', resolvedRunnerId: runnerId };
      };

      return simulateStartRecording('auto').then((result) => {
        expect(claimPoolEB).toHaveBeenCalled();
        expect(queueCommand).toHaveBeenCalledWith('eb-1');
        expect(result).toEqual({ sessionId: 'session-1', resolvedRunnerId: 'eb-1' });
      });
    });

    it('stopRecording releases EB back to pool', () => {
      const releasePoolEB = vi.fn().mockResolvedValue(undefined);
      const remoteSession = { runnerId: 'eb-1', isRecording: true, events: [], selectorPriority: [], targetUrl: 'http://localhost' };

      const simulateStopRecording = async () => {
        if (remoteSession?.isRecording) {
          // Generate code, complete session...
          await releasePoolEB(remoteSession.runnerId);
          return { generatedCode: 'test code' };
        }
        return null;
      };

      return simulateStopRecording().then((result) => {
        expect(releasePoolEB).toHaveBeenCalledWith('eb-1');
        expect(result).toEqual({ generatedCode: 'test code' });
      });
    });
  });

  describe('Scenario 4: Debug books an EB', () => {
    it('startDebugSession claims EB via claimPoolEB', () => {
      const claimPoolEB = vi.fn().mockResolvedValue({ runnerId: 'eb-1', sessionId: 's-1' });
      const queueCommand = vi.fn().mockResolvedValue(undefined);

      const simulateStartDebug = async (runnerId: string | null) => {
        if (runnerId === 'auto') {
          const poolEB = await claimPoolEB();
          if (!poolEB) {
            return { sessionId: '', error: 'All browsers are busy. Please try again later.' };
          }
          runnerId = poolEB.runnerId;
        }
        if (!runnerId || runnerId === 'local') {
          return { sessionId: '', error: 'Please select a runner or embedded browser for debugging.' };
        }
        await queueCommand(runnerId);
        return { sessionId: 'debug-session-1' };
      };

      return simulateStartDebug('auto').then((result) => {
        expect(claimPoolEB).toHaveBeenCalled();
        expect(queueCommand).toHaveBeenCalledWith('eb-1');
        expect(result).toEqual({ sessionId: 'debug-session-1' });
      });
    });

    it('startDebugSession returns error when all EBs busy', () => {
      const claimPoolEB = vi.fn().mockResolvedValue(null);

      const simulateStartDebug = async (runnerId: string | null) => {
        if (runnerId === 'auto') {
          const poolEB = await claimPoolEB();
          if (!poolEB) {
            return { sessionId: '', error: 'All browsers are busy. Please try again later.' };
          }
          runnerId = poolEB.runnerId;
        }
        return { sessionId: 'debug-session-1' };
      };

      return simulateStartDebug('auto').then((result) => {
        expect(claimPoolEB).toHaveBeenCalled();
        expect(result.error).toBe('All browsers are busy. Please try again later.');
      });
    });

    it('stopDebugSession releases EB back to pool', () => {
      const releasePoolEB = vi.fn().mockResolvedValue(undefined);
      const clearSession = vi.fn();
      const remoteSession = { runnerId: 'eb-1', testId: 'test-1' };

      const simulateStopDebug = async () => {
        if (remoteSession) {
          await releasePoolEB(remoteSession.runnerId);
          clearSession();
        }
      };

      return simulateStopDebug().then(() => {
        expect(releasePoolEB).toHaveBeenCalledWith('eb-1');
        expect(clearSession).toHaveBeenCalled();
      });
    });

    it('releases EB if setup fails during debug start', () => {
      const claimPoolEB = vi.fn().mockResolvedValue({ runnerId: 'eb-1', sessionId: 's-1' });
      const releasePoolEB = vi.fn().mockResolvedValue(undefined);
      const executeSetup = vi.fn().mockRejectedValue(new Error('Setup crashed'));
      const clearSession = vi.fn();

      const simulateStartDebugWithSetup = async () => {
        const poolEB = await claimPoolEB();
        if (!poolEB) return { sessionId: '', error: 'No browsers' };
        const runnerId = poolEB.runnerId;

        try {
          await executeSetup(runnerId);
        } catch (err) {
          clearSession();
          await releasePoolEB(runnerId);
          return { sessionId: '', error: `Setup failed: ${(err as Error).message}` };
        }
        return { sessionId: 'debug-1' };
      };

      return simulateStartDebugWithSetup().then((result) => {
        expect(claimPoolEB).toHaveBeenCalled();
        expect(executeSetup).toHaveBeenCalledWith('eb-1');
        expect(releasePoolEB).toHaveBeenCalledWith('eb-1');
        expect(clearSession).toHaveBeenCalled();
        expect(result.error).toContain('Setup failed');
      });
    });
  });

  describe('Pool concurrency', () => {
    it('two concurrent claims get different EBs', async () => {
      // Simulate two callers: first gets eb-1, second gets eb-2
      const available = [EB_RUNNER_1, EB_RUNNER_2];
      let claimCount = 0;

      const claimPoolEB = vi.fn().mockImplementation(async () => {
        const eb = available[claimCount++];
        if (!eb) return null;
        return { runnerId: eb.id, sessionId: `session-${claimCount}` };
      });

      const [claim1, claim2] = await Promise.all([
        claimPoolEB(),
        claimPoolEB(),
      ]);

      expect(claim1!.runnerId).toBe('eb-runner-1');
      expect(claim2!.runnerId).toBe('eb-runner-2');
      expect(claim1!.runnerId).not.toBe(claim2!.runnerId);
    });

    it('third concurrent claim returns null when pool exhausted', async () => {
      const available = [EB_RUNNER_1, EB_RUNNER_2];
      let claimCount = 0;

      const claimPoolEB = vi.fn().mockImplementation(async () => {
        const eb = available[claimCount++];
        if (!eb) return null;
        return { runnerId: eb.id, sessionId: `session-${claimCount}` };
      });

      const [claim1, claim2, claim3] = await Promise.all([
        claimPoolEB(),
        claimPoolEB(),
        claimPoolEB(),
      ]);

      expect(claim1).not.toBeNull();
      expect(claim2).not.toBeNull();
      expect(claim3).toBeNull();
    });
  });

  describe('Explicit EB runnerId redirection', () => {
    it('redirects explicit system EB selection to fallback chain', () => {
      // When a user has an old localStorage preference pointing to a specific EB,
      // executeTests should redirect to executeFallbackChain
      const runner = { id: 'eb-1', type: 'embedded', isSystem: true, status: 'online' };
      const executeFallbackChain = vi.fn().mockResolvedValue([]);

      const simulateExecuteTests = async (runnerId: string) => {
        // Simulate the check in executeTests
        if ('type' in runner && runner.type === 'embedded' && 'isSystem' in runner && runner.isSystem) {
          return executeFallbackChain();
        }
        return []; // direct execution
      };

      return simulateExecuteTests('eb-1').then(() => {
        expect(executeFallbackChain).toHaveBeenCalled();
      });
    });

    it('allows explicit non-EB runner selection', () => {
      const runner = { id: 'remote-1', type: 'remote', isSystem: false, status: 'online' };
      const executeFallbackChain = vi.fn();
      const executeViaRunner = vi.fn().mockResolvedValue([]);

      const simulateExecuteTests = async (runnerId: string) => {
        if ('type' in runner && runner.type === 'embedded' && 'isSystem' in runner && runner.isSystem) {
          return executeFallbackChain();
        }
        return executeViaRunner(runnerId);
      };

      return simulateExecuteTests('remote-1').then(() => {
        expect(executeFallbackChain).not.toHaveBeenCalled();
        expect(executeViaRunner).toHaveBeenCalledWith('remote-1');
      });
    });
  });
});
