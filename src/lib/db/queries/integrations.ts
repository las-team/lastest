import { db } from "../index";
import { encryptField, decryptField } from "@/lib/crypto";
import {
  encryptSessionMetadata,
  decryptSessionMetadata,
} from "@/lib/crypto-fields";
import {
  specImports,
  googleSheetsAccounts,
  composeConfigs,
  agentSessions,
} from "../schema";
import type {
  NewSpecImport,
  NewGoogleSheetsAccount,
  NewComposeConfig,
  NewAgentSession,
  AgentSessionKind,
  AgentSessionStatus,
  AgentStepState,
  AgentStepId,
  AgentSessionMetadata,
} from "../schema";
import { eq, desc, and, or, isNotNull, lt, count } from "drizzle-orm";
import { v4 as uuid } from "uuid";

// Spec Imports
export async function createSpecImport(
  data: Omit<NewSpecImport, "id" | "createdAt">,
) {
  const id = uuid();
  const now = new Date();
  await db.insert(specImports).values({ ...data, id, createdAt: now });
  return { id, ...data, createdAt: now };
}

export async function updateSpecImport(
  id: string,
  data: Partial<
    Pick<
      NewSpecImport,
      | "status"
      | "extractedStories"
      | "areasCreated"
      | "testsCreated"
      | "error"
      | "completedAt"
    >
  >,
) {
  await db.update(specImports).set(data).where(eq(specImports.id, id));
}

export async function getSpecImport(id: string) {
  const [row] = await db
    .select()
    .from(specImports)
    .where(eq(specImports.id, id));
  return row;
}

export async function getSpecImportsByRepo(repositoryId: string) {
  return db
    .select()
    .from(specImports)
    .where(eq(specImports.repositoryId, repositoryId))
    .orderBy(desc(specImports.createdAt));
}

export async function getLatestSpecImportForRepo(repositoryId: string) {
  return db
    .select()
    .from(specImports)
    .where(
      and(
        eq(specImports.repositoryId, repositoryId),
        eq(specImports.status, "completed"),
        isNotNull(specImports.extractedStories),
      ),
    )
    .orderBy(desc(specImports.createdAt))
    .limit(1)
    .then((rows) => rows[0] ?? null);
}

// ============================================
// Google Sheets Data Sources
// ============================================

export async function getGoogleSheetsAccount(teamId?: string | null) {
  if (!teamId) return null;
  const [row] = await db
    .select()
    .from(googleSheetsAccounts)
    .where(eq(googleSheetsAccounts.teamId, teamId));
  if (!row) return null;
  return {
    ...row,
    accessToken: decryptField(row.accessToken),
    refreshToken: decryptField(row.refreshToken),
  };
}

export async function upsertGoogleSheetsAccount(data: {
  teamId: string;
  googleUserId: string;
  googleEmail: string;
  googleName?: string | null;
  accessToken: string;
  refreshToken?: string | null;
  tokenExpiresAt?: Date | null;
}) {
  const [existing] = await db
    .select()
    .from(googleSheetsAccounts)
    .where(eq(googleSheetsAccounts.teamId, data.teamId));

  if (existing) {
    await db
      .update(googleSheetsAccounts)
      .set({
        googleUserId: data.googleUserId,
        googleEmail: data.googleEmail,
        googleName: data.googleName,
        accessToken: encryptField(data.accessToken),
        refreshToken: encryptField(
          data.refreshToken || decryptField(existing.refreshToken),
        ),
        tokenExpiresAt: data.tokenExpiresAt,
      })
      .where(eq(googleSheetsAccounts.id, existing.id));
    return { ...existing, ...data };
  }

  const id = uuid();
  const newAccount: NewGoogleSheetsAccount = {
    id,
    teamId: data.teamId,
    googleUserId: data.googleUserId,
    googleEmail: data.googleEmail,
    googleName: data.googleName,
    accessToken: encryptField(data.accessToken),
    refreshToken: encryptField(data.refreshToken),
    tokenExpiresAt: data.tokenExpiresAt,
    createdAt: new Date(),
  };

  await db.insert(googleSheetsAccounts).values(newAccount);
  return {
    ...newAccount,
    accessToken: data.accessToken,
    refreshToken: data.refreshToken,
  };
}

export async function updateGoogleSheetsAccountTokens(
  accountId: string,
  accessToken: string,
  tokenExpiresAt: Date,
) {
  await db
    .update(googleSheetsAccounts)
    .set({ accessToken: encryptField(accessToken), tokenExpiresAt })
    .where(eq(googleSheetsAccounts.id, accountId));
}

