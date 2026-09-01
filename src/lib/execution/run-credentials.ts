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
import {
  getCredentialsForRun,
  getEnvironmentVariableMap,
  markCredentialsUsed,
} from "@/lib/db/queries";
import type {
  RunCredentials,
  RunCredentialSecretKeys,
} from "@/lib/db/queries/credentials";
import { getLogger } from "@/lib/logger";

const log = getLogger("Credentials");

/**
 * Reserved credential handle for environment variables. A credential row
 * cannot take this name: `credentials.env` is the environment's own values.
 */
export const ENV_HANDLE = "env";

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
 * `environmentId` selects which set: the environment's own credentials win, and
 * anything it does not define falls back to the repo-wide row. The resulting
 * map has the same SHAPE either way, which is what lets one suite run against
 * UAT and PROD with different logins and an identical test body.
 *
 * Returns `undefined` (not `{}`) when the repo holds nothing to send, so the
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
  environmentId?: string | null,
): Promise<
  | { credentials: RunCredentials; secretKeys: RunCredentialSecretKeys }
  | undefined
> {
  if (!repositoryId) return undefined;
  let resolved: Awaited<ReturnType<typeof getCredentialsForRun>>;
  try {
    resolved = await getCredentialsForRun(repositoryId, environmentId);
  } catch (err) {
    log.warn(
      { err, repositoryId },
      "could not resolve credentials for run — failing the run",
    );
    throw new CredentialResolutionError(err);
  }
  // Names to stamp `lastUsedAt` on — captured BEFORE the reserved `env` handle
  // is added, since that one is not a credential row.
  const names = Object.keys(resolved.credentials);

  // Environment variables ride the same channel, under a reserved handle:
  // a test reads `credentials.env.docId`.
  //
  // Injection rather than substitution is the point. A `{{env:docId}}` in the
  // source would be textually replaced before dispatch, which puts the value
  // in `codeHash` — so re-pointing a document id after a sandbox refresh
  // would invalidate every baseline for that test, destroying exactly the
  // refresh survival the environment model exists to provide
  // (`docs/credentials-plan.md` §1 makes the same argument for passwords).
  //
  // Env values are not credential fields and carry no `secret` flag, so they
  // get no entry in `secretKeys` — an env var is a document id, not a
  // password, and masking every one of them would make failures unreadable.
  if (environmentId) {
    const envVars = await getEnvironmentVariableMap(environmentId);
    if (Object.keys(envVars).length > 0) {
      resolved.credentials[ENV_HANDLE] = envVars;
    }
  }

  if (Object.keys(resolved.credentials).length === 0) return undefined;
  // Fire-and-forget: `lastUsedAt` is a convenience column, and a write
  // failure here must never fail a run.
  if (names.length > 0 && shouldStamp(repositoryId)) {
    void markCredentialsUsed(repositoryId, names).catch((err) => {
      log.warn({ err, repositoryId }, "failed to stamp credential lastUsedAt");
    });
  }
  return resolved;
}
