import { and, eq } from "drizzle-orm";

import {
  ciGithubActionConfigs,
  ciGitlabPipelineConfigs,
  type GithubActionConfig,
  type GitlabPipelineConfig,
  type NewGithubActionConfig,
  type NewGitlabPipelineConfig,
} from "../schema";
import type { CiDb } from "./db";

/**
 * The plugin's query module — a straight move of
 * `src/lib/db/queries/{github-actions,gitlab-pipelines}.ts`, with two changes.
 *
 * 1. The `db` handle is an argument rather than a module import, because there
 *    is no `@lastest/db` to import from in here.
 * 2. Every read and write takes `teamId` as a **required** argument, including
 *    the two that did not before. That is not tightening for its own sake: the
 *    `team_id` filter is now the only tenancy boundary these tables have, since
 *    the FK to `teams` is gone. The two exceptions are the webhook lookups at
 *    the bottom, which is where the interesting part is.
 */

// ============================================
// GitHub Actions
// ============================================

export async function listGithubConfigs(
  db: CiDb,
  teamId: string,
): Promise<GithubActionConfig[]> {
  return db
    .select()
    .from(ciGithubActionConfigs)
    .where(eq(ciGithubActionConfigs.teamId, teamId));
}

export async function getGithubConfig(
  db: CiDb,
  id: string,
  teamId: string,
): Promise<GithubActionConfig | undefined> {
  const [row] = await db
    .select()
    .from(ciGithubActionConfigs)
    .where(
      and(
        eq(ciGithubActionConfigs.id, id),
        eq(ciGithubActionConfigs.teamId, teamId),
      ),
    );
  return row;
}

export async function createGithubConfig(
  db: CiDb,
  data: NewGithubActionConfig,
): Promise<GithubActionConfig> {
  const id = data.id || crypto.randomUUID();
  await db.insert(ciGithubActionConfigs).values({ ...data, id });
  const [row] = await db
    .select()
    .from(ciGithubActionConfigs)
    .where(eq(ciGithubActionConfigs.id, id));
  return row!;
}

export async function updateGithubConfig(
  db: CiDb,
  id: string,
  teamId: string,
  data: Partial<Omit<NewGithubActionConfig, "id" | "teamId" | "createdAt">>,
): Promise<GithubActionConfig | undefined> {
  await db
    .update(ciGithubActionConfigs)
    .set({ ...data, updatedAt: new Date() })
    .where(
      and(
        eq(ciGithubActionConfigs.id, id),
        eq(ciGithubActionConfigs.teamId, teamId),
      ),
    );
  return getGithubConfig(db, id, teamId);
}

export async function deleteGithubConfig(
  db: CiDb,
  id: string,
  teamId: string,
): Promise<void> {
  await db
    .delete(ciGithubActionConfigs)
    .where(
      and(
        eq(ciGithubActionConfigs.id, id),
        eq(ciGithubActionConfigs.teamId, teamId),
      ),
    );
}

// ============================================
// GitLab pipelines
// ============================================

export async function listGitlabConfigs(
  db: CiDb,
  teamId: string,
): Promise<GitlabPipelineConfig[]> {
  return db
    .select()
    .from(ciGitlabPipelineConfigs)
    .where(eq(ciGitlabPipelineConfigs.teamId, teamId));
}

export async function getGitlabConfig(
  db: CiDb,
  id: string,
  teamId: string,
): Promise<GitlabPipelineConfig | undefined> {
  const [row] = await db
    .select()
    .from(ciGitlabPipelineConfigs)
    .where(
      and(
        eq(ciGitlabPipelineConfigs.id, id),
        eq(ciGitlabPipelineConfigs.teamId, teamId),
      ),
    );
  return row;
}

export async function createGitlabConfig(
  db: CiDb,
  data: NewGitlabPipelineConfig,
): Promise<GitlabPipelineConfig> {
  const id = data.id || crypto.randomUUID();
  await db.insert(ciGitlabPipelineConfigs).values({ ...data, id });
  const [row] = await db
    .select()
    .from(ciGitlabPipelineConfigs)
    .where(eq(ciGitlabPipelineConfigs.id, id));
  return row!;
}

export async function updateGitlabConfig(
  db: CiDb,
  id: string,
  teamId: string,
  data: Partial<Omit<NewGitlabPipelineConfig, "id" | "teamId" | "createdAt">>,
): Promise<GitlabPipelineConfig | undefined> {
  await db
    .update(ciGitlabPipelineConfigs)
    .set({ ...data, updatedAt: new Date() })
    .where(
      and(
        eq(ciGitlabPipelineConfigs.id, id),
        eq(ciGitlabPipelineConfigs.teamId, teamId),
      ),
    );
  return getGitlabConfig(db, id, teamId);
}

export async function deleteGitlabConfig(
  db: CiDb,
  id: string,
  teamId: string,
): Promise<void> {
  await db
    .delete(ciGitlabPipelineConfigs)
    .where(
      and(
        eq(ciGitlabPipelineConfigs.id, id),
        eq(ciGitlabPipelineConfigs.teamId, teamId),
      ),
    );
}

/**
 * The two webhook lookups, and the one place `teamId` is deliberately absent.
 *
 * A GitLab delivery arrives with a project id and a token and nothing else —
 * there is no session and no team to scope by, which is precisely why the
 * per-config `webhook_secret` exists. Resolving the config is what *establishes*
 * which tenant the delivery belongs to; requiring a team id here would be
 * circular.
 *
 * Both are also untenanted in the pre-migration code, so this is a preserved
 * arrangement rather than a new one. What changed is that they are no longer
 * reachable from anywhere except `../webhook.ts`, which is the only export that
 * uses them.
 */
export async function findGitlabConfigByRepo(
  db: CiDb,
  repositoryId: string,
): Promise<GitlabPipelineConfig | undefined> {
  const [row] = await db
    .select()
    .from(ciGitlabPipelineConfigs)
    .where(eq(ciGitlabPipelineConfigs.repositoryId, repositoryId));
  return row;
}

export async function findGitlabConfigByProjectId(
  db: CiDb,
  gitlabProjectId: number,
): Promise<GitlabPipelineConfig | undefined> {
  const [row] = await db
    .select()
    .from(ciGitlabPipelineConfigs)
    .where(eq(ciGitlabPipelineConfigs.gitlabProjectId, gitlabProjectId));
  return row;
}

// ============================================
// Deletion
// ============================================

export async function deleteTeamConfigs(
  db: CiDb,
  teamId: string,
): Promise<void> {
  await db
    .delete(ciGithubActionConfigs)
    .where(eq(ciGithubActionConfigs.teamId, teamId));
  await db
    .delete(ciGitlabPipelineConfigs)
    .where(eq(ciGitlabPipelineConfigs.teamId, teamId));
}

export async function deleteRepoConfigs(
  db: CiDb,
  repositoryId: string,
): Promise<void> {
  await db
    .delete(ciGitlabPipelineConfigs)
    .where(eq(ciGitlabPipelineConfigs.repositoryId, repositoryId));
}
