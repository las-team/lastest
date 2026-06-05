import crypto from "crypto";

const WEBHOOK_SECRET = process.env.GITHUB_WEBHOOK_SECRET || "";

export function verifyWebhookSignature(
  payload: string,
  signature: string | null,
): boolean {
  if (!signature || !WEBHOOK_SECRET) return false;

  const hmac = crypto.createHmac("sha256", WEBHOOK_SECRET);
  const digest = "sha256=" + hmac.update(payload).digest("hex");

  try {
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(digest));
  } catch {
    return false;
  }
}

export interface PullRequestEvent {
  action: "opened" | "synchronize" | "closed" | "reopened";
  number: number;
  pull_request: {
    number: number;
    title: string;
    state: string;
    merged?: boolean;
    user?: { login: string };
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
    typeof event === "object" &&
    event !== null &&
    "action" in event &&
    "pull_request" in event
  );
}

export function isPushEvent(event: unknown): event is PushEvent {
  return (
    typeof event === "object" &&
    event !== null &&
    "ref" in event &&
    "after" in event &&
    !("pull_request" in event)
  );
}

/**
 * Verify phase (v1.14+) — GitHub "issues" webhook event. Used to detect when
 * a verify-filed ticket gets closed in GH, so we can rerun the linked case
 * and auto-flip the verify board back to done on green.
 */
export interface IssuesEvent {
  action: "opened" | "edited" | "closed" | "reopened" | "deleted" | string;
  issue: {
    number: number;
    state: "open" | "closed";
    title: string;
    html_url: string;
    labels?: Array<{ name: string }>;
  };
  repository: {
    id?: number;
    name: string;
    owner: { login: string };
  };
}

export function isIssuesEvent(event: unknown): event is IssuesEvent {
  if (typeof event !== "object" || event === null) return false;
  if (!("action" in event) || !("issue" in event)) return false;
  // GH sends pull-request opens through the `issues` event endpoint too,
  // tagged with `issue.pull_request`. Filter those out so we only act on
  // actual issues.
  const issue = (event as { issue: unknown }).issue;
  if (typeof issue !== "object" || issue === null) return false;
  return !("pull_request" in issue);
}
