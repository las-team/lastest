import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { createAndRunBuild } from '@/server/actions/builds';
import * as queries from '@/lib/db/queries';
import type { GitlabPipelineConfig, GitlabPipelineTriggerEvent } from '@/lib/db/schema';

const ENV_GITLAB_WEBHOOK_SECRET = process.env.GITLAB_WEBHOOK_SECRET || '';

/**
 * Verify GitLab webhook token using timing-safe comparison.
 * Prefers per-config webhookSecret if available, falls back to env.
 */
function verifyWebhookToken(token: string | null, expected: string | null): boolean {
  if (!expected || !token) return false;
  const e = Buffer.from(expected);
  const r = Buffer.from(token);
  if (e.length !== r.length) return false;
  return crypto.timingSafeEqual(e, r);
}

/** Sanitize webhook string fields to prevent injection */
function sanitizeStr(val: unknown, maxLen = 500): string {
  if (typeof val !== 'string') return '';
  return val.replace(/[^\x20-\x7E]/g, '').slice(0, maxLen);
}

interface MergeRequestEvent {
  object_kind: 'merge_request';
  object_attributes: {
    iid: number;
    title: string;
    state: 'opened' | 'closed' | 'merged';
    source_branch: string;
    target_branch: string;
    last_commit: { id: string };
    action: 'open' | 'close' | 'reopen' | 'update' | 'merge';
  };
  project: {
    id: number;
    path_with_namespace: string;
  };
}

interface PushEvent {
  object_kind: 'push';
  ref: string;
  after: string;
  before: string;
  project: {
    id: number;
    path_with_namespace: string;
  };
}

function isMergeRequestEvent(event: unknown): event is MergeRequestEvent {
  return (
    typeof event === 'object' &&
    event !== null &&
    'object_kind' in event &&
    (event as { object_kind: string }).object_kind === 'merge_request' &&
    'object_attributes' in event
  );
}

function isPushEvent(event: unknown): event is PushEvent {
  return (
    typeof event === 'object' &&
    event !== null &&
    'object_kind' in event &&
    (event as { object_kind: string }).object_kind === 'push' &&
    'ref' in event
  );
}

function eventEnabled(config: GitlabPipelineConfig | undefined, event: GitlabPipelineTriggerEvent): boolean {
  const events = (config?.triggerEvents ?? ['push', 'merge_request']) as GitlabPipelineTriggerEvent[];
  return events.includes(event);
}

function branchAllowed(config: GitlabPipelineConfig | undefined, branch: string): boolean {
  const filter = config?.branchFilter ?? null;
  if (!filter || filter.length === 0) return true; // no filter = allow all
  return filter.includes(branch);
}

export async function POST(request: NextRequest) {
  const token = request.headers.get('x-gitlab-token');
  const eventType = request.headers.get('x-gitlab-event');
  const payload = await request.text();

  let data: unknown;
  try {
    data = JSON.parse(payload);
  } catch {
    return NextResponse.json({ error: 'Malformed JSON' }, { status: 400 });
  }

  // Pull project id from either MR or push payload to resolve the repo + per-config secret
  const projectId =
    (data as { project?: { id?: number } } | null)?.project?.id ??
    null;

  let repo: Awaited<ReturnType<typeof queries.getRepositoryByGitlabProjectId>> | null = null;
  let config: GitlabPipelineConfig | undefined;
  if (typeof projectId === 'number') {
    repo = await queries.getRepositoryByGitlabProjectId(projectId);
    if (repo) {
      config = await queries.getGitlabPipelineConfigByRepo(repo.id);
    } else {
      config = await queries.getGitlabPipelineConfigByProjectId(projectId);
    }
  }

  // Verify webhook token: per-config secret takes priority, else env fallback
  const expectedSecret = config?.webhookSecret || ENV_GITLAB_WEBHOOK_SECRET || null;
  if (!verifyWebhookToken(token, expectedSecret)) {
    return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
  }

  if (!repo) {
    return NextResponse.json({ message: 'Unknown project — no matching repository' });
  }

  try {
    if (isMergeRequestEvent(data)) {
      const { object_attributes: mr, project } = data;
      const pathParts = sanitizeStr(project.path_with_namespace, 200).split('/');
      const namespace = pathParts[0] || '';
      const projectName = pathParts.slice(1).join('/') || '';

      if (mr.action === 'open' || mr.action === 'update' || mr.action === 'reopen') {
        if (!eventEnabled(config, 'merge_request')) {
          return NextResponse.json({ message: 'merge_request events disabled by config' });
        }
        const sourceBranch = sanitizeStr(mr.source_branch, 250);

        // Create or update MR record
        const existingMR = await queries.getPullRequestByBranch(sourceBranch);
        if (existingMR) {
          await queries.updatePullRequest(existingMR.id, {
            headCommit: sanitizeStr(mr.last_commit.id, 40),
            title: sanitizeStr(mr.title, 300),
            status: mr.state === 'opened' ? 'open' : mr.state,
          });
        } else {
          await queries.createPullRequest({
            provider: 'gitlab',
            gitlabMrIid: mr.iid,
            gitlabProjectId: project.id,
            repoOwner: sanitizeStr(namespace, 100),
            repoName: sanitizeStr(projectName, 100),
            headBranch: sourceBranch,
            baseBranch: sanitizeStr(mr.target_branch, 250),
            headCommit: sanitizeStr(mr.last_commit.id, 40),
            title: sanitizeStr(mr.title, 300),
            status: mr.state === 'opened' ? 'open' : mr.state,
          });
        }

        if (!branchAllowed(config, sourceBranch)) {
          return NextResponse.json({ message: 'Branch not in filter' });
        }

        // For 'webhook' delivery mode (or no config) trigger the build server-side.
        // For 'ci_file' mode the user's pipeline runs the runner — we still record
        // MR state above but skip the redundant server-side build.
        if (config?.deliveryMode === 'ci_file') {
          return NextResponse.json({ message: 'MR recorded (ci_file mode — pipeline will trigger build)' });
        }

        await createAndRunBuild('webhook', undefined, repo.id, undefined, undefined, sourceBranch);
        return NextResponse.json({ message: 'Build triggered for MR' });
      }

      if (mr.action === 'close' || mr.action === 'merge') {
        const existingMR = await queries.getPullRequestByBranch(sanitizeStr(mr.source_branch, 250));
        if (existingMR) {
          await queries.updatePullRequest(existingMR.id, {
            status: mr.state,
          });
        }
        return NextResponse.json({ message: 'MR status updated' });
      }
    }

    if (isPushEvent(data)) {
      if (!eventEnabled(config, 'push')) {
        return NextResponse.json({ message: 'push events disabled by config' });
      }
      const branch = sanitizeStr(data.ref, 500).replace('refs/heads/', '');
      if (!branchAllowed(config, branch)) {
        return NextResponse.json({ message: 'Branch not monitored' });
      }
      if (config?.deliveryMode === 'ci_file') {
        return NextResponse.json({ message: 'Push noted (ci_file mode — pipeline will trigger build)' });
      }
      await createAndRunBuild('push', undefined, repo.id, undefined, undefined, branch);
      return NextResponse.json({ message: 'Build triggered for push' });
    }

    if (eventType === 'System Hook') {
      // System hooks not yet handled
    }

    return NextResponse.json({ message: 'Event ignored' });
  } catch (error) {
    console.error('GitLab webhook error:', error);
    return NextResponse.json({ error: 'Webhook processing failed' }, { status: 500 });
  }
}
