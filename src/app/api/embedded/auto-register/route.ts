import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { teams, users, runners } from '@/lib/db/schema';
import { upsertEmbeddedSession } from '@/server/actions/embedded-sessions';
import { updateRunnerStatus } from '@/server/actions/runners';
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

  // Upsert system runner by instanceId (name acts as stable key)
  const runnerName = `System EB-${body.instanceId}`;
  let [runner] = await db
    .select()
    .from(runners)
    .where(and(eq(runners.name, runnerName), eq(runners.isSystem, true)));

  // Generate a per-runner token for heartbeats
  const runnerToken = `lastest_runner_${crypto.randomBytes(32).toString('hex')}`;
  const tokenHash = crypto.createHash('sha256').update(runnerToken).digest('hex');

  if (!runner) {
    const runnerId = crypto.randomUUID();
    await db.insert(runners).values({
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
    [runner] = await db.select().from(runners).where(eq(runners.id, runnerId));
  } else {
    // Update existing runner: refresh token & mark online via updateRunnerStatus,
    // which preserves `busy` when an embedded session is still in flight — otherwise
    // a re-register races with `claimPoolEB` and the same EB gets handed to two
    // workers concurrently (observed in production as `Target … has been closed`).
    await db
      .update(runners)
      .set({ tokenHash, lastSeen: new Date(), maxParallelTests: 1 })
      .where(eq(runners.id, runner.id));
    await updateRunnerStatus(runner.id, 'online');
    [runner] = await db.select().from(runners).where(eq(runners.id, runner.id));
  }

  // Dev-only: when EB_DEV_PORT_FORWARD=1, spawn `kubectl port-forward` for this
  // pod so the host dev server can reach cluster-internal ports. No-op in prod.
  const streamUrl = (await rewriteDevStreamUrl(body.instanceId, body.streamUrl)) ?? body.streamUrl;
  const cdpUrl = await rewriteDevCdpUrl(body.instanceId, body.cdpUrl);

  // Upsert embedded session
  const session = await upsertEmbeddedSession({
    teamId,
    runnerId: runner!.id,
    streamUrl,
    cdpUrl,
    containerUrl: body.containerUrl,
    viewport: body.viewport,
  });

  return NextResponse.json({
    runnerId: runner!.id,
    token: runnerToken,
    sessionId: session.id,
  });
}