export async function deleteGoogleSheetsAccount(teamId: string) {
  // Does not touch plugins/data-sources' rows — imported data sources are
  // left in place, the same way disconnecting GitHub does not delete a
  // repo's CI config. See `DataSourcesHost.disconnectGoogleSheets`.
  const account = await getGoogleSheetsAccount(teamId);
  if (account) {
    await db
      .delete(googleSheetsAccounts)
      .where(eq(googleSheetsAccounts.id, account.id));
  }
}

// Data source rows (googleSheetsDataSources / csvDataSources) moved to
// plugins/data-sources/src/schema.ts (RFC §9 phase 4, twelfth plugin). See
// docs/architecture/data-sources-migration-result.md.

// ============================================
// Compose Configs
// ============================================

export async function getComposeConfig(repositoryId: string, branch: string) {
  const [row] = await db
    .select()
    .from(composeConfigs)
    .where(
      and(
        eq(composeConfigs.repositoryId, repositoryId),
        eq(composeConfigs.branch, branch),
      ),
    );
  return row ?? null;
}

export async function upsertComposeConfig(
  repositoryId: string,
  branch: string,
  data: {
    selectedTestIds: string[];
    excludedTestIds: string[];
    versionOverrides: Record<string, string>;
  },
) {
  const [existing] = await db
    .select()
    .from(composeConfigs)
    .where(
      and(
        eq(composeConfigs.repositoryId, repositoryId),
        eq(composeConfigs.branch, branch),
      ),
    );

  if (existing) {
    await db
      .update(composeConfigs)
      .set({
        selectedTestIds: data.selectedTestIds,
        excludedTestIds: data.excludedTestIds,
        versionOverrides: data.versionOverrides,
        updatedAt: new Date(),
      })
      .where(eq(composeConfigs.id, existing.id));
    return { ...existing, ...data, updatedAt: new Date() };
  } else {
    const id = uuid();
    const newConfig: NewComposeConfig = {
      id,
      repositoryId,
      branch,
      selectedTestIds: data.selectedTestIds,
      excludedTestIds: data.excludedTestIds,
      versionOverrides: data.versionOverrides,
      updatedAt: new Date(),
    };
    await db.insert(composeConfigs).values(newConfig);
    return newConfig;
  }
}

// ============================================
// Agent Sessions
// ============================================

// QuickStart can run against the user's OWN app with their real login. When
// supplied, the password lands in agent_sessions.metadata.quickstartPassword,
// so it is encrypted at rest via the shared helpers in @/lib/crypto-fields —
// encrypt on write, decrypt on read at this query layer so every consumer (and
// mergeMetadata's read-merge-rewrite cycle) works with plaintext. The email is
// left plaintext (low-sensitivity identifier shown in the QuickStart UI).
// Exported for `./agents-fleet.ts`, which runs its own cross-kind selects and
// must apply the same decrypt-on-read as every reader in this module.
export function decryptAgentSessionRow<
  T extends { metadata: AgentSessionMetadata },
>(row: T): T {
  return { ...row, metadata: decryptSessionMetadata(row.metadata) };
}

export async function createAgentSession(data: Omit<NewAgentSession, "id">) {
  const id = uuid();
  const now = new Date();
  await db.insert(agentSessions).values({
    ...data,
    metadata: encryptSessionMetadata(data.metadata),
    id,
    createdAt: now,
    updatedAt: now,
  });
  const [row] = await db
    .select()
    .from(agentSessions)
    .where(eq(agentSessions.id, id));
  return decryptAgentSessionRow(row!);
}

export async function getAgentSession(id: string) {
  const [row] = await db
    .select()
    .from(agentSessions)
    .where(eq(agentSessions.id, id));
  return row ? decryptAgentSessionRow(row) : row;
}

export async function getActiveAgentSession(
  repositoryId: string,
  kind: AgentSessionKind = "play",
) {
  // Opportunistic sweep so a stale "active" row doesn't keep the activity
  // feed spinning forever. Cheap when there's nothing to do.
  await sweepStuckAgentSessions().catch(() => {
    /* sweep is best-effort */
  });

  const [row] = await db
    .select()
    .from(agentSessions)
    .where(
      and(
        eq(agentSessions.repositoryId, repositoryId),
        eq(agentSessions.kind, kind),
        or(
          eq(agentSessions.status, "active"),
          eq(agentSessions.status, "paused"),
        ),
      ),
    )
    .orderBy(desc(agentSessions.createdAt));
  return row ? decryptAgentSessionRow(row) : row;
}

