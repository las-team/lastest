import { db } from '../index';
import { githubActionConfigs } from '../schema';
import type { NewGithubActionConfig } from '../schema';
import { eq, and } from 'drizzle-orm';

export async function getGithubActionConfigs(teamId: string) {
  return db
    .select()
    .from(githubActionConfigs)
    .where(eq(githubActionConfigs.teamId, teamId))
    .all();
}

export async function getGithubActionConfig(id: string, teamId: string) {
  return db
    .select()
    .from(githubActionConfigs)
    .where(and(eq(githubActionConfigs.id, id), eq(githubActionConfigs.teamId, teamId)))
    .get();
}

export async function createGithubActionConfig(data: NewGithubActionConfig) {
  const id = data.id || crypto.randomUUID();
  await db.insert(githubActionConfigs).values({ ...data, id });
  return db.select().from(githubActionConfigs).where(eq(githubActionConfigs.id, id)).get()!;
}

export async function updateGithubActionConfig(
  id: string,
  teamId: string,
  data: Partial<Omit<NewGithubActionConfig, 'id' | 'teamId' | 'createdAt'>>,
) {
  await db
    .update(githubActionConfigs)
    .set({ ...data, updatedAt: new Date() })
    .where(and(eq(githubActionConfigs.id, id), eq(githubActionConfigs.teamId, teamId)));
  return db
    .select()
    .from(githubActionConfigs)
    .where(and(eq(githubActionConfigs.id, id), eq(githubActionConfigs.teamId, teamId)))
    .get();
}

export async function deleteGithubActionConfig(id: string, teamId: string) {
  await db
    .delete(githubActionConfigs)
    .where(and(eq(githubActionConfigs.id, id), eq(githubActionConfigs.teamId, teamId)));
}
