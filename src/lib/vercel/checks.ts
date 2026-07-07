import type { BuildStatus, VercelCheckConclusion } from "@/lib/db/schema";

/**
 * Vercel Checks API client.
 *
 * ⚠ Paths pinned to Vercel's documented Checks API as of 2026-07:
 *   register: POST  https://api.vercel.com/v13/deployments/{deploymentId}/checks
 *   update:   PATCH https://api.vercel.com/v13/deployments/{deploymentId}/checks/{checkId}
 * The token MUST be an OAuth2 integration token — a personal access token gets a
 * 403 from this API. Isolated here so a version bump is a one-line change.
 */
const VERCEL_API = "https://api.vercel.com";
const CHECK_NAME = "Lastest visual regression";

export type VercelCheckOutputStatus = "running" | "completed";

export interface VercelCheckOutput {
  // Vercel renders this on the deployment; keep it short and human-readable.
  [key: string]: unknown;
}

export interface RegisterCheckBody {
  blocking: boolean;
  rerequestable: boolean;
  detailsUrl?: string;
  externalId?: string;
}

export interface UpdateCheckBody {
  status?: VercelCheckOutputStatus;
  conclusion?: VercelCheckConclusion;
  detailsUrl?: string;
  output?: VercelCheckOutput;
}

function teamQuery(teamId?: string | null): string {
  return teamId ? `?teamId=${encodeURIComponent(teamId)}` : "";
}

/**
 * Register a Lastest check against a fresh deployment. Returns the Vercel check
 * id (needed for later PATCHes) or null on failure. A blocking check that later
 * concludes failed/canceled fails the deployment (domains never get assigned).
 */
export async function registerCheck(
  accessToken: string,
  deploymentId: string,
  teamId: string | null,
  body: RegisterCheckBody,
): Promise<{ id: string } | null> {
  try {
    const response = await fetch(
      `${VERCEL_API}/v13/deployments/${deploymentId}/checks${teamQuery(teamId)}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: CHECK_NAME,
          blocking: body.blocking,
          rerequestable: body.rerequestable,
          ...(body.detailsUrl ? { detailsUrl: body.detailsUrl } : {}),
          ...(body.externalId ? { externalId: body.externalId } : {}),
        }),
      },
    );
    if (!response.ok) {
      console.error(
        "[vercel] register check failed:",
        response.status,
        await response.text().catch(() => ""),
      );
      return null;
    }
    const data = (await response.json()) as {
      id?: string;
      check?: { id?: string };
    };
    const id = data.id ?? data.check?.id;
    return id ? { id } : null;
  } catch (error) {
    console.error("[vercel] register check error:", error);
    return null;
  }
}

/**
 * PATCH an existing check — used to flip to `running`, heartbeat, and conclude.
 * Returns true on success. Failures are logged, not thrown, so a Vercel outage
 * never fails a Lastest build.
 */
export async function updateCheck(
  accessToken: string,
  deploymentId: string,
  checkId: string,
  teamId: string | null,
  body: UpdateCheckBody,
): Promise<boolean> {
  try {
    const response = await fetch(
      `${VERCEL_API}/v13/deployments/${deploymentId}/checks/${checkId}${teamQuery(teamId)}`,
      {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      },
    );
    if (!response.ok) {
      console.error(
        "[vercel] update check failed:",
        response.status,
        await response.text().catch(() => ""),
      );
      return false;
    }
    return true;
  } catch (error) {
    console.error("[vercel] update check error:", error);
    return false;
  }
}

/**
 * Map a Lastest BuildStatus to a Vercel check conclusion (spec §3.5).
 *
 *   safe_to_merge  → succeeded  (clean / all diffs approved)
 *   review_required→ failed     (unapproved diff — this is the product: it blocks)
 *   blocked        → failed
 *   has_todos      → neutral     (todos are informational, never block)
 *   executor_failed→ neutral     (infra failure must not block the user's deploy)
 */
export function conclusionForBuildStatus(
  status: BuildStatus,
): VercelCheckConclusion {
  switch (status) {
    case "safe_to_merge":
      return "succeeded";
    case "review_required":
    case "blocked":
      return "failed";
    case "has_todos":
    case "executor_failed":
      return "neutral";
    default:
      return "neutral";
  }
}
