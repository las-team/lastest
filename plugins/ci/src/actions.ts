"use server";

import { orm } from "./data/db";
import * as q from "./data/queries";
import { generateCiYaml } from "./domain/ci-yaml";
import { generateWorkflowYaml } from "./domain/workflow-yaml";
import { ciPlugin } from "./index";
import {
  checkRepoSecretExists,
  deleteRepoSecret,
  deleteWorkflowFile,
  getLatestWorkflowRun,
  getWorkflowFileSha,
  setRepoSecret,
  upsertWorkflowFile,
} from "./providers/github";
import {
  checkProjectVariableExists,
  deleteCiFile,
  deletePipelineSchedule,
  deleteProjectHook,
  deleteProjectVariable,
  getCiFileMeta,
  getLatestPipeline,
  setProjectVariable,
  upsertCiFile,
  upsertPipelineSchedule,
  upsertProjectHook,
} from "./providers/gitlab";
import type {
  GithubActionConfig,
  GithubActionMode,
  GithubActionTriggerEvent,
  GitlabPipelineConfig,
  GitlabPipelineDeliveryMode,
  GitlabPipelineMode,
  GitlabPipelineTriggerEvent,
} from "./schema";
import type {
  DeployPipelineResult,
  DeployWorkflowResult,
  GitlabValidationResult,
  ValidationCheck,
  ValidationResult,
} from "./types";
import { ciWiring } from "./wiring";

/**
 * The CI plugin's server actions — a move of
 * `src/server/actions/{github-actions,gitlab-pipelines}.ts`.
 *
 * A `"use server"` module inside a `transpilePackages` package produces real,
 * dispatchable action ids (spike S1), so these live in the package with no
 * codegen and no shim. Two traps that file has to keep clear of: an
 * `export { x } from "…"` re-export compiles to a module with no exports, and
 * an `export type { … }` compiles to a runtime action export that fails the
 * production build. Hence every action is declared locally and every type comes
 * from `./types`.
 *
 * ### Three exported actions did not survive the move
 *
 * `getGithubActionConfigsAction`, `getGitlabPipelineConfigsAction` and
 * `previewGitlabCiYaml` are gone. All three were `"use server"` exports that
 * **nothing dispatched** — the settings page read the configs through the query
 * layer directly and the two YAML previews are computed client-side — so each
 * was a live RPC endpoint maintained for no caller. The list reads moved to
 * `./reads.ts`, which is the shape a server component actually wants.
 *
 * They were found by recipe §8's action-id count coming back 10 against 13
 * exports. That check is documented as catching the S1 re-export trap; it turns
 * out to catch dead actions too, because Next.js only mints an id for an action
 * reachable from a client boundary.
 *
 * ### Where the team id comes from, and why it is two different places
 *
 * `read()` builds a `PluginContext` with **no scope request**:
 * `resolveScope` falls through to the app's `requireTeamAccess()`, so
 * `ctx.team.id` is a session-authorized tenant that no argument influenced.
 * That is a stronger guarantee than the pre-migration code had *and* one fewer
 * host method than every other user-scoped plugin has needed — nothing here
 * asks the host "who is calling".
 *
 * `admin()` additionally calls `host.requireTeamAdmin()`, which returns the
 * authorized team id. Role is not on `PluginContext` and should not be (RBAC
 * capabilities are core's), so every mutating action starts from that return
 * value and has no other route to a team id. Recipe §3.1: the guard is inside
 * the thing it guards.
 *
 * ### One behaviour change, deliberate
 *
 * `getRunnerById(config.runnerId)` was an **unscoped** read of a core table:
 * the validation panel would happily render the name and status of a runner
 * belonging to another team if a config ever pointed at one. The host's
 * `getRunner(runnerId, teamId)` takes the team, so a cross-team id now renders
 * as "linked runner not found" instead. Nothing legitimate produced such a
 * config, so this is a tightening rather than a fix for an observed bug — but
 * it is a change, and dropping the FK to `runners` is what made it visible.
 */

