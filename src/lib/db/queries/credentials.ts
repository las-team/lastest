/**
 * `repo_credentials` — the named logins a repo's setup scripts and tests use.
 *
 * Secret field values are encrypted at rest by `@/lib/crypto-fields`: every
 * write encrypts, every read here decrypts, so callers inside the server see
 * plaintext. Which callers are allowed to is the point of the two read
 * functions being separate:
 *
 *   listCredentials()          → masked. What the UI gets. No plaintext leaves.
 *   getCredentialsForRun()     → plaintext. Called at dispatch, immediately
 *                                before the EB command is created, and never
 *                                persisted anywhere downstream.
 *
 * The split lives at the query layer rather than the action layer so that a
 * future caller reaching past the actions still lands on the masked one by
 * default — the plaintext read has a name that says what it is for.
 */
import { db } from "../index";
import { repoCredentials } from "../schema";
import type { CredentialField, RepoCredential } from "../schema";
import {
  encryptCredentialFields,
  decryptCredentialFields,
  maskCredentialFields,
} from "@/lib/crypto-fields";
import { eq, and, inArray, isNull } from "drizzle-orm";
import { v4 as uuid } from "uuid";

/** A credential row whose secret values have been replaced with "". */
export type MaskedCredential = RepoCredential;

/** The shape injected into a run: `{ vaultAdmin: { username, password } }`. */
export type RunCredentials = Record<string, Record<string, string>>;

/**
 * Which keys of each credential the user declared secret.
 *
 * Travels beside `RunCredentials` rather than inside it, because the test body
 * reads that object directly. The EB scrubs on this list — `CredentialField.secret`
 * is what decided encryption at rest, and re-deriving secrecy from the key
 * name in the EB gets `passphrase` and `clientAssertion` wrong.
 */
export type RunCredentialSecretKeys = Record<string, string[]>;

/**
 * All of a repo's credentials with secret values stripped. Safe to serialize
 * to a client component.
 *
 * Returns every environment's credentials — the list screen groups them. Use
 * `getCredentialsForRun` for the run-time, environment-resolved view.
 */
export async function listCredentials(
  repositoryId: string,
): Promise<MaskedCredential[]> {
  const rows = await db
    .select()
    .from(repoCredentials)
    .where(eq(repoCredentials.repositoryId, repositoryId))
    .orderBy(repoCredentials.name);
  return rows.map((row) => ({
    ...row,
    fields: maskCredentialFields(row.fields),
  }));
}

/** One credential, masked. Used by the editor to load field keys for editing. */
export async function getCredential(
  id: string,
): Promise<MaskedCredential | undefined> {
  const [row] = await db
    .select()
    .from(repoCredentials)
    .where(eq(repoCredentials.id, id));
  return row ? { ...row, fields: maskCredentialFields(row.fields) } : undefined;
}

/**
 * Decrypted credentials for a run, keyed by handle.
 *
 * The ONLY plaintext read path. Call it at dispatch — never earlier, and never
 * onto a request-scoped object something else might serialize.
 *
 * Environment resolution (B2) happens here, per handle: the run's environment
 * wins, and a handle that environment doesn't define falls back to the
 * repo-wide (NULL-environment) credential. That is what lets one suite run
 * against UAT and PROD with different logins and an IDENTICAL test body —
 * `credentials.vault.password` is just the right password. No substitution,
 * so no `codeHash` change and no invalidated baseline.
 */
export async function getCredentialsForRun(
  repositoryId: string,
  environmentId?: string | null,
): Promise<{
  credentials: RunCredentials;
  secretKeys: RunCredentialSecretKeys;
}> {
  const rows = await db
    .select()
    .from(repoCredentials)
    .where(eq(repoCredentials.repositoryId, repositoryId));

  // Repo-wide first, then let the environment's own rows overwrite them.
  // Ordering is the whole mechanism: a two-pass merge expresses "specific beats
  // general" without a per-handle lookup.
  const ordered = [
    ...rows.filter((r) => r.environmentId === null),
    ...(environmentId
      ? rows.filter((r) => r.environmentId === environmentId)
      : []),
  ];

  const credentials: RunCredentials = {};
  const secretKeys: RunCredentialSecretKeys = {};
  for (const row of ordered) {
    const entry: Record<string, string> = {};
    const secrets: string[] = [];
    for (const f of decryptCredentialFields(row.fields)) {
      entry[f.key] = f.value;
      // The declared flag, carried through rather than re-derived downstream.
      if (f.secret) secrets.push(f.key);
    }
    credentials[row.name] = entry;
    secretKeys[row.name] = secrets;
  }
  return { credentials, secretKeys };
}

