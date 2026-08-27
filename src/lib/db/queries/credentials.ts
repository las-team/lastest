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
import { eq, and, inArray } from "drizzle-orm";
import { v4 as uuid } from "uuid";

/** A credential row whose secret values have been replaced with "". */
export type MaskedCredential = RepoCredential;

/** The shape injected into a run: `{ vaultAdmin: { username, password } }`. */
export type RunCredentials = Record<string, Record<string, string>>;

/**
 * All of a repo's credentials with secret values stripped. Safe to serialize
 * to a client component.
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
 */
export async function getCredentialsForRun(
  repositoryId: string,
): Promise<RunCredentials> {
  const rows = await db
    .select()
    .from(repoCredentials)
    .where(eq(repoCredentials.repositoryId, repositoryId));
  const out: RunCredentials = {};
  for (const row of rows) {
    const entry: Record<string, string> = {};
    for (const f of decryptCredentialFields(row.fields)) {
      entry[f.key] = f.value;
    }
    out[row.name] = entry;
  }
  return out;
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
    fields?: CredentialField[];
  },
): Promise<void> {
  const patch: Partial<typeof repoCredentials.$inferInsert> = {
    updatedAt: new Date(),
  };
  if (data.name !== undefined) patch.name = data.name;
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

/** True when `name` is already taken in the repo by a different row. */
export async function credentialNameTaken(
  repositoryId: string,
  name: string,
  exceptId?: string,
): Promise<boolean> {
  const rows = await db
    .select({ id: repoCredentials.id })
    .from(repoCredentials)
    .where(
      and(
        eq(repoCredentials.repositoryId, repositoryId),
        eq(repoCredentials.name, name),
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
