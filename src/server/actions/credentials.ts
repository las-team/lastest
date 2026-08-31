"use server";

/**
 * Server actions for `repo_credentials` — the Setup → Credentials tab.
 *
 * Two rules shape this module:
 *
 *  1. **No read path returns a secret's plaintext.** `listCredentials` /
 *     `getCredential` come back masked from the query layer, and nothing here
 *     un-masks them. Values are write-only: you replace a secret, you never
 *     read it back. That removes a whole class of exfiltration (a read
 *     endpoint, a screenshot of the settings page, a shared session) at the
 *     cost of one convenience — and there is no audit log to record a reveal
 *     against yet (P1 in `docs/pharma-restricted-scope.md`).
 *
 *  2. **An empty secret value on update means "leave it alone."** The editor
 *     loads masked fields, so a save that didn't touch the password field
 *     sends "" for it. Treating that as a wipe would silently break a working
 *     login on every unrelated edit — see `mergeSecretFields`.
 *
 * Both read and write are gated on `repos:settings`, the same capability as
 * baselines and comparison config: it already excludes viewers, suspended
 * teams and the demo plan.
 */

import { revalidatePath } from "next/cache";
import * as queries from "@/lib/db/queries";
import { requireRepoCapability } from "@/lib/auth/capabilities";
import type { CredentialField } from "@/lib/db/schema";
import type { MaskedCredential } from "@/lib/db/queries/credentials";

/** The code handle: `credentials.<name>.<field>`. Must be a JS identifier. */
const NAME_RE = /^[a-z][A-Za-z0-9]*$/;
/** Field keys are property names too, but may start with any letter. */
const FIELD_KEY_RE = /^[A-Za-z][A-Za-z0-9_]*$/;

export interface CredentialInput {
  name: string;
  label: string;
  description?: string | null;
  fields: CredentialField[];
}

function validate(input: CredentialInput): void {
  if (!input.label.trim()) throw new Error("Label is required");
  if (!NAME_RE.test(input.name)) {
    throw new Error(
      "Name must start with a lowercase letter and contain only letters and digits (e.g. vaultAdmin)",
    );
  }
  if (input.fields.length === 0) {
    throw new Error("A credential needs at least one field");
  }
  const seen = new Set<string>();
  for (const f of input.fields) {
    if (!FIELD_KEY_RE.test(f.key)) {
      throw new Error(
        `"${f.key}" is not a valid field name — use letters, digits and underscores, starting with a letter`,
      );
    }
    if (seen.has(f.key)) throw new Error(`Duplicate field "${f.key}"`);
    seen.add(f.key);
  }
}

/**
 * Carry forward the stored ciphertext for any secret the editor submitted
 * empty. The editor never receives plaintext, so "" means "unchanged" —
 * except on create, where there is nothing to carry forward and an empty
 * secret is simply an empty secret.
 */
function mergeSecretFields(
  incoming: CredentialField[],
  stored: CredentialField[] | undefined,
): CredentialField[] {
  if (!stored) return incoming;
  const storedByKey = new Map(stored.map((f) => [f.key, f]));
  return incoming.map((f) => {
    if (!f.secret || f.value !== "") return f;
    const prev = storedByKey.get(f.key);
    // `prev.value` here is still ciphertext; `encryptCredentialFields` is
    // ENC_PREFIX-guarded and passes it through rather than double-encrypting.
    return prev?.secret ? { ...f, value: prev.value } : f;
  });
}

/** Load a credential + assert the caller's team owns its repo and may edit it. */
async function guardCredential(id: string) {
  const cred = await queries.getCredential(id);
  if (!cred) throw new Error("Forbidden: Credential not found");
  await requireRepoCapability(cred.repositoryId, "repos:settings");
  return cred;
}

function refresh() {
  revalidatePath("/setup");
}

/** All credentials for a repo, secrets masked. */
export async function getCredentials(
  repositoryId: string,
): Promise<MaskedCredential[]> {
  await requireRepoCapability(repositoryId, "repos:settings");
  return queries.listCredentials(repositoryId);
}

export async function createCredential(
  repositoryId: string,
  input: CredentialInput,
): Promise<{ id: string }> {
  const session = await requireRepoCapability(repositoryId, "repos:settings");
  validate(input);
  if (await queries.credentialNameTaken(repositoryId, input.name)) {
    throw new Error(`A credential named "${input.name}" already exists`);
  }
  const result = await queries.createCredential({
    repositoryId,
    name: input.name,
    label: input.label.trim(),
    description: input.description ?? null,
    fields: input.fields,
    createdBy: session.user.id,
  });
  refresh();
  return result;
}

export async function updateCredential(
  id: string,
  input: CredentialInput,
): Promise<{ success: true }> {
  const existing = await guardCredential(id);
  validate(input);
  if (
    await queries.credentialNameTaken(existing.repositoryId, input.name, id)
  ) {
    throw new Error(`A credential named "${input.name}" already exists`);
  }
  // The masked row can't supply the ciphertext to carry forward — re-read the
  // stored fields through the run path, which is the only decrypting read.
  const stored = await queries.getCredentialFieldsRaw(id);
  await queries.updateCredential(id, {
    name: input.name,
    label: input.label.trim(),
    description: input.description ?? null,
    fields: mergeSecretFields(input.fields, stored),
  });
  refresh();
  return { success: true };
}

export async function deleteCredential(id: string): Promise<{ success: true }> {
  await guardCredential(id);
  await queries.deleteCredential(id);
  refresh();
  return { success: true };
}
