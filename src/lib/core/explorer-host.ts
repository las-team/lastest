import "server-only";

import type {
  ExplorerExistingAuth,
  ExplorerHost,
  ExplorerIssueContext,
  ExplorerIssueRequest,
  ExplorerIssueResult,
  ExplorerSettings,
} from "@lastest/plugin-explorer";

import * as queries from "@/lib/db/queries";
import { getCurrentSession } from "@/lib/auth";
import { createRepoIssue } from "@/lib/integrations/github-issues";
import { githubNotConnected } from "@/lib/verify/github-connection";
import { decryptField, encrypt, ENC_PREFIX } from "@/lib/crypto";
import {
  assertSafeOutboundUrl,
  SsrfBlockedError,
} from "@/lib/security/outbound-url";
import { findExistingAuthSetup } from "@/lib/core/auth-setup-resolution";

/**
 * The app's fill for `ExplorerHost` — the four core APIs that do not exist
 * yet, plus one config value that should be plugin-owned and is not.
 *
 * Read `plugins/explorer/src/host.ts` for the full history. Three methods
 * that used to live here — `resolveTargetUrl`, `listCoverage` and
 * `createQuarantinedTest` — moved to real capabilities (`ctx.repos`,
 * `ctx.tests`); `emitActivity` moved to `ctx.events`, a provider plugin. What
 * remains is genuinely either a core PR still to be written, or a table that
 * should have moved and did not.
 */

export const appExplorerHost: ExplorerHost = {
  async getSettings(repositoryId: string): Promise<ExplorerSettings> {
    const settings = await queries.getAISettings(repositoryId);
    return {
      maxIterations: settings.explorerMaxIterations ?? 4,
      styleRotation: settings.explorerStyleRotation ?? null,
    };
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

  async issueContext(repositoryId: string): Promise<ExplorerIssueContext> {
    const resolved = await resolveIssueTarget(repositoryId);
    if ("error" in resolved) {
      return {
        connected: false,
        repoFullName: null,
        reporterEmail: null,
        error: resolved.error,
        code: resolved.code,
      };
    }
    const session = await getCurrentSession();
    return {
      connected: true,
      repoFullName: resolved.repo.fullName,
      reporterEmail: session?.user?.email ?? null,
    };
  },

  /**
   * The same POST core makes for a verify case, from the one place that holds
   * the team's GitHub token. The body arrives fully rendered — explorer owns
   * what a finding reads like, core owns the credential and the call.
   */
  async createIssue(req: ExplorerIssueRequest): Promise<ExplorerIssueResult> {
    const resolved = await resolveIssueTarget(req.repositoryId);
    if ("error" in resolved) {
      return { ok: false, error: resolved.error, code: resolved.code };
    }
    const { repo, token } = resolved;

    // Auto-assign the configured AI engineer (Settings → Notifications →
    // Issue Tracker), same as a diff- or verify-filed ticket, so a finding
    // does not need a human dispatcher that the other two surfaces don't.
    const notif = await queries
      .getNotificationSettings(req.repositoryId)
      .catch(() => null);
    const assignees = notif?.issueAssignee ? [notif.issueAssignee] : undefined;

    const result = await createRepoIssue(token, repo.owner, repo.name, {
      title: req.title,
      body: req.body,
      labels: req.labels,
      assignees,
    });
    return result.success && result.issueUrl
      ? {
          ok: true,
          issueUrl: result.issueUrl,
          issueNumber: result.issueNumber,
        }
      : { ok: false, error: result.error ?? "Could not create the issue" };
  },
};

/**
 * Repo + token, or the reason there isn't one.
 *
 * Shared by both issue methods so "can I file?" and "file it" can never
 * disagree — the dialog would otherwise offer a Create button for a repo the
 * POST is about to reject.
 */
async function resolveIssueTarget(repositoryId: string): Promise<
  | {
      repo: { owner: string; name: string; fullName: string };
      token: string;
    }
  | { error: string; code?: string }
> {
  const repo = await queries.getRepository(repositoryId);
  if (!repo) return { error: "Repository not found" };
  if (repo.provider !== "github") {
    return {
      error:
        "Filing issues is only supported for GitHub repositories right now.",
    };
  }
  const account = repo.teamId
    ? await queries.getGithubAccountByTeam(repo.teamId)
    : null;
  if (!account?.accessToken) {
    return { error: githubNotConnected.error, code: githubNotConnected.code };
  }
  return {
    repo: { owner: repo.owner, name: repo.name, fullName: repo.fullName },
    token: account.accessToken,
  };
}
