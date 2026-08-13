/**
 * Anti-gaming gates for launch vote/submit/comment mutations (v1:
 * email-verified + per-account/per-IP velocity, no minimum account age). The
 * frontend is untrusted — these run server-side on every mutation. Returns a
 * structured {@link GateError} (rather than throwing) so the handler maps it to
 * a response.
 *
 * Unchanged from `src/lib/launch/gating.ts` except that the counts now come
 * from the plugin's own tables through an injected handle, and the thresholds
 * from `LAUNCH_CONFIG` instead of `DEFAULT_LAUNCH`.
 */

import { LAUNCH_CONFIG } from "../config";
import type { LaunchDb } from "../data/db";
import {
  countCommentsByUserSince,
  countSubmissionsByUserSince,
  countVotesByIpSince,
  countVotesByUserSince,
} from "../data/queries";

export interface GateError {
  status: number; // HTTP status
  code: string; // machine-readable reason
  retryAfterSec?: number; // for 429s
}

const ONE_HOUR_MS = 3_600_000;

export async function assertCanVote(
  db: LaunchDb,
  userId: string,
  emailVerified: boolean,
  ip: string | null,
): Promise<GateError | null> {
  if (!emailVerified) return { status: 403, code: "email_unverified" };

  const since = new Date(Date.now() - ONE_HOUR_MS);
  const byAccount = await countVotesByUserSince(db, userId, since);
  if (byAccount >= LAUNCH_CONFIG.votesPerAccountPerHour) {
    return { status: 429, code: "velocity_exceeded", retryAfterSec: 3600 };
  }
  if (ip) {
    const byIp = await countVotesByIpSince(db, ip, since);
    if (byIp >= LAUNCH_CONFIG.votesPerIpPerHour) {
      return { status: 429, code: "velocity_exceeded", retryAfterSec: 3600 };
    }
  }
  return null;
}

export async function assertCanSubmit(
  db: LaunchDb,
  userId: string,
  emailVerified: boolean,
): Promise<GateError | null> {
  if (!emailVerified) return { status: 403, code: "email_unverified" };

  const since = new Date(Date.now() - ONE_HOUR_MS);
  const recent = await countSubmissionsByUserSince(db, userId, since);
  if (recent >= LAUNCH_CONFIG.submissionsPerAccountPerHour) {
    return { status: 429, code: "velocity_exceeded", retryAfterSec: 3600 };
  }
  return null;
}

export async function assertCanComment(
  db: LaunchDb,
  userId: string,
  emailVerified: boolean,
): Promise<GateError | null> {
  if (!emailVerified) return { status: 403, code: "email_unverified" };

  const since = new Date(Date.now() - ONE_HOUR_MS);
  const recent = await countCommentsByUserSince(db, userId, since);
  if (recent >= LAUNCH_CONFIG.commentsPerAccountPerHour) {
    return { status: 429, code: "velocity_exceeded", retryAfterSec: 3600 };
  }
  return null;
}
