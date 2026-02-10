import crypto from 'crypto';

const WEBHOOK_SECRET = process.env.GITHUB_WEBHOOK_SECRET || '';

export function verifyWebhookSignature(payload: string, signature: string | null): boolean {
  if (!signature || !WEBHOOK_SECRET) return false;

  const hmac = crypto.createHmac('sha256', WEBHOOK_SECRET);
  const digest = 'sha256=' + hmac.update(payload).digest('hex');

  try {
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(digest));
  } catch {
    return false;
  }
}

export interface PullRequestEvent {
  action: 'opened' | 'synchronize' | 'closed' | 'reopened';
  number: number;
  pull_request: {
    number: number;
    title: string;
    state: string;
    merged?: boolean;
    head: {
      ref: string;
      sha: string;
    };
    base: {
      ref: string;
    };
  };
  repository: {
    id?: number;
    name: string;
    owner: {
      login: string;
    };
  };
}

export interface PushEvent {
  ref: string;
  after: string;
  before: string;
  repository: {
    id?: number;
    name: string;
    owner: {
      login: string;
    };
  };
}

export function isPullRequestEvent(event: unknown): event is PullRequestEvent {
  return (
    typeof event === 'object' &&
    event !== null &&
    'action' in event &&
    'pull_request' in event
  );
}

export function isPushEvent(event: unknown): event is PushEvent {
  return (
    typeof event === 'object' &&
    event !== null &&
    'ref' in event &&
    'after' in event &&
    !('pull_request' in event)
  );
}
