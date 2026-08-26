import { db } from "./data/db";
import {
  findGitlabConfigByProjectId,
  findGitlabConfigByRepo,
} from "./data/queries";
import type { GitlabPipelineTriggerEvent } from "./schema";

/**
 * The GitLab webhook **gate** — not the webhook route.
 *
 * `src/app/api/webhooks/gitlab/route.ts` stays in the app, and that is the
 * whole point of this file. Costing the alternative (recipe §1.5) is what
 * decided it: moving the handler into the package would have needed
 * `getRepositoryByGitlabProjectId`, `getPullRequestByBranch`,
 * `createPullRequest`, `updatePullRequest`, `createAndRunBuild` and
 * `markWebhookSeen` as host methods — **six more**, taking a 9-method port to
 * 15 and dragging pull-request bookkeeping across a boundary it has no reason
 * to cross.
 *
 * Read the handler and the split is obvious: almost everything it does is
 * core's (repositories, pull requests, builds, replay protection). Exactly four
 * questions are this plugin's, and they are all questions about a *config row*:
 *
 * 1. what shared secret should this delivery have been signed with,
 * 2. is this event type enabled,
 * 3. is this branch in the filter,
 * 4. is delivery `ci_file` (the customer's pipeline triggers the build) or
 *    `webhook` (we trigger it server-side).
 *
 * So the plugin answers those four and the app composes. It is the API-route
 * counterpart of recipe §6's rule for pages — *the plugin owns the placement,
 * the app owns the thing placed* — and the first case in phase 4 where a route
 * was **not** a bare re-export. `launch`'s 16-line route handed the whole
 * request over because every line of it was launch's; this one is the opposite
 * ratio.
 *
 * No session, no team: a delivery arrives from a third party with a project id
 * and a token. Resolving the config is what *establishes* the tenant, so `db()`
 * comes from the wiring slot rather than a context — the same route the
 * deletion hook takes, for the same reason.
 */

export interface GitlabWebhookGate {
  /**
   * The per-config shared secret, or null when there is no config. The caller
   * falls back to `GITLAB_WEBHOOK_SECRET` in that case and does the
   * timing-safe comparison itself — comparing secrets is core's job, and this
   * plugin never sees the presented token.
   */
  readonly expectedSecret: string | null;
  /** `ci_file` means the customer's pipeline triggers the build, not us. */
  readonly deliveryMode: "ci_file" | "webhook" | null;
  /** Is this trigger event enabled for the project? */
  isEventEnabled(event: GitlabPipelineTriggerEvent): boolean;
  /** Is this branch inside the configured filter? Empty filter = allow all. */
  isBranchAllowed(branch: string): boolean;
}

/**
 * What the gate looks like when no config matched. Preserves the
 * pre-migration defaults exactly: an unconfigured project still records merge
 * requests and still triggers builds on push, because `eventEnabled` and
 * `branchAllowed` both took `config: … | undefined` and defaulted.
 */
const UNCONFIGURED: GitlabWebhookGate = {
  expectedSecret: null,
  deliveryMode: null,
  isEventEnabled: (event) => event === "push" || event === "merge_request",
  isBranchAllowed: () => true,
};

export async function resolveGitlabWebhookGate(input: {
  repositoryId?: string | null;
  gitlabProjectId?: number | null;
}): Promise<GitlabWebhookGate> {
  const handle = db();
  const config = input.repositoryId
    ? await findGitlabConfigByRepo(handle, input.repositoryId)
    : typeof input.gitlabProjectId === "number"
      ? await findGitlabConfigByProjectId(handle, input.gitlabProjectId)
      : undefined;

  if (!config) return UNCONFIGURED;

  const events = (config.triggerEvents ?? [
    "push",
    "merge_request",
  ]) as GitlabPipelineTriggerEvent[];
  const filter = config.branchFilter ?? null;

  return {
    expectedSecret: config.webhookSecret ?? null,
    deliveryMode: config.deliveryMode as "ci_file" | "webhook",
    isEventEnabled: (event) => events.includes(event),
    isBranchAllowed: (branch) =>
      !filter || filter.length === 0 || filter.includes(branch),
  };
}
