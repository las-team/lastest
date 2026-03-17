/**
 * autoresearch/harness/full-eval.ts — Full Pipeline Eval (IMMUTABLE)
 *
 * Triggers an actual Play Agent run and polls until completion.
 * Outputs metrics in the same parseable format.
 *
 * Usage:
 *   pnpm tsx autoresearch/harness/full-eval.ts --repo-id=<id>
 */

// Allow nested Claude CLI sessions
delete process.env.CLAUDECODE;

import { db } from '@/lib/db';
import { agentSessions } from '@/lib/db/schema';
import { eq, desc } from 'drizzle-orm';
import { getLatestBuildMetrics } from './metrics';

// ─── Types ──────────────────────────────────────────────────────

type AgentSessionStatus = 'active' | 'paused' | 'completed' | 'failed' | 'cancelled';

// ─── Config ─────────────────────────────────────────────────────

const POLL_INTERVAL_MS = 15_000; // 15 seconds
const MAX_WAIT_MS = 20 * 60 * 1000; // 20 minutes

// ─── Play Agent Trigger ─────────────────────────────────────────

async function triggerPlayAgent(repositoryId: string): Promise<string> {
  // Import startPlayAgent dynamically to avoid server action context issues
  // Instead, we directly create the agent session and kick off execution
  // by calling the HTTP endpoint or the function directly

  // Use the server action via dynamic import
  const { startPlayAgent } = await import('@/server/actions/play-agent');
  const result = await startPlayAgent(repositoryId);
  return result.sessionId;
}

// ─── Polling ────────────────────────────────────────────────────

async function waitForCompletion(sessionId: string): Promise<{
  status: AgentSessionStatus;
  durationMs: number;
}> {
  const startTime = Date.now();

  while (Date.now() - startTime < MAX_WAIT_MS) {
    const session = db
      .select({
        status: agentSessions.status,
        completedAt: agentSessions.completedAt,
      })
      .from(agentSessions)
      .where(eq(agentSessions.id, sessionId))
      .get();

    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    const status = session.status as AgentSessionStatus;

    if (status !== 'active' && status !== 'paused') {
      return {
        status,
        durationMs: Date.now() - startTime,
      };
    }

    console.error(`[full-eval] Session ${sessionId} status: ${status}, waiting...`);
    await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
  }

  throw new Error(`Timeout waiting for session ${sessionId} after ${MAX_WAIT_MS}ms`);
}

// ─── Main ───────────────────────────────────────────────────────

async function main() {
  const repoIdArg = process.argv.find(a => a.startsWith('--repo-id='));
  if (!repoIdArg) {
    console.error('Usage: pnpm tsx autoresearch/harness/full-eval.ts --repo-id=<id>');
    process.exit(1);
  }

  const repositoryId = repoIdArg.split('=')[1];
  const skipTrigger = process.argv.includes('--skip-trigger');

  let sessionId: string;

  if (skipTrigger) {
    // Use the latest active/completed session
    const latest = db
      .select({ id: agentSessions.id })
      .from(agentSessions)
      .where(eq(agentSessions.repositoryId, repositoryId))
      .orderBy(desc(agentSessions.createdAt))
      .limit(1)
      .get();

    if (!latest) {
      console.error('No agent sessions found');
      process.exit(1);
    }
    sessionId = latest.id;
    console.error(`[full-eval] Using existing session: ${sessionId}`);
  } else {
    console.error(`[full-eval] Triggering Play Agent for repo ${repositoryId}...`);
    try {
      sessionId = await triggerPlayAgent(repositoryId);
      console.error(`[full-eval] Session started: ${sessionId}`);
    } catch (e) {
      console.error(`[full-eval] Failed to trigger Play Agent: ${e instanceof Error ? e.message : e}`);
      console.error('[full-eval] Falling back to latest build metrics...');

      const metrics = await getLatestBuildMetrics(repositoryId);
      if (!metrics) {
        console.error('No builds found');
        process.exit(1);
      }

      outputMetrics(metrics.buildId, repositoryId, 0);
      return;
    }
  }

  // Wait for completion
  console.error(`[full-eval] Waiting for session to complete...`);
  const { status, durationMs } = await waitForCompletion(sessionId);
  console.error(`[full-eval] Session finished: ${status} (${(durationMs / 1000).toFixed(1)}s)`);

  // Get metrics from the build
  await outputMetrics(null, repositoryId, durationMs);
}

async function outputMetrics(
  buildId: string | null,
  repositoryId: string,
  durationMs: number
) {
  const metrics = await getLatestBuildMetrics(repositoryId);

  if (!metrics) {
    console.error('No build metrics available');
    process.exit(1);
  }

  console.log('---');
  console.log(`mode:            full-eval`);
  console.log(`build_id:        ${metrics.buildId}`);
  console.log(`pass_rate:       ${metrics.pass_rate.toFixed(6)}`);
  console.log(`route_accuracy:  ${metrics.route_accuracy.toFixed(6)}`);
  console.log(`syntax_quality:  ${metrics.syntax_quality.toFixed(6)}`);
  console.log(`auth_success:    ${metrics.auth_success.toFixed(6)}`);
  console.log(`route_coverage:  ${metrics.route_coverage.toFixed(6)}`);
  console.log(`efficiency:      ${metrics.efficiency.toFixed(3)}`);
  console.log(`passed:          ${metrics.passed}`);
  console.log(`failed:          ${metrics.failed}`);
  console.log(`total:           ${metrics.total}`);
  console.log(`duration_ms:     ${durationMs}`);
  console.log('---');
  console.log('failure_breakdown:');
  for (const [cat, count] of Object.entries(metrics.category_counts)) {
    if (count > 0) console.log(`  ${cat}: ${count}`);
  }
}

main().catch(e => {
  console.error('Fatal error:', e);
  process.exit(2);
});
