import "server-only";

import { rm } from "node:fs/promises";
import path from "node:path";

import type {
  ConnectorDetail,
  ConnectorSecrets,
  ConnectorSummary,
  EnvironmentDetail,
  MigrationActor,
  ResolvedEndpoints,
  VeevaMigrationHost,
} from "@lastest/plugin-veeva-migration/host";
import { MIGRATION_LOCKED_MESSAGE } from "@lastest/plugin-veeva-migration";

import { getCurrentSession } from "@/lib/auth";
import { requireRepoCapability } from "@/lib/auth/capabilities";
import * as queries from "@/lib/db/queries";
import { STORAGE_ROOT } from "@/lib/storage/paths";

/**
 * The app's fill for `VeevaMigrationHost`.
 *
 * Five adapters, no new behaviour — each is a call the pre-plugin
 * `src/server/actions/migrations.ts` made inline, moved to the side of the
 * boundary that is allowed to make it. Two are worth reading closely.
 *
 * ### `assertRepoSettingsAccess` is three gates in one call
 *
 * The old action had `guardRepo` + `guardProject` + `hasMigrationAccess`
 * spread over three modules, and a new action could satisfy two of the three
 * and look right. Collapsing them into the port means the plugin cannot check
 * the capability and forget the Early-Adopter gate, or vice versa: there is one
 * door.
 *
 * ### `runArtifactRoot` is the replacement for a free-text column
 *
 * `migration_projects.run_dir` was saved by a settings action with no
 * validation and handed to the engine, which called `fs.mkdir` on it — so any
 * member with `repos:settings` could aim the extract's multi-gigabyte writes at
 * any path the app user could reach. The path is now **derived here**, from
 * this app's own storage root plus the team and project ids, and the plugin
 * cannot influence it beyond naming the project it already holds. The ids are
 * both app-generated (`crypto.randomUUID`, and the team id from core), so no
 * user-supplied string enters the path at all; the `assertSafe` check below is
 * belt-and-braces against a future caller passing something stranger.
 *
 * Bytes do not go through `core/storage` because the engine streams extract
 * pages to CSV and reads them back with `createReadStream`, in gigabytes — a
 * put/get blob API cannot express that. The tenancy property that mattered is
 * preserved by the derivation.
 */

const MIGRATION_STORAGE_DIR = path.join(STORAGE_ROOT, "migrations");

/** Reject anything that could escape the migrations root. */
function assertSafeSegment(value: string, what: string): string {
  if (!/^[A-Za-z0-9_.-]+$/.test(value) || value === "." || value === "..") {
    throw new Error(`Refusing to build a run directory: ${what} is not an id`);
  }
  return value;
}

function toEnvironmentDetail(
  env:
    | {
        id: string;
        label: string;
        releaseLabel: string | null;
        refreshedAt: Date | null;
      }
    | null
    | undefined,
): EnvironmentDetail | null {
  if (!env) return null;
  return {
    id: env.id,
    label: env.label,
    releaseLabel: env.releaseLabel ?? null,
    refreshedAt: env.refreshedAt ?? null,
  };
}

type ConnectorRow = Awaited<ReturnType<typeof queries.listConnectors>>[number];

function toConnectorDetail(row: ConnectorRow): ConnectorDetail {
  return {
    id: row.id,
    name: row.name,
    label: row.label,
    type: row.type,
    authMethod: row.authMethod,
    config: row.config,
    environmentId: row.environmentId ?? null,
    environment: toEnvironmentDetail(row.environment),
    lastVerifiedAt: row.lastVerifiedAt ?? null,
    lastVerifyError: row.lastVerifyError ?? null,
  };
}

export const appVeevaMigrationHost: VeevaMigrationHost = {
  async assertRepoSettingsAccess(
    repositoryId: string,
  ): Promise<MigrationActor> {
    const session = await requireRepoCapability(repositoryId, "repos:settings");
    if (!session.team?.earlyAdopterMode) {
      throw new Error(MIGRATION_LOCKED_MESSAGE);
    }
    const userId = session.user?.id ?? (await getCurrentSession())?.user?.id;
    if (!userId) throw new Error("Forbidden: no signed-in user");
    if (!session.team?.id) throw new Error("Forbidden: no team");
    return { userId, teamId: session.team.id };
  },

  async resolveConnectorSecrets(
    connectorId: string,
  ): Promise<ConnectorSecrets> {
    let resolved;
    try {
      resolved = await queries.getConnectorForConnection(connectorId);
    } catch {
      // Not a bug when it happens — `ENCRYPTION_KEY` was rotated without
      // running the rotation script, or the row was restored from a backup
      // taken under a different key. The operator needs the one sentence that
      // tells them what to do, not a 500 with a cipher stack trace.
      throw new Error(
        "The connector's stored credential could not be read. It was encrypted with a different ENCRYPTION_KEY than this deployment holds — re-enter it under Settings → Integrations, or run the key-rotation script.",
      );
    }
    if (!resolved) throw new Error("Connector not found");
    return {
      type: resolved.connector.type,
      authMethod: resolved.connector.authMethod,
      secrets: resolved.secrets,
    };
  },

  async resolveEndpoints(
    repositoryId: string,
    ids: { sourceConnectorId: string | null; targetConnectorId: string | null },
  ): Promise<ResolvedEndpoints> {
    const wanted = [ids.sourceConnectorId, ids.targetConnectorId].filter(
      (x): x is string => Boolean(x),
    );
    if (wanted.length === 0) {
      return {
        source: null,
        target: null,
        sourceEnvironment: null,
        targetEnvironment: null,
      };
    }
    // Listed by repository rather than fetched by id: that is the ownership
    // check (recipe §3.1 — the guard lives in the port method), so a connector
    // id from another repository simply does not appear.
    const rows = await queries.listConnectors(repositoryId);
    const byId = new Map(rows.map((r) => [r.id, r]));
    const source = ids.sourceConnectorId
      ? byId.get(ids.sourceConnectorId)
      : undefined;
    const target = ids.targetConnectorId
      ? byId.get(ids.targetConnectorId)
      : undefined;
    return {
      source: source ? toConnectorDetail(source) : null,
      target: target ? toConnectorDetail(target) : null,
      sourceEnvironment: toEnvironmentDetail(source?.environment),
      targetEnvironment: toEnvironmentDetail(target?.environment),
    };
  },

  async listConnectors(
    repositoryId: string,
    types: readonly string[],
  ): Promise<readonly ConnectorSummary[]> {
    const rows = await queries.listConnectors(repositoryId);
    return rows
      .filter((r) => types.length === 0 || types.includes(r.type))
      .map(toConnectorDetail);
  },

  runArtifactRoot(teamId: string, projectId: string): string {
    return path.join(
      MIGRATION_STORAGE_DIR,
      assertSafeSegment(teamId, "team id"),
      assertSafeSegment(projectId, "project id"),
    );
  },

  async removeArtifacts(teamId: string, projectId?: string): Promise<void> {
    const dir =
      projectId === undefined
        ? path.join(MIGRATION_STORAGE_DIR, assertSafeSegment(teamId, "team id"))
        : appVeevaMigrationHost.runArtifactRoot(teamId, projectId);
    await rm(dir, { recursive: true, force: true });
  },
};
