/**
 * Decrypt-at-dispatch for repo credentials.
 *
 * The whole point of the timing: credentials are read and decrypted here, in
 * the few lines before `createMessage(...)` puts them on the wire — never
 * earlier, never onto a request-scoped object something else might serialize,
 * and never into anything the run persists.
 *
 * Which credentials go to a run? All of the repo's, keyed by name. A per-test
 * allowlist is a real hardening step, but it is a second table and a second UI,
 * and asking the user to maintain a mapping they will get wrong buys little on
 * day one — `docs/credentials-plan.md` §3, and §9 for the counter-argument and
 * the smallest fix if it lands wrong.
 */
import { getCredentialsForRun, markCredentialsUsed } from "@/lib/db/queries";
import type { RunCredentials } from "@/lib/db/queries/credentials";
import { getLogger } from "@/lib/logger";

const log = getLogger("Credentials");

/**
 * Last `lastUsedAt` stamp per repo, in this process.
 *
 * The pool-worker path calls `resolveRunCredentials` once per test, so a
 * 100-test build would otherwise issue 100 identical UPDATEs for a column
 * whose only job is to render "Last used 2h ago". One stamp per repo per
 * minute is all that display can distinguish anyway. Process-local on purpose:
 * a missed stamp after a restart costs nothing, and this is explicitly not an
 * audit trail (that is P1).
 */
const STAMP_INTERVAL_MS = 60_000;
const lastStampedAt = new Map<string, number>();

function shouldStamp(repositoryId: string): boolean {
  const now = Date.now();
  const prev = lastStampedAt.get(repositoryId);
  if (prev !== undefined && now - prev < STAMP_INTERVAL_MS) return false;
  lastStampedAt.set(repositoryId, now);
  return true;
}

/**
 * Every credential the repo holds, decrypted and keyed by handle.
 *
 * Returns `undefined` (not `{}`) when there is nothing to send, so the field
 * stays off the wire entirely. Never throws: a missing `ENCRYPTION_KEY` or a
 * corrupt row must not take down a build that has no credential in it — the
 * test fails on its own terms instead, with `credentials.x` undefined.
 */
export async function resolveRunCredentials(
  repositoryId: string | null | undefined,
): Promise<RunCredentials | undefined> {
  if (!repositoryId) return undefined;
  try {
    const creds = await getCredentialsForRun(repositoryId);
    const names = Object.keys(creds);
    if (names.length === 0) return undefined;
    // Fire-and-forget: `lastUsedAt` is a convenience column, and a write
    // failure here must never fail a run.
    if (shouldStamp(repositoryId)) {
      void markCredentialsUsed(repositoryId, names).catch((err) => {
        log.warn(
          { err, repositoryId },
          "failed to stamp credential lastUsedAt",
        );
      });
    }
    return creds;
  } catch (err) {
    log.warn(
      { err, repositoryId },
      "could not resolve credentials for run — dispatching without them",
    );
    return undefined;
  }
}
