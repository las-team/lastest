/**
 * Vercel webhook orchestration — the register → run → conclude lifecycle.
 *
 * Kept out of the route handler (which just verifies + dispatches, mirroring
 * src/app/api/webhooks/github/route.ts) so the branching logic is unit-testable
 * and the route stays lean.
 */
import * as queries from "@/lib/db/queries";
import { createAndRunBuildFromCI } from "@/server/actions/builds";
import { registerCheck, updateCheck } from "./checks";
import {
  normalizeDeploymentPayload,
  deploymentTargetUrl,
  type NormalizedVercelDeployment,
} from "./webhooks";
import { startHeartbeat, stopHeartbeat } from "./heartbeat";
import type { VercelProjectConfig, VercelAccount } from "@/lib/db/schema";

function detailsBaseUrl(): string {
  return process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000";
}

/**
 * Does this deployment's target match the config's runOn setting?
 * preview = target !== 'production' (null target = preview).
 */
function targetMatchesRunOn(runOn: string, target: string | null): boolean {
  const isProduction = target === "production";
  if (runOn === "both") return true;
  if (runOn === "production") return isProduction;
  // 'preview' (default)
  return !isProduction;
}

async function loadAccountForConfig(
  config: VercelProjectConfig,
): Promise<VercelAccount | undefined> {
  return queries.getVercelAccountById(config.vercelAccountId);
}

/**
 * `deployment.created` → register a Lastest check on the fresh deployment.
 * Returns a short reason string for logging; never throws.
 */
export async function handleDeploymentCreated(
  payload: Record<string, unknown>,
): Promise<string> {
  const norm = normalizeDeploymentPayload(payload);
  if (!norm.projectId || !norm.deploymentId)
    return "missing project/deployment";

  const config = await queries.getVercelProjectConfigByProjectId(
    norm.projectId,
  );
  if (!config || !config.enabled) return "project not mapped/disabled";
  if (!targetMatchesRunOn(config.runOn, norm.target)) {
    return `target ${norm.target ?? "preview"} does not match runOn ${config.runOn}`;
  }

  const account = await loadAccountForConfig(config);
  if (!account) return "no linked Vercel account";

  const registered = await registerCheck(
    account.accessToken,
    norm.deploymentId,
    account.vercelTeamId ?? null,
    {
      blocking: config.blocking,
      rerequestable: config.rerequestable,
      // Point at Lastest's builds surface until the specific build exists;
      // updated to the exact build URL on completion.
      detailsUrl: `${detailsBaseUrl()}/builds`,
      externalId: norm.deploymentId,
    },
  );
  if (!registered) return "check registration failed";

  await queries.createVercelCheck({
    vercelProjectConfigId: config.id,
    vercelDeploymentId: norm.deploymentId,
    vercelCheckId: registered.id,
    deploymentUrl: norm.deploymentUrl ?? null,
    status: "registered",
  });

  return "check registered";
}

/**
 * `deployment.ready` → flip the check to running and start the Lastest build
 * against the automatic deployment URL.
 */
export async function handleDeploymentReady(
  payload: Record<string, unknown>,
): Promise<string> {
  const norm = normalizeDeploymentPayload(payload);
  if (!norm.deploymentId) return "missing deployment id";

  const check = await queries.getVercelCheckByDeploymentId(norm.deploymentId);
  if (!check || !check.vercelCheckId) return "no registered check";

  const config = await queries.getVercelProjectConfigById(
    check.vercelProjectConfigId,
  );
  if (!config) return "config gone";
  const account = await loadAccountForConfig(config);
  if (!account) return "no linked Vercel account";

  const deploymentUrl = norm.deploymentUrl ?? check.deploymentUrl ?? undefined;
  if (!deploymentUrl) return "no deployment url";

  await updateCheck(
    account.accessToken,
    norm.deploymentId,
    check.vercelCheckId,
    account.vercelTeamId ?? null,
    { status: "running" },
  );

  await queueBuildForCheck({
    checkRowId: check.id,
    config,
    account,
    deploymentId: norm.deploymentId,
    vercelCheckId: check.vercelCheckId,
    deploymentUrl,
    norm,
  });

  return "build queued";
}

/**
 * `deployment.check-rerequested` → re-queue the build and reset the check to
 * running. The rerequested payload only carries deployment.id + check.id, so
 * the deployment URL comes from the stored row.
 */
