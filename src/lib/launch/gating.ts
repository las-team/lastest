/**
 * Anti-gaming gates for launch vote/submit mutations (v1: email-verified +
 * per-account/per-IP velocity, no minimum account age). The frontend is
 * untrusted — these run server-side on every mutation. Returns a structured
 * {@link GateError} (rather than throwing) so the route maps it to a response.
 */

import * as queries from "@/lib/db/queries";
import { DEFAULT_LAUNCH } from "@/lib/db/schema";

export interface GateError {
  status: number; // HTTP status
  code: string; // machine-readable reason
  retryAfterSec?: number; // for 429s
}

const ONE_HOUR_MS = 3_600_000;

export async function assertCanVote(
  userId: string,
  emailVerified: boolean,
  ip: string | null,
): Promise<GateError | null> {
  if (!emailVerified) return { status: 403, code: "email_unverified" };

  const since = new Date(Date.now() - ONE_HOUR_MS);
  const byAccount = await queries.countVotesByUserSince(userId, since);
  if (byAccount >= DEFAULT_LAUNCH.votesPerAccountPerHour) {
    return { status: 429, code: "velocity_exceeded", retryAfterSec: 3600 };
  }
  if (ip) {
    const byIp = await queries.countVotesByIpSince(ip, since);
    if (byIp >= DEFAULT_LAUNCH.votesPerIpPerHour) {
      return { status: 429, code: "velocity_exceeded", retryAfterSec: 3600 };
    }
  }
  return null;
}

export async function assertCanSubmit(
  userId: string,
  emailVerified: boolean,
): Promise<GateError | null> {
  if (!emailVerified) return { status: 403, code: "email_unverified" };

  const since = new Date(Date.now() - ONE_HOUR_MS);
  const recent = await queries.countSubmissionsByUserSince(userId, since);
  if (recent >= DEFAULT_LAUNCH.submissionsPerAccountPerHour) {
    return { status: 429, code: "velocity_exceeded", retryAfterSec: 3600 };
  }
  return null;
}