async function read(): Promise<{
  teamId: string;
  db: ReturnType<typeof orm>;
}> {
  const { runtime } = ciWiring();
  const ctx = await runtime.contextFor(ciPlugin);
  return { teamId: ctx.team.id, db: orm(ctx.data) };
}

async function admin(): Promise<{
  teamId: string;
  db: ReturnType<typeof orm>;
}> {
  const { host, data } = ciWiring();
  const teamId = await host.requireTeamAdmin();
  return { teamId, db: orm(data) };
}

function settingsRevalidate(): void {
  ciWiring().host.revalidate(["/settings"]);
}

/** 32 random bytes, hex — the GitLab project-hook shared secret. */
function randomSecretHex(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

// ============================================
// Shared validation checks
// ============================================

/**
 * "Is this deployment reachable from a third-party CI runner?" — identical on
 * both providers, and the one check that is about *us* rather than about the
 * customer's repository.
 */
async function serverUrlCheck(): Promise<ValidationCheck> {
  const probe = await ciWiring().host.probePublicUrl();
  if (!probe.url || probe.isLoopback) {
    return {
      status: "warn",
      message: `Server URL is "${probe.url ?? "not set"}" — not reachable from CI`,
    };
  }
  if (probe.reachable) {
    return { status: "pass", message: `${probe.url} is reachable` };
  }
  if (probe.status !== null) {
    return {
      status: "fail",
      message: `${probe.url} returned ${probe.status}`,
    };
  }
  return { status: "fail", message: `${probe.url} is not reachable` };
}

async function runnerCheck(
  runnerId: string | null,
  teamId: string,
  mode: string,
): Promise<ValidationCheck> {
  if (!runnerId) {
    return mode === "persistent"
      ? {
          status: "fail",
          message: "No runner assigned (persistent mode requires one)",
        }
      : { status: "pass", message: `${mode} mode — runner created on demand` };
  }
  const runner = await ciWiring().host.getRunner(runnerId, teamId);
  if (!runner) {
    return { status: "fail", message: "Linked runner not found in database" };
  }
  return runner.status === "online"
    ? { status: "pass", message: `Runner "${runner.name}" is online` }
    : {
        status: "warn",
        message: `Runner "${runner.name}" is ${runner.status}`,
      };
}

// ============================================
// GitHub Actions
// ============================================

export async function createGithubActionConfigAction(input: {
  repositoryOwner: string;
  repositoryName: string;
  githubRepoId?: number;
  mode: GithubActionMode;
  runnerId?: string;
  triggerEvents?: GithubActionTriggerEvent[];
  branchFilter?: string[];
  cronSchedule?: string;
  targetUrl?: string;
  timeout?: number;
  failOnChanges?: boolean;
}): Promise<GithubActionConfig> {
  const { teamId, db } = await admin();
  const config = await q.createGithubConfig(db, { teamId, ...input });
  settingsRevalidate();
  return config;
}

export async function updateGithubActionConfigAction(
  id: string,
  input: {
    mode?: GithubActionMode;
    runnerId?: string | null;
    triggerEvents?: GithubActionTriggerEvent[];
    branchFilter?: string[];
    cronSchedule?: string | null;
    targetUrl?: string | null;
    timeout?: number;
    failOnChanges?: boolean;
  },
): Promise<GithubActionConfig | undefined> {
  const { teamId, db } = await admin();
  const config = await q.updateGithubConfig(db, id, teamId, input);
  settingsRevalidate();
  return config;
}

export async function deleteGithubActionConfigAction(
  id: string,
): Promise<{ success: true }> {
  const { host } = ciWiring();
  const { teamId, db } = await admin();
  const config = await q.getGithubConfig(db, id, teamId);
  if (!config) throw new Error("Config not found");

  // Clean up GitHub-side resources if the workflow was deployed. Best-effort —
  // an unreachable GitHub must not block deleting our own row.
  if (config.workflowDeployed) {
    const cred = await host.scmCredentials("github", teamId);
    if (cred) {
      await Promise.allSettled([
        deleteWorkflowFile(
          cred.accessToken,
          config.repositoryOwner,
          config.repositoryName,
        ),
        deleteRepoSecret(
          cred.accessToken,
          config.repositoryOwner,
          config.repositoryName,
          "LASTEST_TOKEN",
        ),
        deleteRepoSecret(
          cred.accessToken,
          config.repositoryOwner,
          config.repositoryName,
          "LASTEST_URL",
        ),
      ]);
    }
  }

  // Auto mode owns the runner it created.
  if ((config.mode as GithubActionMode) === "auto" && config.runnerId) {
    await host.deleteRunner(config.runnerId, teamId);
  }

  await q.deleteGithubConfig(db, id, teamId);
  settingsRevalidate();
  return { success: true };
}

export async function deployWorkflowToGithub(
  configId: string,
): Promise<DeployWorkflowResult> {
  const { host } = ciWiring();
  const { teamId, db } = await admin();
  const config = await q.getGithubConfig(db, configId, teamId);
  if (!config) throw new Error("Config not found");

  const cred = await host.scmCredentials("github", teamId);
  if (!cred) throw new Error("No GitHub account connected");

  const yaml = generateWorkflowYaml({
    mode: config.mode as GithubActionMode,
    repositoryOwner: config.repositoryOwner,
    repositoryName: config.repositoryName,
    triggerEvents: (config.triggerEvents ?? [
      "push",
      "pull_request",
      "workflow_dispatch",
    ]) as GithubActionTriggerEvent[],
    branchFilter: (config.branchFilter ?? ["main"]) as string[],
    cronSchedule: config.cronSchedule,
    targetUrl: config.targetUrl,
    timeout: config.timeout ?? 300000,
    failOnChanges: config.failOnChanges ?? false,
  });

  const results: DeployWorkflowResult = {
    workflow: false,
    tokenSecret: false,
    urlSecret: false,
  };

  // 1. Push the workflow file.
  const existingSha = await getWorkflowFileSha(
    cred.accessToken,
    config.repositoryOwner,
    config.repositoryName,
  );
  await upsertWorkflowFile(
    cred.accessToken,
    config.repositoryOwner,
    config.repositoryName,
    yaml,
    existingSha,
  );
  results.workflow = true;

  // 2. Secrets. Auto mode mints a runner on **every** deploy — that is the
  //    pre-migration behaviour and it is preserved deliberately, even though
  //    the GitLab side below only mints when there is not one yet. The two
  //    differ, they always have, and reconciling them is a product decision
  //    rather than a migration's to make (RFC §2: this is a move).
  //    Persistent mode rolls the token of the runner already assigned. Either
  //    way the plaintext token exists only for the length of this function.
  let runnerToken: string | null = null;
  let runnerId: string | null = config.runnerId ?? null;

  if ((config.mode as GithubActionMode) === "auto") {
    const created = await host.createRunner({
      name: `gha-auto-${config.repositoryOwner}/${config.repositoryName}`,
      teamId,
    });
    if ("error" in created)
      throw new Error(`Failed to create runner: ${created.error}`);
    runnerToken = created.token;
    runnerId = created.runnerId;
  } else if (runnerId) {
    const regen = await host.regenerateRunnerToken(runnerId, teamId);
    if ("error" in regen)
      throw new Error(`Failed to regenerate runner token: ${regen.error}`);
    runnerToken = regen.token;
  }

  if (runnerToken) {
    await setRepoSecret(
      cred.accessToken,
      config.repositoryOwner,
      config.repositoryName,
      "LASTEST_TOKEN",
      runnerToken,
    );
    results.tokenSecret = true;

    await setRepoSecret(
      cred.accessToken,
      config.repositoryOwner,
      config.repositoryName,
      "LASTEST_URL",
      host.publicAppUrl(),
    );
    results.urlSecret = true;
  }

  await q.updateGithubConfig(db, configId, teamId, {
    runnerId: runnerId ?? undefined,
    workflowDeployed: true,
    lastDeployedAt: new Date(),
  });

  settingsRevalidate();
  return results;
}

export async function validateGithubActionSetup(
  configId: string,
): Promise<ValidationResult> {
  const { host } = ciWiring();
  const { teamId, db } = await read();
  const config = await q.getGithubConfig(db, configId, teamId);
  if (!config) throw new Error("Config not found");

  const result: ValidationResult = {
    githubAccount: { status: "skip", message: "" },
    workflowFile: { status: "skip", message: "" },
    secretToken: { status: "skip", message: "" },
    secretUrl: { status: "skip", message: "" },
    runner: { status: "skip", message: "" },
    serverUrl: { status: "skip", message: "" },
    lastRun: { status: "skip", message: "" },
  };

  const cred = await host.scmCredentials("github", teamId);
  if (!cred) {
    result.githubAccount = {
      status: "fail",
      message: "No GitHub account connected",
    };
    const skip: ValidationCheck = {
      status: "skip",
      message: "Requires GitHub account",
    };
    result.workflowFile = skip;
    result.secretToken = skip;
    result.secretUrl = skip;
    result.lastRun = skip;
  } else {
    result.githubAccount = {
      status: "pass",
      message: `Connected as ${cred.username ?? "unknown"}`,
    };

    const [workflowResult, tokenResult, urlResult, runResult] =
      await Promise.allSettled([
        getWorkflowFileSha(
          cred.accessToken,
          config.repositoryOwner,
          config.repositoryName,
        ),
        checkRepoSecretExists(
          cred.accessToken,
          config.repositoryOwner,
          config.repositoryName,
          "LASTEST_TOKEN",
        ),
        checkRepoSecretExists(
          cred.accessToken,
          config.repositoryOwner,
          config.repositoryName,
          "LASTEST_URL",
        ),
        getLatestWorkflowRun(
          cred.accessToken,
          config.repositoryOwner,
          config.repositoryName,
        ),
      ]);

    result.workflowFile =
      workflowResult.status === "fulfilled"
        ? workflowResult.value
          ? { status: "pass", message: "Workflow file exists" }
          : { status: "fail", message: "Workflow file not found in repo" }
        : {
            status: "fail",
            message: `API error: ${workflowResult.reason?.message || "Unknown"}`,
          };

    result.secretToken =
      tokenResult.status === "fulfilled"
        ? tokenResult.value
          ? { status: "pass", message: "Secret is set" }
          : { status: "fail", message: "LASTEST_TOKEN secret not found" }
        : {
            status: "fail",
            message: `API error: ${tokenResult.reason?.message || "Unknown"}`,
          };

    result.secretUrl =
      urlResult.status === "fulfilled"
        ? urlResult.value
          ? { status: "pass", message: "Secret is set" }
          : { status: "fail", message: "LASTEST_URL secret not found" }
        : {
            status: "fail",
            message: `API error: ${urlResult.reason?.message || "Unknown"}`,
          };

    if (runResult.status === "fulfilled") {
      const run = runResult.value;
      if (!run) {
        result.lastRun = {
          status: "warn",
          message: "No workflow runs found yet",
        };
      } else if (run.conclusion === "success") {
        result.lastRun = {
          status: "pass",
          message: `Last run succeeded (${new Date(run.createdAt).toLocaleDateString()})`,
        };
      } else if (run.status === "in_progress" || run.status === "queued") {
        result.lastRun = { status: "warn", message: `Run ${run.status}` };
      } else {
        result.lastRun = {
          status: "fail",
          message: `Last run: ${run.conclusion || run.status} (${new Date(run.createdAt).toLocaleDateString()})`,
        };
      }
    } else {
      result.lastRun = {
        status: "warn",
        message: "Could not fetch workflow runs",
      };
    }
  }

  result.runner = await runnerCheck(
    config.runnerId ?? null,
    teamId,
    config.mode,
  );
  result.serverUrl = await serverUrlCheck();

  return result;
}

// ============================================
// GitLab pipelines
// ============================================

export async function createGitlabPipelineConfigAction(input: {
  repositoryId?: string | null;
  projectPath: string;
  gitlabProjectId?: number;
  mode: GitlabPipelineMode;
  deliveryMode?: GitlabPipelineDeliveryMode;
  runnerId?: string;
  triggerEvents?: GitlabPipelineTriggerEvent[];
  branchFilter?: string[];
  cronSchedule?: string;
  timeout?: number;
  failOnChanges?: boolean;
}): Promise<GitlabPipelineConfig> {
  const { teamId, db } = await admin();
  const config = await q.createGitlabConfig(db, { teamId, ...input });
  settingsRevalidate();
  return config;
}

export async function updateGitlabPipelineConfigAction(
  id: string,
  input: {
    mode?: GitlabPipelineMode;
    deliveryMode?: GitlabPipelineDeliveryMode;
    runnerId?: string | null;
    triggerEvents?: GitlabPipelineTriggerEvent[];
    branchFilter?: string[];
    cronSchedule?: string | null;
    timeout?: number;
    failOnChanges?: boolean;
  },
): Promise<GitlabPipelineConfig | undefined> {
  const { teamId, db } = await admin();
  const config = await q.updateGitlabConfig(db, id, teamId, input);
  settingsRevalidate();
  return config;
}

export async function deleteGitlabPipelineConfigAction(
  id: string,
): Promise<{ success: true }> {
  const { host } = ciWiring();
  const { teamId, db } = await admin();
  const config = await q.getGitlabConfig(db, id, teamId);
  if (!config) throw new Error("Config not found");

  if (config.pipelineDeployed) {
    const cred = await host.scmCredentials("gitlab", teamId);
    if (cred && config.gitlabProjectId) {
      const instanceUrl = cred.instanceUrl || "https://gitlab.com";
      const hookUrl = `${host.publicAppUrl()}/api/webhooks/gitlab`;
      await Promise.allSettled([
        config.deliveryMode === "ci_file"
          ? deleteCiFile(
              cred.accessToken,
              instanceUrl,
              config.gitlabProjectId,
              "main",
            )
          : Promise.resolve(),
        deleteProjectVariable(
          cred.accessToken,
          instanceUrl,
          config.gitlabProjectId,
          "LASTEST_TOKEN",
        ),
        deleteProjectVariable(
          cred.accessToken,
          instanceUrl,
          config.gitlabProjectId,
          "LASTEST_URL",
        ),
        deleteProjectHook(
          cred.accessToken,
          instanceUrl,
          config.gitlabProjectId,
          hookUrl,
        ),
        deletePipelineSchedule(
          cred.accessToken,
          instanceUrl,
          config.gitlabProjectId,
        ),
      ]);
    }
  }

  if ((config.mode as GitlabPipelineMode) === "auto" && config.runnerId) {
    await host.deleteRunner(config.runnerId, teamId);
  }

  await q.deleteGitlabConfig(db, id, teamId);
  settingsRevalidate();
  return { success: true };
}

export async function deployPipelineToGitlab(
  configId: string,
): Promise<DeployPipelineResult> {
  const { host } = ciWiring();
  const { teamId, db } = await admin();
  const config = await q.getGitlabConfig(db, configId, teamId);
  if (!config) throw new Error("Config not found");

  const cred = await host.scmCredentials("gitlab", teamId);
  if (!cred) throw new Error("No GitLab account connected");
  const instanceUrl = cred.instanceUrl || "https://gitlab.com";
  if (!config.gitlabProjectId)
    throw new Error("Config is missing gitlabProjectId");

  const results: DeployPipelineResult = {
    ciFile: false,
    tokenVar: false,
    urlVar: false,
    hook: false,
    schedule: false,
  };

  // 1. CI file — only in `ci_file` delivery mode. `webhook` mode deliberately
  //    edits nothing in the customer's repository.
  if (config.deliveryMode === "ci_file") {
    const yaml = generateCiYaml({
      mode: config.mode as GitlabPipelineMode,
      projectPath: config.projectPath,
      triggerEvents: (config.triggerEvents ?? [
        "push",
        "merge_request",
      ]) as GitlabPipelineTriggerEvent[],
      branchFilter: (config.branchFilter ?? ["main"]) as string[],
      timeout: config.timeout ?? 300000,
      failOnChanges: config.failOnChanges ?? true,
    });
    // Default to `main`. GitLab projects almost always have it, and falling
    // back to API discovery is overkill when a redeploy fixes the odd case.
    await upsertCiFile(
      cred.accessToken,
      instanceUrl,
      config.gitlabProjectId,
      "main",
      yaml,
    );
    results.ciFile = true;
  }

  // 2. Project variables.
  let runnerToken: string | null = null;
  let runnerId: string | null = config.runnerId ?? null;

  if ((config.mode as GitlabPipelineMode) === "auto" && !runnerId) {
    const created = await host.createRunner({
      name: `glp-auto-${config.projectPath}`,
      teamId,
    });
    if ("error" in created)
      throw new Error(`Failed to create runner: ${created.error}`);
    runnerToken = created.token;
    runnerId = created.runnerId;
  } else if (runnerId) {
    const regen = await host.regenerateRunnerToken(runnerId, teamId);
    if ("error" in regen)
      throw new Error(`Failed to regenerate runner token: ${regen.error}`);
    runnerToken = regen.token;
  }

  if (runnerToken) {
    await setProjectVariable(
      cred.accessToken,
      instanceUrl,
      config.gitlabProjectId,
      "LASTEST_TOKEN",
      runnerToken,
      { masked: true },
    );
    results.tokenVar = true;

    await setProjectVariable(
      cred.accessToken,
      instanceUrl,
      config.gitlabProjectId,
      "LASTEST_URL",
      host.publicAppUrl(),
      { masked: false },
    );
    results.urlVar = true;
  }

  // 3. Project hook — mint a per-config secret if there is not one yet.
  //    32 bytes of Web Crypto randomness, the same entropy as the
  //    `crypto.randomBytes(32)` this replaces; global `crypto` rather than a
  //    `node:crypto` import keeps the package free of a Node built-in it needs
  //    for one line.
  const webhookSecret = config.webhookSecret || randomSecretHex();
  const triggerEvents = (config.triggerEvents ?? [
    "push",
    "merge_request",
  ]) as GitlabPipelineTriggerEvent[];
  await upsertProjectHook(
    cred.accessToken,
    instanceUrl,
    config.gitlabProjectId,
    `${host.publicAppUrl()}/api/webhooks/gitlab`,
    webhookSecret,
    {
      push: triggerEvents.includes("push"),
      merge_request: triggerEvents.includes("merge_request"),
    },
  );
  results.hook = true;

  // 4. Pipeline schedule.
  if (triggerEvents.includes("schedule") && config.cronSchedule) {
    await upsertPipelineSchedule(
      cred.accessToken,
      instanceUrl,
      config.gitlabProjectId,
      config.cronSchedule,
      "main",
    );
    results.schedule = true;
  }

  await q.updateGitlabConfig(db, configId, teamId, {
    runnerId: runnerId ?? undefined,
    webhookSecret,
    pipelineDeployed: true,
    lastDeployedAt: new Date(),
  });

  settingsRevalidate();
  return results;
}

export async function validateGitlabPipelineSetup(
  configId: string,
): Promise<GitlabValidationResult> {
  const { host } = ciWiring();
  const { teamId, db } = await read();
  const config = await q.getGitlabConfig(db, configId, teamId);
  if (!config) throw new Error("Config not found");

  const result: GitlabValidationResult = {
    gitlabAccount: { status: "skip", message: "" },
    ciFile: { status: "skip", message: "" },
    variableToken: { status: "skip", message: "" },
    variableUrl: { status: "skip", message: "" },
    runner: { status: "skip", message: "" },
    serverUrl: { status: "skip", message: "" },
    lastPipeline: { status: "skip", message: "" },
  };

  const cred = await host.scmCredentials("gitlab", teamId);
  if (!cred) {
    result.gitlabAccount = {
      status: "fail",
      message: "No GitLab account connected",
    };
    const skip: ValidationCheck = {
      status: "skip",
      message: "Requires GitLab account",
    };
    result.ciFile = skip;
    result.variableToken = skip;
    result.variableUrl = skip;
    result.lastPipeline = skip;
  } else if (!config.gitlabProjectId) {
    result.gitlabAccount = {
      status: "pass",
      message: `Connected as @${cred.username ?? "unknown"}`,
    };
    result.ciFile = {
      status: "fail",
      message: "Config has no gitlabProjectId",
    };
  } else {
    const instanceUrl = cred.instanceUrl || "https://gitlab.com";
    result.gitlabAccount = {
      status: "pass",
      message: `Connected as @${cred.username ?? "unknown"} on ${instanceUrl}`,
    };

    const [ciFileResult, tokenVarResult, urlVarResult, lastPipelineResult] =
      await Promise.allSettled([
        config.deliveryMode === "ci_file"
          ? getCiFileMeta(
              cred.accessToken,
              instanceUrl,
              config.gitlabProjectId,
              "main",
            )
          : Promise.resolve(null),
        checkProjectVariableExists(
          cred.accessToken,
          instanceUrl,
          config.gitlabProjectId,
          "LASTEST_TOKEN",
        ),
        checkProjectVariableExists(
          cred.accessToken,
          instanceUrl,
          config.gitlabProjectId,
          "LASTEST_URL",
        ),
        getLatestPipeline(
          cred.accessToken,
          instanceUrl,
          config.gitlabProjectId,
        ),
      ]);

    if (config.deliveryMode === "ci_file") {
      result.ciFile =
        ciFileResult.status === "fulfilled"
          ? ciFileResult.value
            ? { status: "pass", message: ".gitlab-ci.yml exists" }
            : { status: "fail", message: ".gitlab-ci.yml not found in repo" }
          : {
              status: "fail",
              message: `API error: ${ciFileResult.reason?.message || "Unknown"}`,
            };
    } else {
      result.ciFile = {
        status: "pass",
        message: "webhook delivery mode (no CI file expected)",
      };
    }

    result.variableToken =
      tokenVarResult.status === "fulfilled"
        ? tokenVarResult.value
          ? { status: "pass", message: "LASTEST_TOKEN variable is set" }
          : { status: "fail", message: "LASTEST_TOKEN variable not found" }
        : {
            status: "fail",
            message: `API error: ${tokenVarResult.reason?.message || "Unknown"}`,
          };

    result.variableUrl =
      urlVarResult.status === "fulfilled"
        ? urlVarResult.value
          ? { status: "pass", message: "LASTEST_URL variable is set" }
          : { status: "fail", message: "LASTEST_URL variable not found" }
        : {
            status: "fail",
            message: `API error: ${urlVarResult.reason?.message || "Unknown"}`,
          };

    if (lastPipelineResult.status === "fulfilled") {
      const p = lastPipelineResult.value;
      if (!p) {
        result.lastPipeline = {
          status: "warn",
          message: "No pipelines found yet",
        };
      } else if (p.status === "success") {
        result.lastPipeline = {
          status: "pass",
          message: `Last pipeline succeeded (${new Date(p.created_at).toLocaleDateString()})`,
        };
      } else if (
        p.status === "running" ||
        p.status === "pending" ||
        p.status === "created"
      ) {
        result.lastPipeline = {
          status: "warn",
          message: `Pipeline ${p.status}`,
        };
      } else {
        result.lastPipeline = {
          status: "fail",
          message: `Last pipeline: ${p.status}`,
        };
      }
    } else {
      result.lastPipeline = {
        status: "warn",
        message: "Could not fetch pipelines",
      };
    }
  }

  result.runner = await runnerCheck(
    config.runnerId ?? null,
    teamId,
    config.mode,
  );
  result.serverUrl = await serverUrlCheck();

  return result;
}
