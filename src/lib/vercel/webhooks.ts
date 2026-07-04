import crypto from "crypto";

/**
 * Vercel integration webhook verification + payload normalization.
 *
 * Mirrors src/lib/github/webhooks.ts. Vercel signs the raw request body with
 * HMAC-SHA1 keyed on the integration **client secret** and sends the hex digest
 * in the `x-vercel-signature` header (no algorithm prefix, unlike GitHub's
 * `sha256=`).
 *
 * ⚠ The SHA1 choice matches Vercel's documented behavior as of 2026-07. It is
 * isolated here so it's a one-line change if a live delivery proves otherwise.
 */
export function verifyVercelSignature(
  rawBody: string,
  signature: string | null,
): boolean {
  const secret = process.env.VERCEL_INTEGRATION_CLIENT_SECRET || "";
  if (!signature || !secret) return false;
  const digest = crypto
    .createHmac("sha1", secret)
    .update(rawBody, "utf8")
    .digest("hex");
  try {
    // Compare the raw header against our digest; Vercel sends the bare hex.
    const provided = signature.startsWith("sha1=")
      ? signature.slice(5)
      : signature;
    const a = Buffer.from(provided);
    const b = Buffer.from(digest);
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export interface VercelWebhookEnvelope {
  type: string;
  id: string;
  createdAt?: number;
  region?: string;
  payload: Record<string, unknown>;
}

export function isVercelWebhookEnvelope(
  value: unknown,
): value is VercelWebhookEnvelope {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    "payload" in value &&
    typeof (value as { type: unknown }).type === "string"
  );
}

/**
 * Read a value from a Vercel payload defensively. The spec documents fields
 * both as nested objects (`payload.deployment.url`) and as flat dotted keys
 * (`payload["deployment.url"]`), so try the nested walk first, then the flat
 * key. Returns undefined when neither is present.
 */
function pick(payload: Record<string, unknown>, path: string): unknown {
  // Nested walk: deployment.url → payload.deployment.url
  const parts = path.split(".");
  let cur: unknown = payload;
  for (const part of parts) {
    if (cur && typeof cur === "object" && part in (cur as object)) {
      cur = (cur as Record<string, unknown>)[part];
    } else {
      cur = undefined;
      break;
    }
  }
  if (cur !== undefined) return cur;
  // Flat dotted key fallback
  return payload[path];
}

function pickString(
  payload: Record<string, unknown>,
  path: string,
): string | undefined {
  const v = pick(payload, path);
  return typeof v === "string" ? v : undefined;
}

export interface VercelDeploymentMeta {
  githubCommitRef?: string;
  githubCommitSha?: string;
  githubOrg?: string;
  githubRepo?: string;
  gitlabCommitRef?: string;
  gitlabCommitSha?: string;
}

export interface NormalizedVercelDeployment {
  deploymentId?: string;
  deploymentUrl?: string;
  projectId?: string;
  teamId?: string;
  // 'production' | 'staging' | null (null = preview)
  target: string | null;
  meta: VercelDeploymentMeta;
  // Dashboard links (used as the check detailsUrl fallback)
  deploymentLink?: string;
  projectLink?: string;
  // deployment.check-rerequested carries the check id
  checkId?: string;
}

/**
 * Normalize the fields we need out of a deployment webhook payload, tolerant of
 * nested-vs-flat shapes. `deployment.url` is the *automatic* deployment URL —
 * the only URL guaranteed to exist at check time (branch aliases + custom
 * domains are assigned only after checks pass), so it must be prefixed with
 * `https://` and used verbatim as the test target.
 */
export function normalizeDeploymentPayload(
  payload: Record<string, unknown>,
): NormalizedVercelDeployment {
  const rawTarget = pick(payload, "target");
  const target =
    rawTarget === "production" || rawTarget === "staging" ? rawTarget : null; // null = preview

  const meta: VercelDeploymentMeta = {
    githubCommitRef: pickString(payload, "deployment.meta.githubCommitRef"),
    githubCommitSha: pickString(payload, "deployment.meta.githubCommitSha"),
    githubOrg: pickString(payload, "deployment.meta.githubOrg"),
    githubRepo: pickString(payload, "deployment.meta.githubRepo"),
    gitlabCommitRef: pickString(payload, "deployment.meta.gitlabCommitRef"),
    gitlabCommitSha: pickString(payload, "deployment.meta.gitlabCommitSha"),
  };

  return {
    deploymentId: pickString(payload, "deployment.id"),
    deploymentUrl: pickString(payload, "deployment.url"),
    projectId: pickString(payload, "project.id"),
    teamId: pickString(payload, "team.id"),
    target,
    meta,
    deploymentLink: pickString(payload, "links.deployment"),
    projectLink: pickString(payload, "links.project"),
    checkId: pickString(payload, "check.id"),
  };
}

/**
 * The automatic deployment URL comes back without a scheme. Build the target
 * URL the way the spec mandates: always `https://${deployment.url}`.
 */
export function deploymentTargetUrl(deploymentUrl: string): string {
  if (/^https?:\/\//i.test(deploymentUrl)) return deploymentUrl;
  return `https://${deploymentUrl}`;
}
