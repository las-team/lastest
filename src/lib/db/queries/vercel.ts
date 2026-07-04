import { db } from "../index";
import { vercelAccounts, vercelProjectConfigs, vercelChecks } from "../schema";
import type {
  VercelAccount,
  NewVercelAccount,
  NewVercelProjectConfig,
  NewVercelCheck,
} from "../schema";
import { encryptField, decryptField } from "@/lib/crypto";
import { eq, and, desc } from "drizzle-orm";

// ============================================
// Vercel accounts (per-team install)
// ============================================

// accessToken is stored encrypted (enc:v1:…). Decrypt on the way out so callers
// always receive a usable OAuth2 integration token.
function withDecryptedToken<T extends VercelAccount | undefined>(row: T): T {
  if (!row) return row;
  return { ...row, accessToken: decryptField(row.accessToken) } as T;
}

export async function getVercelAccountByTeam(teamId: string) {
  const [row] = await db
    .select()
    .from(vercelAccounts)
    .where(eq(vercelAccounts.teamId, teamId));
  return withDecryptedToken(row);
}

export async function getVercelAccountByConfigurationId(
  configurationId: string,
) {
  const [row] = await db
    .select()
    .from(vercelAccounts)
    .where(eq(vercelAccounts.vercelConfigurationId, configurationId));
  return withDecryptedToken(row);
}

export async function getVercelAccountById(id: string) {
  const [row] = await db
    .select()
    .from(vercelAccounts)
    .where(eq(vercelAccounts.id, id));
  return withDecryptedToken(row);
}

/**
 * Upsert by Vercel configuration id — the install flow can fire more than once
 * for the same configuration (re-auth, scope change), so key on the stable
 * configuration id rather than the team.
 */
export async function upsertVercelAccount(
  data: Omit<NewVercelAccount, "id" | "accessToken"> & { accessToken: string },
) {
  const existing = await db
    .select()
    .from(vercelAccounts)
    .where(
      eq(vercelAccounts.vercelConfigurationId, data.vercelConfigurationId!),
    );

  const accessToken = encryptField(data.accessToken);

  if (existing[0]) {
    await db
      .update(vercelAccounts)
      .set({ ...data, accessToken, updatedAt: new Date() })
      .where(eq(vercelAccounts.id, existing[0].id));
    return getVercelAccountById(existing[0].id);
  }

  const id = crypto.randomUUID();
  await db.insert(vercelAccounts).values({ ...data, id, accessToken });
  return getVercelAccountById(id);
}

export async function deleteVercelAccountByConfigurationId(
  configurationId: string,
) {
  // Cascades to vercel_project_configs → vercel_checks via FK onDelete.
  await db
    .delete(vercelAccounts)
    .where(eq(vercelAccounts.vercelConfigurationId, configurationId));
}

export async function deleteVercelAccount(id: string, teamId: string) {
  await db
    .delete(vercelAccounts)
    .where(and(eq(vercelAccounts.id, id), eq(vercelAccounts.teamId, teamId)));
}

// ============================================
// Vercel project configs (per-repo mapping)
// ============================================

export async function getVercelProjectConfigs(teamId: string) {
  return db
    .select()
    .from(vercelProjectConfigs)
    .where(eq(vercelProjectConfigs.teamId, teamId));
}

/** Internal lookup by id (no team scoping) — used by the webhook + reporter. */
export async function getVercelProjectConfigById(id: string) {
  const [row] = await db
    .select()
    .from(vercelProjectConfigs)
    .where(eq(vercelProjectConfigs.id, id));
  return row;
}

export async function getVercelProjectConfig(id: string, teamId: string) {
  const [row] = await db
    .select()
    .from(vercelProjectConfigs)
    .where(
      and(
        eq(vercelProjectConfigs.id, id),
        eq(vercelProjectConfigs.teamId, teamId),
      ),
    );
  return row;
}

/**
 * Look up a mapping by the Vercel project id from a webhook payload. Vercel
 * project ids (`prj_…`) are globally unique to one install, so the first match
 * is the mapping. Returns undefined when the project isn't mapped.
 */
export async function getVercelProjectConfigByProjectId(
  vercelProjectId: string,
) {
  const [row] = await db
    .select()
    .from(vercelProjectConfigs)
    .where(eq(vercelProjectConfigs.vercelProjectId, vercelProjectId));
  return row;
}

export async function createVercelProjectConfig(data: NewVercelProjectConfig) {
  const id = data.id || crypto.randomUUID();
  await db.insert(vercelProjectConfigs).values({ ...data, id });
  const [row] = await db
    .select()
    .from(vercelProjectConfigs)
    .where(eq(vercelProjectConfigs.id, id));
  return row!;
}

export async function updateVercelProjectConfig(
  id: string,
  teamId: string,
  data: Partial<Omit<NewVercelProjectConfig, "id" | "teamId" | "createdAt">>,
) {
  await db
    .update(vercelProjectConfigs)
    .set({ ...data, updatedAt: new Date() })
    .where(
      and(
        eq(vercelProjectConfigs.id, id),
        eq(vercelProjectConfigs.teamId, teamId),
      ),
    );
  return getVercelProjectConfig(id, teamId);
}

export async function deleteVercelProjectConfig(id: string, teamId: string) {
  await db
    .delete(vercelProjectConfigs)
    .where(
      and(
        eq(vercelProjectConfigs.id, id),
        eq(vercelProjectConfigs.teamId, teamId),
      ),
    );
}

// ============================================
// Vercel checks (deployment↔check↔build correlation)
// ============================================

export async function createVercelCheck(data: NewVercelCheck) {
  const id = data.id || crypto.randomUUID();
  await db.insert(vercelChecks).values({ ...data, id });
  const [row] = await db
    .select()
    .from(vercelChecks)
    .where(eq(vercelChecks.id, id));
  return row!;
}

export async function getVercelCheckById(id: string) {
  const [row] = await db
    .select()
    .from(vercelChecks)
    .where(eq(vercelChecks.id, id));
  return row;
}

/** Most recent check row for a deployment (deployment.ready / heartbeat). */
export async function getVercelCheckByDeploymentId(vercelDeploymentId: string) {
  const [row] = await db
    .select()
    .from(vercelChecks)
    .where(eq(vercelChecks.vercelDeploymentId, vercelDeploymentId))
    .orderBy(desc(vercelChecks.createdAt))
    .limit(1);
  return row;
}

/** Look up by the Vercel check id (rerequested webhook carries check.id). */
export async function getVercelCheckByVercelCheckId(vercelCheckId: string) {
  const [row] = await db
    .select()
    .from(vercelChecks)
    .where(eq(vercelChecks.vercelCheckId, vercelCheckId))
    .orderBy(desc(vercelChecks.createdAt))
    .limit(1);
  return row;
}

/** The reporter correlates a finished build back to its Vercel check. */
export async function getVercelCheckByBuildId(buildId: string) {
  const [row] = await db
    .select()
    .from(vercelChecks)
    .where(eq(vercelChecks.buildId, buildId))
    .orderBy(desc(vercelChecks.createdAt))
    .limit(1);
  return row;
}

export async function updateVercelCheck(
  id: string,
  data: Partial<Omit<NewVercelCheck, "id" | "createdAt">>,
) {
  await db
    .update(vercelChecks)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(vercelChecks.id, id));
  return getVercelCheckById(id);
}