/** Most recent session of a kind for a repo, regardless of status. Used by
 *  the QA Agent page to show the last run's summary after completion. */
export async function getLatestAgentSession(
  repositoryId: string,
  kind: AgentSessionKind,
) {
  const [row] = await db
    .select()
    .from(agentSessions)
    .where(
      and(
        eq(agentSessions.repositoryId, repositoryId),
        eq(agentSessions.kind, kind),
      ),
    )
    .orderBy(desc(agentSessions.createdAt))
    .limit(1);
  return row ? decryptAgentSessionRow(row) : row;
}

/** Recent sessions of a kind for a repo, newest first (any status). Used by
 *  the QA agent's segmented modes to locate the latest stored plan. */
export async function getRecentAgentSessions(
  repositoryId: string,
  kind: AgentSessionKind,
  limit = 10,
) {
  const rows = await db
    .select()
    .from(agentSessions)
    .where(
      and(
        eq(agentSessions.repositoryId, repositoryId),
        eq(agentSessions.kind, kind),
      ),
    )
    .orderBy(desc(agentSessions.createdAt))
    .limit(limit);
  return rows.map(decryptAgentSessionRow);
}

export async function updateAgentSession(
  id: string,
  data: {
    status?: AgentSessionStatus;
    currentStepId?: AgentStepId;
    steps?: AgentStepState[];
    metadata?: AgentSessionMetadata;
    completedAt?: Date;
  },
) {
  const patch =
    data.metadata !== undefined
      ? { ...data, metadata: encryptSessionMetadata(data.metadata) }
      : data;
  await db
    .update(agentSessions)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(agentSessions.id, id));
}

/** Count a team's currently-active sessions of a kind across all its repos.
 *  Used by the scheduled-trigger dispatchers to cap fan-out per team. */
export async function countActiveAgentSessionsForTeam(
  teamId: string,
  kind: AgentSessionKind,
): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(agentSessions)
    .where(
      and(
        eq(agentSessions.teamId, teamId),
        eq(agentSessions.kind, kind),
        eq(agentSessions.status, "active"),
      ),
    );
  return row?.value ?? 0;
}

/** Compare-and-set a session's status: applies only while the row still holds
 *  `from`, so two concurrent callers (e.g. a double resume) can't both win.
 *  Returns true when this call performed the transition. */
export async function transitionAgentSessionStatus(
  id: string,
  from: AgentSessionStatus,
  to: AgentSessionStatus,
  extra?: { steps?: AgentStepState[]; completedAt?: Date },
): Promise<boolean> {
  const rows = await db
    .update(agentSessions)
    .set({ status: to, ...extra, updatedAt: new Date() })
    .where(and(eq(agentSessions.id, id), eq(agentSessions.status, from)))
    .returning({ id: agentSessions.id });
  return rows.length > 0;
}

// Stuck-detection sweep. An active session whose `updatedAt` hasn't moved in
// `idleMs` is treated as abandoned (process crash, network drop, infinite
// hourglass) and flipped to `failed` so the activity feed stops showing the
// "Reconnecting..." spinner. Lazy by design — call from existing read paths
// (no new background scheduler).
//
// Default 1h. Returns the count of sessions that were swept.
export async function sweepStuckAgentSessions(idleMs: number = 60 * 60 * 1000) {
  const cutoff = new Date(Date.now() - idleMs);
  const stuck = await db
    .select()
    .from(agentSessions)
    .where(
      and(
        eq(agentSessions.status, "active"),
        lt(agentSessions.updatedAt, cutoff),
      ),
    );
  if (stuck.length === 0) return 0;

  const now = new Date();
  for (const s of stuck) {
    const steps: AgentStepState[] = (s.steps ?? []).map((step) =>
      step.status === "active" || step.status === "waiting_user"
        ? {
            ...step,
            status: "failed" as const,
            error: "Session timed out — no progress for over an hour.",
          }
        : step,
    );
    await db
      .update(agentSessions)
      .set({
        status: "failed",
        steps,
        completedAt: now,
        updatedAt: now,
      })
      .where(eq(agentSessions.id, s.id));
  }
  return stuck.length;
}
