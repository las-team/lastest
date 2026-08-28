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
import type {
  RunCredentials,
  RunCredentialSecretKeys,
} from "@/lib/db/queries/credentials";
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
/** Cap on retained repo keys. Nothing older than STAMP_INTERVAL_MS is useful,
 *  so entries are also swept on write — without either, this is a map that only
 *  ever grows for the lifetime of a long-lived process. */
const STAMP_CACHE_MAX = 512;
const lastStampedAt = new Map<string, number>();

function shouldStamp(repositoryId: string): boolean {
  const now = Date.now();
  const prev = lastStampedAt.get(repositoryId);
  if (prev !== undefined && now - prev < STAMP_INTERVAL_MS) return false;
  // Evict everything already past its interval — those entries can only answer
  // "yes, stamp" anyway, so keeping them buys nothing.
  if (lastStampedAt.size >= STAMP_CACHE_MAX) {
    for (const [repo, at] of lastStampedAt) {
      if (now - at >= STAMP_INTERVAL_MS) lastStampedAt.delete(repo);
    }
    // Still full (every entry fresh): drop the oldest insertions. Map iterates
    // in insertion order, so this is the least recently stamped.
    if (lastStampedAt.size >= STAMP_CACHE_MAX) {
      for (const repo of lastStampedAt.keys()) {
        lastStampedAt.delete(repo);
        if (lastStampedAt.size < STAMP_CACHE_MAX) break;
      }
    }
  }
  lastStampedAt.set(repositoryId, now);
  return true;
}

export class CredentialResolutionError extends Error {
  constructor(cause: unknown) {
    super(
      "Credentials could not be decrypted for this run. Check ENCRYPTION_KEY and the repo's credential rows.",
    );
    this.name = "CredentialResolutionError";
    this.cause = cause;
  }
}

/**
 * Every credential the repo holds, decrypted and keyed by handle, plus the
 * declared secret keys the EB scrubs on.
 *
 * Returns `undefined` (not `{}`) when the repo holds no credentials, so the
 * field stays off the wire entirely — that is the ordinary "nothing to send"
 * case and it is not an error.
 *
 * A repo that *does* hold credentials and cannot decrypt them throws. Returning
 * `undefined` there produced a run that failed deep inside the test body on
 * `credentials.x is undefined`, with the only explanation in a server-side
 * `log.warn` the user never sees — a confusing green-path failure is a worse
 * trade than a run that says why it stopped.
 */
export async function resolveRunCredentials(
  repositoryId: string | null | undefined,
): Promise<
  | { credentials: RunCredentials; secretKeys: RunCredentialSecretKeys }
  | undefined
> {
  if (!repositoryId) return undefined;
  let resolved: Awaited<ReturnType<typeof getCredentialsForRun>>;
  try {
    resolved = await getCredentialsForRun(repositoryId);
  } catch (err) {
    log.warn(
      { err, repositoryId },
      "could not resolve credentials for run — failing the run",
    );
    throw new CredentialResolutionError(err);
  }
  const names = Object.keys(resolved.credentials);
  if (names.length === 0) return undefined;
  // Fire-and-forget: `lastUsedAt` is a convenience column, and a write
  // failure here must never fail a run.
  if (shouldStamp(repositoryId)) {
    void markCredentialsUsed(repositoryId, names).catch((err) => {
      log.warn({ err, repositoryId }, "failed to stamp credential lastUsedAt");
    });
  }
  return resolved;
}
