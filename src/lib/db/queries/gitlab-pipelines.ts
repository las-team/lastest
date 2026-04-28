import { db } from '../index';
import { gitlabPipelineConfigs } from '../schema';
import type { NewGitlabPipelineConfig } from '../schema';
import { eq, and } from 'drizzle-orm';

export async function getGitlabPipelineConfigs(teamId: string) {
  return db
    .select()
    .from(gitlabPipelineConfigs)
    .where(eq(gitlabPipelineConfigs.teamId, teamId));
}

export async function getGitlabPipelineConfig(id: string, teamId: string) {
  const [row] = await db
    .select()
    .from(gitlabPipelineConfigs)
    .where(and(eq(gitlabPipelineConfigs.id, id), eq(gitlabPipelineConfigs.teamId, teamId)));
  return row;
}

export async function getGitlabPipelineConfigByRepo(repositoryId: string) {
  const [row] = await db
    .select()
    .from(gitlabPipelineConfigs)
    .where(eq(gitlabPipelineConfigs.repositoryId, repositoryId));
  return row;
}

export async function getGitlabPipelineConfigByProjectId(gitlabProjectId: number) {
  const [row] = await db
    .select()
    .from(gitlabPipelineConfigs)
    .where(eq(gitlabPipelineConfigs.gitlabProjectId, gitlabProjectId));
  return row;
}

export async function createGitlabPipelineConfig(data: NewGitlabPipelineConfig) {
  const id = data.id || crypto.randomUUID();
  await db.insert(gitlabPipelineConfigs).values({ ...data, id });
  const [row] = await db.select().from(gitlabPipelineConfigs).where(eq(gitlabPipelineConfigs.id, id));
  return row!;
}

export async function updateGitlabPipelineConfig(
  id: string,
  teamId: string,
  data: Partial<Omit<NewGitlabPipelineConfig, 'id' | 'teamId' | 'createdAt'>>,
) {
  await db
    .update(gitlabPipelineConfigs)
    .set({ ...data, updatedAt: new Date() })
    .where(and(eq(gitlabPipelineConfigs.id, id), eq(gitlabPipelineConfigs.teamId, teamId)));
  const [row] = await db
    .select()
    .from(gitlabPipelineConfigs)
    .where(and(eq(gitlabPipelineConfigs.id, id), eq(gitlabPipelineConfigs.teamId, teamId)));
  return row;
}

export async function deleteGitlabPipelineConfig(id: string, teamId: string) {
  await db
    .delete(gitlabPipelineConfigs)
    .where(and(eq(gitlabPipelineConfigs.id, id), eq(gitlabPipelineConfigs.teamId, teamId)));
}