/**
 * The stored `fields` array exactly as it sits in the column — secrets still
 * ciphertext. Used by the update action to carry a secret forward when the
 * editor submitted it empty ("unchanged"), so an edit never has to decrypt
 * anything just to leave it alone.
 */
export async function getCredentialFieldsRaw(
  id: string,
): Promise<CredentialField[] | undefined> {
  const [row] = await db
    .select({ fields: repoCredentials.fields })
    .from(repoCredentials)
    .where(eq(repoCredentials.id, id));
  return row?.fields ?? undefined;
}

export async function createCredential(data: {
  repositoryId: string;
  /** NULL/omitted = repo-wide, the pre-B2 behaviour and still the default. */
  environmentId?: string | null;
  name: string;
  label: string;
  description?: string | null;
  fields: CredentialField[];
  createdBy?: string | null;
}): Promise<{ id: string }> {
  const id = uuid();
  const now = new Date();
  await db.insert(repoCredentials).values({
    id,
    repositoryId: data.repositoryId,
    environmentId: data.environmentId ?? null,
    name: data.name,
    label: data.label,
    description: data.description ?? null,
    fields: encryptCredentialFields(data.fields),
    createdBy: data.createdBy ?? null,
    createdAt: now,
    updatedAt: now,
  });
  return { id };
}

export async function updateCredential(
  id: string,
  data: {
    name?: string;
    label?: string;
    description?: string | null;
    environmentId?: string | null;
    fields?: CredentialField[];
  },
): Promise<void> {
  const patch: Partial<typeof repoCredentials.$inferInsert> = {
    updatedAt: new Date(),
  };
  if (data.name !== undefined) patch.name = data.name;
  if (data.environmentId !== undefined)
    patch.environmentId = data.environmentId;
  if (data.label !== undefined) patch.label = data.label;
  if (data.description !== undefined) patch.description = data.description;
  // Only re-encrypt when the caller actually supplied fields, so a patch that
  // omits them doesn't wipe the stored secrets.
  if (data.fields !== undefined) {
    patch.fields = encryptCredentialFields(data.fields);
  }
  await db.update(repoCredentials).set(patch).where(eq(repoCredentials.id, id));
}

export async function deleteCredential(id: string): Promise<void> {
  await db.delete(repoCredentials).where(eq(repoCredentials.id, id));
}

/**
 * True when `name` is already taken in the same environment by a different row.
 *
 * Scoped to the environment, not the repo: `vault` must be free to mean the UAT
 * login in UAT and the PROD login in PROD — that is the point of the model.
 * Compared with `isNull` rather than `eq(..., null)` because SQL `= NULL` is
 * never true and would silently pass every repo-wide collision.
 */
export async function credentialNameTaken(
  repositoryId: string,
  name: string,
  exceptId?: string,
  environmentId?: string | null,
): Promise<boolean> {
  const rows = await db
    .select({ id: repoCredentials.id })
    .from(repoCredentials)
    .where(
      and(
        eq(repoCredentials.repositoryId, repositoryId),
        eq(repoCredentials.name, name),
        environmentId
          ? eq(repoCredentials.environmentId, environmentId)
          : isNull(repoCredentials.environmentId),
      ),
    );
  return rows.some((r) => r.id !== exceptId);
}

/**
 * Stamp `lastUsedAt` on the credentials a run received. Best-effort: a failure
 * here must never fail the run, and this is a convenience column rather than
 * an audit trail (the audit trail is P1 in the restricted-scope doc).
 */
export async function markCredentialsUsed(
  repositoryId: string,
  names: string[],
): Promise<void> {
  if (names.length === 0) return;
  await db
    .update(repoCredentials)
    .set({ lastUsedAt: new Date() })
    .where(
      and(
        eq(repoCredentials.repositoryId, repositoryId),
        inArray(repoCredentials.name, names),
      ),
    );
}
