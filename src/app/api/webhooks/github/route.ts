import { NextRequest, NextResponse } from 'next/server';
import {
  verifyWebhookSignature,
  isPullRequestEvent,
  isPushEvent,
} from '@/lib/github/webhooks';
import { createAndRunBuild } from '@/server/actions/builds';
import { mergeBaselinesFromBranch, cleanupBranchBaselines, promoteTestVersionsFromBranch } from '@/server/actions/baselines';
import * as queries from '@/lib/db/queries';

/**
 * Resolve the internal repository ID from a GitHub webhook payload.
 */
async function resolveRepositoryId(data: { repository?: { id?: number } }): Promise<string | undefined> {
  const githubRepoId = data.repository?.id;
  if (!githubRepoId) return undefined;

  const repo = await queries.getRepositoryByGithubId(githubRepoId);
  return repo?.id;
}

export async function POST(request: NextRequest) {
  const signature = request.headers.get('x-hub-signature-256');
  const event = request.headers.get('x-github-event');
  const payload = await request.text();

  // Verify webhook signature (mandatory)
  const webhookSecret = process.env.GITHUB_WEBHOOK_SECRET;
  if (!webhookSecret) {
    console.error('[webhook] GITHUB_WEBHOOK_SECRET is not configured');
    return NextResponse.json({ error: 'Webhook not configured' }, { status: 500 });
  }
  if (!verifyWebhookSignature(payload, signature)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  const data = JSON.parse(payload);

  // Sanitize webhook string fields to prevent injection
  function sanitizeStr(val: unknown, maxLen = 500): string {
    if (typeof val !== 'string') return '';
    return val.replace(/[^\x20-\x7E]/g, '').slice(0, maxLen);
  }

  try {
    if (event === 'pull_request' && isPullRequestEvent(data)) {
      const repositoryId = await resolveRepositoryId(data);

      // Handle pull request events
      if (data.action === 'opened' || data.action === 'synchronize') {
        // Create or update PR record
        const existingPR = await queries.getPullRequestByBranch(data.pull_request.head.ref);

        if (existingPR) {
          await queries.updatePullRequest(existingPR.id, {
            headCommit: sanitizeStr(data.pull_request.head.sha, 40),
            title: sanitizeStr(data.pull_request.title, 300),
            status: sanitizeStr(data.pull_request.state, 20),
          });
        } else {
          await queries.createPullRequest({
            githubPrNumber: data.pull_request.number,
            repoOwner: sanitizeStr(data.repository.owner.login, 100),
            repoName: sanitizeStr(data.repository.name, 100),
            headBranch: sanitizeStr(data.pull_request.head.ref, 250),
            baseBranch: sanitizeStr(data.pull_request.base.ref, 250),
            headCommit: sanitizeStr(data.pull_request.head.sha, 40),
            title: sanitizeStr(data.pull_request.title, 300),
            status: sanitizeStr(data.pull_request.state, 20),
          });
        }

        // Trigger build for PR
        await createAndRunBuild('webhook', undefined, repositoryId);

        return NextResponse.json({ message: 'Build triggered for PR' });
      }

      if (data.action === 'closed') {
        // Update PR status
        const existingPR = await queries.getPullRequestByBranch(data.pull_request.head.ref);
        if (existingPR) {
          await queries.updatePullRequest(existingPR.id, {
            status: data.pull_request.merged ? 'merged' : 'closed',
          });
        }

        // If PR was merged, promote branch baselines to target branch and cleanup
        if (data.pull_request.merged && repositoryId) {
          const headBranch = data.pull_request.head.ref;
          const baseBranch = data.pull_request.base.ref;

          try {
            await mergeBaselinesFromBranch(repositoryId, headBranch, baseBranch);
            await promoteTestVersionsFromBranch(repositoryId, headBranch);
            await cleanupBranchBaselines(repositoryId, headBranch);
            console.log(`[webhook] Merged baselines + test versions from ${headBranch} → ${baseBranch} and cleaned up`);
          } catch (error) {
            console.error('[webhook] Failed to merge/cleanup baselines:', error);
          }
        }

        return NextResponse.json({ message: 'PR status updated' });
      }
    }

    if (event === 'push' && isPushEvent(data)) {
      // Handle push events
      const branch = data.ref.replace('refs/heads/', '');
      const repositoryId = await resolveRepositoryId(data);

      // Only trigger for certain branches (configurable)
      const monitoredBranches = (process.env.MONITORED_BRANCHES || 'main,develop').split(',');

      if (monitoredBranches.includes(branch)) {
        await createAndRunBuild('push', undefined, repositoryId);
        return NextResponse.json({ message: 'Build triggered for push' });
      }

      return NextResponse.json({ message: 'Branch not monitored' });
    }

    // Ping event (used when setting up webhook)
    if (event === 'ping') {
      return NextResponse.json({ message: 'Pong!' });
    }

    return NextResponse.json({ message: 'Event ignored' });
  } catch (error) {
    console.error('Webhook error:', error);
    return NextResponse.json({ error: 'Webhook processing failed' }, { status: 500 });
  }
}
