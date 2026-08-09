import "server-only";

import type {
  ExplorerActivityEvent,
  ExplorerCoverage,
  ExplorerExistingAuth,
  ExplorerHost,
  ExplorerSettings,
  KeptTestInput,
} from "@lastest/plugin-explorer";

import * as queries from "@/lib/db/queries";
import { emitAndPersistActivityEvent } from "@/lib/db/queries/activity-events";
import { decryptField, encrypt, ENC_PREFIX } from "@/lib/crypto";
import { getLogger } from "@/lib/logger";
import {
  assertSafeOutboundUrl,
  SsrfBlockedError,
} from "@/lib/security/outbound-url";
import { findExistingAuthSetup } from "@/lib/qa-agent/auth";
import type { ActivityEventType } from "@/lib/db/schema";

/**
 * The app's fill for `ExplorerHost` — seven core APIs that do not exist yet.
 *
 * Read `plugins/explorer/src/host.ts` for what each one is and which core
 * module should own it. This file is the *other* half of that statement: it is
 * the code that will be deleted, method by method, as those core modules land.
 *
 * Nothing here is clever, and that is deliberate. Each method is the thinnest
 * possible adapter over what the app already does, so that when the equivalent
 * moves into core there is no logic to re-derive — only a call site to change.
 *
 * The honest summary, stated once: **explorer still reads core tables, through
 * this file.** What the migration bought is that the reads are now seven named
 * methods instead of forty scattered call sites, and the plugin cannot add an
 * eighth without a diff that says so.
 */

const log = getLogger("explorer-host");

export const appExplorerHost: ExplorerHost = {
  async getSettings(repositoryId: string): Promise<ExplorerSettings> {
    const settings = await queries.getAISettings(repositoryId);
    return {
      maxIterations: settings.explorerMaxIterations ?? 4,
      styleRotation: settings.explorerStyleRotation ?? null,
    };
  },

  async resolveTargetUrl(
    repositoryId: string,
    branch?: string | null,
  ): Promise<string | null> {
    const repo = await queries.getRepository(repositoryId).catch(() => null);
    const branchBaseUrls = (repo?.branchBaseUrls ?? {}) as Record<
      string,
      string
    >;
    const preferred = branch ?? repo?.defaultBranch ?? null;
    const fromBranch = preferred ? branchBaseUrls[preferred] : undefined;
    if (fromBranch) return fromBranch;
    if (branchBaseUrls.main) return branchBaseUrls.main;
    const anyBranch = Object.values(branchBaseUrls)[0];
    if (anyBranch) return anyBranch;
    const env = await queries
      .getEnvironmentConfig(repositoryId)
      .catch(() => null);
    return env?.baseUrl ?? null;
  },

  async resolveExistingAuth(
    repositoryId: string,
  ): Promise<ExplorerExistingAuth> {
    const existing = await findExistingAuthSetup(repositoryId);
    // Only the id crosses the boundary. `storage_states.storageStateJson` never
    // leaves this process — `BrowserHost.applyAuth` resolves and injects it.
    return {
      storageStateId: existing.storageStateId,
      setupTestId: existing.setupTestId,
      defaultSetupInUse: existing.defaultSetupInUse,
    };
  },

  async listCoverage(repositoryId: string): Promise<ExplorerCoverage> {
    const [tests, areas] = await Promise.all([
      queries.getTestsByRepo(repositoryId).catch(() => []),
      queries.getFunctionalAreasTree(repositoryId).catch(() => []),
    ]);

    // Plans can live on nested areas, so the tree is flattened rather than
    // only its roots being read.
    const areaPlans: Array<{ name: string; plan: string }> = [];
    const walk = (nodes: typeof areas) => {
      for (const node of nodes) {
        if (node.agentPlan)
          areaPlans.push({ name: node.name, plan: node.agentPlan });
        if (node.children?.length) walk(node.children);
      }
    };
    walk(areas);

    return {
      tests: tests.map((t) => ({ name: t.name, targetUrl: t.targetUrl })),
      areaPlans,
    };
  },

  async createQuarantinedTest(input: KeptTestInput): Promise<{ id: string }> {
    const areas = await queries
      .getFunctionalAreasByRepo(input.repositoryId)
      .catch(() => []);
    const existing = areas.find((a) => a.name === input.areaName);
    const area =
      existing ??
      (await queries.createFunctionalArea({
        repositoryId: input.repositoryId,
        name: input.areaName,
      }));

    const test = await queries.createTest({
      repositoryId: input.repositoryId,
      functionalAreaId: area.id,
      name: input.name,
      code: input.code,
      targetUrl: input.targetUrl,
      // Machine-authored code is never trusted into a suite unreviewed.
      quarantined: true,
    });
    return { id: test.id };
  },

  emitActivity(event: ExplorerActivityEvent): void {
    void emitAndPersistActivityEvent({
      teamId: event.teamId,
      repositoryId: event.repositoryId,
      sessionId: event.sessionId,
      sourceType: "explorer_agent",
      eventType: event.type as ActivityEventType,
      summary: event.summary,
      stepId: event.stepId ?? null,
      agentType: "explorer",
      detail: event.detail ?? null,
      artifactType: event.artifact?.type ?? null,
      artifactId: event.artifact?.id ?? null,
      artifactLabel: event.artifact?.label ?? null,
      durationMs: null,
      promptLogId: null,
      // An activity event is a notification. Failing the exploration that
      // produced it because the feed write failed would be the wrong trade.
    }).catch((err) => log.warn({ err }, "explorer activity emit failed"));
  },

  async assertSafeOutboundUrl(url: string): Promise<void> {
    try {
      await assertSafeOutboundUrl(url);
    } catch (err) {
      if (err instanceof SsrfBlockedError) {
        throw new Error(`URL rejected: ${err.message}`);
      }
      throw err;
    }
  },

  /**
   * AES-256-GCM, with the same two invariants the rest of the app's field
   * crypto holds: the prefix check makes encrypt-on-write idempotent, and
   * decrypt passes unrecognised plaintext straight through so rows written
   * before encryption existed still read.
   */
  encryptField(plaintext: string): string {
    return plaintext.startsWith(ENC_PREFIX) ? plaintext : encrypt(plaintext);
  },

  decryptField(stored: string): string {
    return decryptField(stored);
  },
};
