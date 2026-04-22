import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { teams, users, runners, embeddedSessions } from '@/lib/db/schema';
import { upsertEmbeddedSession } from '@/server/actions/embedded-sessions';
import { emitRunnerStatusChange } from '@/lib/ws/runner-events';
import { eq, and } from 'drizzle-orm';
import crypto from 'crypto';
import { syncUserToTwentyCRM } from '@/lib/integrations/twenty-crm';
import { rewriteDevStreamUrl, rewriteDevCdpUrl } from '@/lib/eb/dev-port-forward';

const SYSTEM_TEAM_NAME = '__system__';
const SYSTEM_TEAM_SLUG = '__system__';
const SYSTEM_USER_EMAIL = 'system@lastest.internal';

/**
 * Find or create the __system__ team and user for system EBs.
 */
async function getOrCreateSystemTeam(): Promise<{ teamId: string; userId: string }> {
  let [team] = await db.select().from(teams).where(eq(teams.slug, SYSTEM_TEAM_SLUG));
  if (!team) {
    const teamId = crypto.randomUUID();
    await db.insert(teams).values({
      id: teamId,
      name: SYSTEM_TEAM_NAME,
      slug: SYSTEM_TEAM_SLUG,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    [team] = await db.select().from(teams).where(eq(teams.id, teamId));
  }

  let [user] = await db.select().from(users).where(eq(users.email, SYSTEM_USER_EMAIL));
  if (!user) {
    const userId = crypto.randomUUID();
    await db.insert(users).values({
      id: userId,
      email: SYSTEM_USER_EMAIL,
      name: 'System',
      teamId: team!.id,
      role: 'admin',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    [user] = await db.select().from(users).where(eq(users.id, userId));
    syncUserToTwentyCRM({ name: 'System', email: SYSTEM_USER_EMAIL }).catch(() => {});
  }

  return { teamId: team!.id, userId: user!.id };
}

/**
 * POST /api/embedded/auto-register
 *
 * Called by system EB containers (Docker replicas) on startup.
 * Authenticates via SYSTEM_EB_TOKEN shared secret.
 * Creates/updates a system runner per instance (identified by instanceId = os.hostname()).
 */
export async function POST(request: Request) {
  // Validate SYSTEM_EB_TOKEN
  const expectedToken = process.env.SYSTEM_EB_TOKEN;
  if (!expectedToken) {
    return NextResponse.json({ error: 'System EB registration not configured' }, { status: 503 });
  }

  const authHeader = request.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return NextResponse.json({ error: 'Missing authorization' }, { status: 401 });
  }

  const token = authHeader.slice(7);
  const validTokens = expectedToken.split(',').map(t => t.trim());
  if (!validTokens.includes(token)) {
    return NextResponse.json({ error: 'Invalid system token' }, { status: 401 });
  }

  // Parse body
  let body: {
    streamUrl: string;
    cdpUrl?: string;
    containerUrl: string;
    viewport?: { width: number; height: number };
    instanceId: string;
  };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  if (!body.streamUrl || !body.containerUrl || !body.instanceId) {
    return NextResponse.json({ error: 'streamUrl, containerUrl, and instanceId are required' }, { status: 400 });
  }

  const { teamId, userId } = await getOrCreateSystemTeam();

  const runnerName = `System EB-${body.instanceId}`;
  const runnerToken = `lastest_runner_${crypto.randomBytes(32).toString('hex')}`;
  const tokenHash = crypto.createHash('sha256').update(runnerToken).digest('hex');

  // Dev-only: spawn `kubectl port-forward` for this pod so the host dev server
  // can reach cluster-internal ports. Async + external — must run BEFORE the
  // DB transaction so we don't hold a row lock while kubectl is spawning.
  const streamUrl = (await rewriteDevStreamUrl(body.instanceId, body.streamUrl)) ?? body.streamUrl;
  const cdpUrl = await rewriteDevCdpUrl(body.instanceId, body.cdpUrl);

  // Atomic upsert of runner + session. If these aren't in the same tx, a
  // worker's `claimPoolEB` can see `runner.status='online'` in the gap before
  // the session row is inserted, flip the runner to `busy`, find no session
  // row, and leave the session permanently in `status='ready'` — which makes
  // the sidebar show the EB as idle/green while it's actively running tests,
  // and also defangs the `updateRunnerStatus` session-busy guard. One tx
  // eliminates the visibility gap.
  const {
    runner,
    session,
    previousStatus,
  } = await db.transaction(async (tx) => {
    let [existingRunner] = await tx
      .select()
      .from(runners)
      .where(and(eq(runners.name, runnerName), eq(runners.isSystem, true)));

    let runnerRow;
    const previousStatus = existingRunner?.status;
    if (!existingRunner) {
      const runnerId = crypto.randomUUID();
      await tx.insert(runners).values({
        id: runnerId,
        teamId,
        createdById: userId,
        name: runnerName,
        tokenHash,
        status: 'online',
        capabilities: ['run', 'record'],
        type: 'embedded',
        isSystem: true,
        // Sequential within an EB: 6 concurrent contexts on one Chromium instance
        // race each other on setup storageState and deadlock. Build-level parallelism
        // comes from distributing across sidecars (10 EBs → 10 parallel runs).
        maxParallelTests: 1,
        lastSeen: new Date(),
        createdAt: new Date(),
      });
      [existingRunner] = await tx.select().from(runners).where(eq(runners.id, runnerId));
      runnerRow = existingRunner!;
    } else {
      // Re-register. Preserve `busy` when the session is still busy — a
      // re-register that clobbers `busy→online` races with `claimPoolEB` and
      // can hand the same EB to two workers (previously surfaced as
      // `Target … has been closed`). Inlines the safeguard that used to live
      // in `updateRunnerStatus`, since that helper can't participate in our tx.
      const [busySession] = await tx
        .select({ id: embeddedSessions.id })
        .from(embeddedSessions)
        .where(and(
          eq(embeddedSessions.runnerId, existingRunner.id),
          eq(embeddedSessions.status, 'busy'),
        ))
        .limit(1);
      const effectiveStatus = busySession ? existingRunner.status : 'online';
      await tx
        .update(runners)
        .set({ tokenHash, status: effectiveStatus, lastSeen: new Date(), maxParallelTests: 1 })
        .where(eq(runners.id, existingRunner.id));
      [runnerRow] = await tx.select().from(runners).where(eq(runners.id, existingRunner.id));
    }

    const sessionRow = await upsertEmbeddedSession({
      teamId,
      runnerId: runnerRow!.id,
      streamUrl,
      cdpUrl,
      containerUrl: body.containerUrl,
      viewport: body.viewport,
    }, tx);

    return { runner: runnerRow!, session: sessionRow, previousStatus };
  });

  // Emit status change outside the tx so subscribers see the change only once
  // it's durable. Mirrors what `updateRunnerStatus` would have emitted.
  if (previousStatus !== runner.status) {
    emitRunnerStatusChange({
      runnerId: runner.id,
      teamId: runner.teamId,
      status: runner.status as 'online' | 'busy' | 'offline',
      previousStatus: previousStatus as 'online' | 'busy' | 'offline' | undefined,
      timestamp: Date.now(),
    });
  }

  return NextResponse.json({
    runnerId: runner.id,
    token: runnerToken,
    sessionId: session.id,
  });
}