export async function handleCheckRerequested(
  payload: Record<string, unknown>,
): Promise<string> {
  const norm = normalizeDeploymentPayload(payload);
  const check = norm.checkId
    ? await queries.getVercelCheckByVercelCheckId(norm.checkId)
    : norm.deploymentId
      ? await queries.getVercelCheckByDeploymentId(norm.deploymentId)
      : undefined;
  if (!check || !check.vercelCheckId) return "no matching check";

  const config = await queries.getVercelProjectConfigById(
    check.vercelProjectConfigId,
  );
  if (!config) return "config gone";
  const account = await loadAccountForConfig(config);
  if (!account) return "no linked Vercel account";
  if (!check.deploymentUrl) return "no stored deployment url";

  await updateCheck(
    account.accessToken,
    check.vercelDeploymentId,
    check.vercelCheckId,
    account.vercelTeamId ?? null,
    { status: "running" },
  );

  await queries.updateVercelCheck(check.id, {
    status: "running",
    conclusion: null,
    buildId: null,
  });

  await queueBuildForCheck({
    checkRowId: check.id,
    config,
    account,
    deploymentId: check.vercelDeploymentId,
    vercelCheckId: check.vercelCheckId,
    deploymentUrl: check.deploymentUrl,
    norm,
  });

  return "build re-queued";
}

/**
 * `integration-configuration.removed` → uninstall cleanup. Deleting the account
 * cascades to configs and checks via FK onDelete.
 */
export async function handleConfigurationRemoved(
  payload: Record<string, unknown>,
): Promise<string> {
  const configurationId =
    (payload["configuration"] as { id?: string } | undefined)?.id ??
    (payload["configurationId"] as string | undefined);
  if (!configurationId) return "missing configuration id";
  await queries.deleteVercelAccountByConfigurationId(configurationId);
  return "install removed";
}

interface QueueBuildArgs {
  checkRowId: string;
  config: VercelProjectConfig;
  account: VercelAccount;
  deploymentId: string;
  vercelCheckId: string;
  deploymentUrl: string;
  norm: NormalizedVercelDeployment;
}

/**
 * Create + start a Lastest build for a deployment and wire up the staleness
 * heartbeat. Concludes the check `neutral` when there's nothing to run so the
 * deployment isn't left blocked by an empty suite.
 */
async function queueBuildForCheck(args: QueueBuildArgs): Promise<void> {
  const { config, account, deploymentId, vercelCheckId, deploymentUrl, norm } =
    args;

  const gitBranch =
    norm.meta.githubCommitRef ?? norm.meta.gitlabCommitRef ?? undefined;
  const gitCommit =
    norm.meta.githubCommitSha ?? norm.meta.gitlabCommitSha ?? undefined;

  try {
    const result = await createAndRunBuildFromCI({
      triggerType: "vercel",
      repositoryId: config.repositoryId,
      runnerId: "auto",
      gitBranch,
      gitCommit,
      targetUrl: deploymentTargetUrl(deploymentUrl),
    });

    const buildId = "buildId" in result ? result.buildId : null;
    await queries.updateVercelCheck(args.checkRowId, {
      status: "running",
      buildId,
    });

    if (buildId && config.timeoutMinutes > 0) {
      startHeartbeat({
        checkRowId: args.checkRowId,
        accessToken: account.accessToken,
        deploymentId,
        vercelCheckId,
        teamId: account.vercelTeamId ?? null,
        timeoutMinutes: config.timeoutMinutes,
        onTimeout: async () => {
          await queries.updateVercelCheck(args.checkRowId, {
            status: "completed",
            conclusion: "neutral",
          });
        },
      });
    }
  } catch (error) {
    // Most likely "No tests to run" — conclude neutral so the deploy isn't
    // blocked by a repo with no Lastest tests yet.
    console.error("[vercel] queue build failed:", error);
    stopHeartbeat(args.checkRowId);
    await updateCheck(
      account.accessToken,
      deploymentId,
      vercelCheckId,
      account.vercelTeamId ?? null,
      {
        status: "completed",
        conclusion: "neutral",
        output: {
          summary:
            "Lastest could not start a run for this deployment (no tests configured).",
        },
      },
    );
    await queries.updateVercelCheck(args.checkRowId, {
      status: "completed",
      conclusion: "neutral",
    });
  }
}
