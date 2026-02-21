import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { createAndRunBuild } from '@/server/actions/builds';
import * as queries from '@/lib/db/queries';

const GITLAB_WEBHOOK_SECRET = process.env.GITLAB_WEBHOOK_SECRET || '';

/**
 * Verify GitLab webhook token using timing-safe comparison.
 * GitLab uses a simple token header, not HMAC signature.
 */
function verifyWebhookToken(token: string | null): boolean {
  if (!GITLAB_WEBHOOK_SECRET || !token) return false;
  const expected = Buffer.from(GITLAB_WEBHOOK_SECRET);
  const received = Buffer.from(token);
  if (expected.length !== received.length) return false;
  return crypto.timingSafeEqual(expected, received);
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

export async function POST(request: NextRequest) {
  const token = request.headers.get('x-gitlab-token');
  const eventType = request.headers.get('x-gitlab-event');
  const payload = await request.text();

  // Verify webhook token
  if (!verifyWebhookToken(token)) {
    return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
  }

  let data: unknown;
  try {
    data = JSON.parse(payload);
  } catch {
    return NextResponse.json({ error: 'Malformed JSON' }, { status: 400 });
  }

  try {
    if (isMergeRequestEvent(data)) {
      // Handle merge request events
      const { object_attributes: mr, project } = data;
      const pathParts = sanitizeStr(project.path_with_namespace, 200).split('/');
      const namespace = pathParts[0] || '';
      const projectName = pathParts.slice(1).join('/') || '';

      if (mr.action === 'open' || mr.action === 'update' || mr.action === 'reopen') {
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

        // Trigger build
        await createAndRunBuild('webhook');

        return NextResponse.json({ message: 'Build triggered for MR' });
      }

      if (mr.action === 'close' || mr.action === 'merge') {
        // Update MR status
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
      // Handle push events
      const branch = sanitizeStr(data.ref, 500).replace('refs/heads/', '');

      // Only trigger for certain branches (configurable)
      const monitoredBranches = (process.env.MONITORED_BRANCHES || 'main,master,develop').split(',');

      if (monitoredBranches.includes(branch)) {
        await createAndRunBuild('push');
        return NextResponse.json({ message: 'Build triggered for push' });
      }

      return NextResponse.json({ message: 'Branch not monitored' });
    }

    // Handle other GitLab events if needed
    if (eventType === 'System Hook' || eventType === 'Push Hook' || eventType === 'Merge Request Hook') {
      // Already handled above
    }

    return NextResponse.json({ message: 'Event ignored' });
  } catch (error) {
    console.error('GitLab webhook error:', error);
    return NextResponse.json({ error: 'Webhook processing failed' }, { status: 500 });
  }
}
