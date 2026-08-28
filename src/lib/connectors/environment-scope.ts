import "server-only";

import * as queries from "@/lib/db/queries";

/**
 * Check an `environmentId` the client sent against the repo it claims to
 * belong to.
 *
 * The connector and credential actions authorize `repositoryId` and then write
 * a DIFFERENT raw id straight through — which is exactly the shape that
 * produced the cross-tenant IDOR on the coverage mutations (#97). Without this,
 * a connector or credential can be bound to another tenant's environment id,
 * and `connectorNameTaken` / `credentialNameTaken` then probe uniqueness in a
 * scope the caller does not own, which is an oracle for whether a given
 * environment id exists.
 *
 * Lives here rather than in either action file because both need it and two
 * copies of an authorization check is one copy too many. Mirrors what
 * `guardEnvironment` does in `environments.ts`: re-derive the repo from the row
 * instead of trusting the id.
 *
 * `null` (repo-wide) is always permitted; the caller resolves `undefined`
 * ("leave the scope alone") before calling.
 */
export async function assertEnvironmentInRepo(
  environmentId: string | null,
  repositoryId: string,
): Promise<string | null> {
  if (!environmentId) return null;
  const env = await queries.getEnvironment(environmentId);
  if (!env || env.repositoryId !== repositoryId) {
    throw new Error("Forbidden: Environment not found");
  }
  return environmentId;
}
