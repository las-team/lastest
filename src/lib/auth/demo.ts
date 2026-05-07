/**
 * Demo-mode bootstrap.
 *
 * A single team identified by slug='demo' acts as the home for all demo users.
 * Members of the demo team are created with role='viewer', which combined with
 * the slug check in `isDemoSession` makes their sessions read-only at every
 * `requireWriteAccess` / `requireRepoWriteAccess` boundary.
 *
 * The demo team owns one provider='local' sample repo so demo users can run
 * the pre-recorded sample tests and inspect builds/diffs without needing
 * GitHub/GitLab connectivity.
 */
import * as queries from '@/lib/db/queries';
import type { Team, Repository } from '@/lib/db/schema';

export const DEMO_TEAM_SLUG = 'demo';
export const DEMO_TEAM_NAME = 'Demo';
export const DEMO_REPO_NAME = 'sample';
export const DEMO_REPO_OWNER = 'lastest';
export const DEMO_EMAIL_DOMAIN = 'demo.lastest.local';

export function isDemoEmail(email: string): boolean {
  return email.toLowerCase().endsWith(`@${DEMO_EMAIL_DOMAIN}`);
}

export async function getOrCreateDemoTeam(): Promise<Team> {
  const existing = await queries.getTeamBySlug(DEMO_TEAM_SLUG);
  if (existing) return existing;
  return queries.createTeam({ name: DEMO_TEAM_NAME, slug: DEMO_TEAM_SLUG });
}

export async function getOrCreateDemoRepo(teamId: string): Promise<Repository> {
  const repos = await queries.getRepositoriesByTeam(teamId);
  const existing = repos.find(
    (r) => r.provider === 'local' && r.name === DEMO_REPO_NAME,
  );
  if (existing) return existing as Repository;
  const created = await queries.createRepository({
    teamId,
    provider: 'local',
    owner: DEMO_REPO_OWNER,
    name: DEMO_REPO_NAME,
    fullName: `${DEMO_REPO_OWNER}/${DEMO_REPO_NAME}`,
    defaultBranch: 'main',
  });
  return (await queries.getRepository(created.id)) as Repository;
}

export async function ensureDemoEnvironment(): Promise<{
  team: Team;
  repo: Repository;
}> {
  const team = await getOrCreateDemoTeam();
  const repo = await getOrCreateDemoRepo(team.id);
  if (!team.selectedRepositoryId || team.selectedRepositoryId !== repo.id) {
    await queries.updateTeam(team.id, { selectedRepositoryId: repo.id });
  }
  return { team, repo };
}
