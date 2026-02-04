import { NextRequest, NextResponse } from 'next/server';
import { createAndRunBuild } from '@/server/actions/builds';
import * as queries from '@/lib/db/queries';

const GITLAB_WEBHOOK_SECRET = process.env.GITLAB_WEBHOOK_SECRET || '';

/**
 * Verify GitLab webhook token
 * GitLab uses a simple token header, not HMAC signature
 */
function verifyWebhookToken(token: string | null): boolean {
  if (!GITLAB_WEBHOOK_SECRET) return true; // Skip in development if no secret set
  return token === GITLAB_WEBHOOK_SECRET;
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

  const data = JSON.parse(payload);

  try {
    if (isMergeRequestEvent(data)) {
      // Handle merge request events
      const { object_attributes: mr, project } = data;
      const [namespace, projectName] = project.path_with_namespace.split('/');

      if (mr.action === 'open' || mr.action === 'update' || mr.action === 'reopen') {
        // Create or update MR record
        const existingMR = await queries.getPullRequestByBranch(mr.source_branch);

        if (existingMR) {
          await queries.updatePullRequest(existingMR.id, {
            headCommit: mr.last_commit.id,
            title: mr.title,
            status: mr.state === 'opened' ? 'open' : mr.state,
          });
        } else {
          await queries.createPullRequest({
            provider: 'gitlab',
            gitlabMrIid: mr.iid,
            gitlabProjectId: project.id,
            repoOwner: namespace,
            repoName: projectName,
            headBranch: mr.source_branch,
            baseBranch: mr.target_branch,
            headCommit: mr.last_commit.id,
            title: mr.title,
            status: mr.state === 'opened' ? 'open' : mr.state,
          });
        }

        // Trigger build
        await createAndRunBuild('webhook');

        return NextResponse.json({ message: 'Build triggered for MR' });
      }

      if (mr.action === 'close' || mr.action === 'merge') {
        // Update MR status
        const existingMR = await queries.getPullRequestByBranch(mr.source_branch);
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
      const branch = data.ref.replace('refs/heads/', '');

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
