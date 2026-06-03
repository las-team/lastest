/**
 * Demo-mode bootstrap (main app side).
 *
 * Handles the full demo environment setup including repo seeding.
 * Team assignment and email checking are delegated to cloud-auth.
 */
import * as queries from '@/lib/db/queries';
import type { Team, Repository } from '@/lib/db/schema';
import {
  EXCALIDRAW_REPO_FULL_NAME,
  EXCALIDRAW_REPO_OWNER,
  EXCALIDRAW_REPO_NAME,
} from '@/lib/demo/excalidraw-seed';
export { isDemoEmail, getOrCreateDemoTeam, DEMO_EMAIL_DOMAIN } from "cloud-auth/src/lib/demo";

export const DEMO_TEAM_SLUG = 'demo';
export const DEMO_TEAM_NAME = 'Demo';
export const DEMO_REPO_OWNER = EXCALIDRAW_REPO_OWNER;
export const DEMO_REPO_NAME = EXCALIDRAW_REPO_NAME;
export const DEMO_REPO_FULL_NAME = EXCALIDRAW_REPO_FULL_NAME;

// Legacy identity for demo repos created before the dexilion-team/excalidraw
// switch. Migrated in place when the demo bootstrap runs.
const LEGACY_DEMO_REPO_NAME = 'sample';
const LEGACY_DEMO_REPO_OWNER = 'lastest';

export async function getOrCreateDemoRepo(teamId: string): Promise<Repository> {
  const repos = await queries.getRepositoriesByTeam(teamId);

  // Prefer an existing repo at the current dexilion-team/excalidraw identity.
  const current = repos.find(
    (r) => r.provider === 'local' && r.fullName === DEMO_REPO_FULL_NAME,
  );
  if (current) return current as Repository;

  // Migrate a legacy lastest/sample demo repo in place — preserves any tests,
  // builds, or baselines the demo team already accumulated.
  const legacy = repos.find(
    (r) =>
      r.provider === 'local' &&
      r.owner === LEGACY_DEMO_REPO_OWNER &&
      r.name === LEGACY_DEMO_REPO_NAME,
  );
  if (legacy) {
    await queries.updateRepository(legacy.id, {
      owner: DEMO_REPO_OWNER,
      name: DEMO_REPO_NAME,
      fullName: DEMO_REPO_FULL_NAME,
    });
    return (await queries.getRepository(legacy.id)) as Repository;
  }

  const created = await queries.createRepository({
    teamId,
    provider: 'local',
    owner: DEMO_REPO_OWNER,
    name: DEMO_REPO_NAME,
    fullName: DEMO_REPO_FULL_NAME,
    defaultBranch: 'main',
  });
  return (await queries.getRepository(created.id)) as Repository;
}

export async function ensureDemoEnvironment(): Promise<{
  team: Team;
  repo: Repository;
}> {
  // Re-import to use locally (re-export doesn't add to local scope)
  const { getOrCreateDemoTeam } = await import("cloud-auth/src/lib/demo");
  const team = await getOrCreateDemoTeam();
  const repo = await getOrCreateDemoRepo(team.id);
  if (!team.selectedRepositoryId || team.selectedRepositoryId !== repo.id) {
    await queries.updateTeam(team.id, { selectedRepositoryId: repo.id });
  }
  // Lazy import — the seed module is ~300KB of inline Playwright code that we
  // only want to pull in on first demo signup, not on every cold start.
  const { seedExcalidrawTests } = await import('@/lib/demo/excalidraw-seed');
  await seedExcalidrawTests(repo.id);
  return { team, repo };
}
