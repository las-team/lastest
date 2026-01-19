import { NextRequest, NextResponse } from 'next/server';
import {
  verifyWebhookSignature,
  isPullRequestEvent,
  isPushEvent,
} from '@/lib/github/webhooks';
import { createAndRunBuild } from '@/server/actions/builds';
import * as queries from '@/lib/db/queries';

export async function POST(request: NextRequest) {
  const signature = request.headers.get('x-hub-signature-256');
  const event = request.headers.get('x-github-event');
  const payload = await request.text();

  // Verify webhook signature (skip in development if no secret set)
  const webhookSecret = process.env.GITHUB_WEBHOOK_SECRET;
  if (webhookSecret && !verifyWebhookSignature(payload, signature)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  const data = JSON.parse(payload);

  try {
    if (event === 'pull_request' && isPullRequestEvent(data)) {
      // Handle pull request events
      if (data.action === 'opened' || data.action === 'synchronize') {
        // Create or update PR record
        const existingPR = await queries.getPullRequestByBranch(data.pull_request.head.ref);

        if (existingPR) {
          await queries.updatePullRequest(existingPR.id, {
            headCommit: data.pull_request.head.sha,
            title: data.pull_request.title,
            status: data.pull_request.state,
          });
        } else {
          await queries.createPullRequest({
            githubPrNumber: data.pull_request.number,
            repoOwner: data.repository.owner.login,
            repoName: data.repository.name,
            headBranch: data.pull_request.head.ref,
            baseBranch: data.pull_request.base.ref,
            headCommit: data.pull_request.head.sha,
            title: data.pull_request.title,
            status: data.pull_request.state,
          });
        }

        // Trigger build
        await createAndRunBuild('webhook');

        return NextResponse.json({ message: 'Build triggered for PR' });
      }

      if (data.action === 'closed') {
        // Update PR status
        const existingPR = await queries.getPullRequestByBranch(data.pull_request.head.ref);
        if (existingPR) {
          await queries.updatePullRequest(existingPR.id, {
            status: data.pull_request.state,
          });
        }
        return NextResponse.json({ message: 'PR status updated' });
      }
    }

    if (event === 'push' && isPushEvent(data)) {
      // Handle push events
      const branch = data.ref.replace('refs/heads/', '');

      // Only trigger for certain branches (configurable)
      const monitoredBranches = (process.env.MONITORED_BRANCHES || 'main,develop').split(',');

      if (monitoredBranches.includes(branch)) {
        await createAndRunBuild('push');
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
