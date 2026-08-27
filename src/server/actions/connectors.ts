"use server";

/**
 * Server actions for `sut_connectors` — the Veeva Vault and Salesforce cards on
 * Settings → Integrations.
 *
 * A connector is two rows written together: the connector itself (URLs, API
 * version, auth method) and a `repo_credentials` row holding its secrets under
 * the SAME handle. That pairing is the feature — creating a Vault connector
 * named `vault` is what makes `credentials.vault.username` exist, so a
 * consultant never has to know the magic handle or the exact field keys.
 *
 * The two-row write is kept consistent by hand rather than by a transaction,
 * because the credential is created first and the compensating delete is the
 * only failure path: see `createConnector`. What must never happen is a
 * credential appearing in the Setup list with no connector explaining it.
 *
 * Secrets are write-only here for the same reason as `credentials.ts`: nothing
 * in this module returns plaintext, and an empty secret on update means
 * "unchanged".
 */

import { revalidatePath } from "next/cache";
import * as queries from "@/lib/db/queries";
import { requireRepoCapability } from "@/lib/auth/capabilities";
import type {
  CredentialField,
  SutConnector,
  SutConnectorAuthMethod,
  SutConnectorConfig,
  SutConnectorType,
} from "@/lib/db/schema";
import {
  getAuthMethod,
  normalizeConnectorConfig,
} from "@/lib/connectors/definitions";
import { verifyConnectorConnection } from "@/lib/connectors/verify";
import type { ConnectorWithEnvironment } from "@/lib/db/queries/connectors";

/** Shared with the credential handle: `credentials.<name>.<field>`. */
const NAME_RE = /^[a-z][A-Za-z0-9]*$/;

export interface ConnectorInput {
  type: SutConnectorType;
  authMethod: SutConnectorAuthMethod;
  name: string;
  label: string;
  environmentId?: string | null;
  /** Non-secret values, filtered against the method's declared config fields. */
  config: Record<string, string>;
  /** Secret and non-secret credential values, keyed by field key. */
  secrets: Record<string, string>;
}

/**
 * Build the credential row from the method definition rather than from what the
 * client sent. A field the method does not declare is dropped, and the `secret`
 * flag comes from the definition — a client cannot mark its own password
 * non-secret and have it stored in the clear.
 */
function buildCredentialFields(
  input: ConnectorInput,
  stored: CredentialField[] | undefined,
): CredentialField[] {
  const def = getAuthMethod(input.type, input.authMethod);
  const storedByKey = new Map((stored ?? []).map((f) => [f.key, f]));
  return def.credentialFields.map((field) => {
    const submitted = input.secrets[field.key] ?? "";
    if (field.secret && submitted === "") {
      // "Unchanged" — carry the ciphertext forward. `encryptCredentialFields`
      // is ENC_PREFIX-guarded, so re-encrypting is a no-op.
      const prev = storedByKey.get(field.key);
      if (prev?.secret) return { ...prev };
    }
    return { key: field.key, value: submitted, secret: field.secret };
  });
}

function validate(input: ConnectorInput): void {
  if (!input.label.trim()) throw new Error("Label is required");
  if (!NAME_RE.test(input.name)) {
    throw new Error(
      "Name must start with a lowercase letter and contain only letters and digits (e.g. vaultUat)",
    );
  }
  // Throws when the method is not valid for the type, which is the only place
  // that pairing is checked.
  getAuthMethod(input.type, input.authMethod);
}

async function guardConnector(id: string): Promise<SutConnector> {
  const connector = await queries.getConnector(id);
  if (!connector) throw new Error("Forbidden: Connector not found");
  await requireRepoCapability(connector.repositoryId, "repos:settings");
  return connector;
}

function refresh() {
  revalidatePath("/settings");
  revalidatePath("/setup");
}

export async function getConnectors(
  repositoryId: string,
  opts: { type?: SutConnectorType } = {},
): Promise<ConnectorWithEnvironment[]> {
  await requireRepoCapability(repositoryId, "repos:settings");
  return queries.listConnectors(repositoryId, opts);
}

export async function createConnector(
  repositoryId: string,
  input: ConnectorInput,
): Promise<{ id: string }> {
  const session = await requireRepoCapability(repositoryId, "repos:settings");
  validate(input);
  const environmentId = input.environmentId ?? null;

  // The handle has to be free in BOTH tables — it is one name used by two rows,
  // and a collision in either would break the pairing.
  if (
    await queries.connectorNameTaken(
      repositoryId,
      input.name,
      undefined,
      environmentId,
    )
  ) {
    throw new Error(`A connector named "${input.name}" already exists here`);
  }
  if (
    await queries.credentialNameTaken(
      repositoryId,
      input.name,
      undefined,
      environmentId,
    )
  ) {
    throw new Error(
      `A credential named "${input.name}" already exists here — pick another name or remove it first`,
    );
  }

  const config = normalizeConnectorConfig(
    input.type,
    input.authMethod,
    input.config,
  ) as unknown as SutConnectorConfig;

  const credential = await queries.createCredential({
    repositoryId,
    environmentId,
    name: input.name,
    label: input.label.trim(),
    description: `Managed by the ${input.label.trim()} connector`,
    fields: buildCredentialFields(input, undefined),
    createdBy: session.user.id,
  });

  try {
    const result = await queries.createConnector({
      repositoryId,
      environmentId,
      type: input.type,
      name: input.name,
      label: input.label.trim(),
      authMethod: input.authMethod,
      config,
      credentialId: credential.id,
      createdBy: session.user.id,
    });
    refresh();
    return result;
  } catch (err) {
    // Compensate: a credential with no connector would show up in Setup with no
    // explanation and no way to reach its own form.
    await queries.deleteCredential(credential.id).catch(() => {});
    throw err;
  }
}

export async function updateConnector(
  id: string,
  input: ConnectorInput,
): Promise<{ success: true }> {
  const existing = await guardConnector(id);
  validate(input);
  const environmentId =
    input.environmentId === undefined
      ? existing.environmentId
      : input.environmentId;

  if (
    await queries.connectorNameTaken(
      existing.repositoryId,
      input.name,
      id,
      environmentId,
    )
  ) {
    throw new Error(`A connector named "${input.name}" already exists here`);
  }
  if (
    await queries.credentialNameTaken(
      existing.repositoryId,
      input.name,
      existing.credentialId ?? undefined,
      environmentId,
    )
  ) {
    throw new Error(`A credential named "${input.name}" already exists here`);
  }

  const config = normalizeConnectorConfig(
    input.type,
    input.authMethod,
    input.config,
  ) as unknown as SutConnectorConfig;

  const stored = existing.credentialId
    ? await queries.getCredentialFieldsRaw(existing.credentialId)
    : undefined;
  const fields = buildCredentialFields(input, stored);

  // The credential moves with the connector: same name, same environment. The
  // handle is shared, so letting them drift would break `credentials.<name>`.
  let credentialId = existing.credentialId;
  if (credentialId) {
    await queries.updateCredential(credentialId, {
      name: input.name,
      label: input.label.trim(),
      environmentId,
      fields,
    });
  } else {
    // The credential was deleted out from under the connector (its FK is
    // `set null`). Recreate rather than refusing to save.
    const created = await queries.createCredential({
      repositoryId: existing.repositoryId,
      environmentId,
      name: input.name,
      label: input.label.trim(),
      fields,
    });
    credentialId = created.id;
  }

  await queries.updateConnector(id, {
    name: input.name,
    label: input.label.trim(),
    environmentId,
    authMethod: input.authMethod,
    config,
    credentialId,
  });
  refresh();
  return { success: true };
}

/**
 * Delete a connector and the credential it manages.
 *
 * Both, deliberately: the credential exists because the connector created it,
 * and leaving an orphan named `vault` behind would silently keep a stale
 * password in the store while the UI says the org is disconnected.
 */
export async function deleteConnector(id: string): Promise<{ success: true }> {
  const connector = await guardConnector(id);
  await queries.deleteConnector(id);
  if (connector.credentialId) {
    await queries.deleteCredential(connector.credentialId).catch(() => {});
  }
  refresh();
  return { success: true };
}

export interface VerifyOutcome {
  ok: boolean;
  detail?: string;
  error?: string;
}

/**
 * Run the live connection check and record the outcome.
 *
 * Anything the exchange discovered about the org — Salesforce's `instance_url`,
 * the Vault id — is written back to `config` here, so a user never has to type
 * a value the API already knows.
 */
export async function verifyConnector(id: string): Promise<VerifyOutcome> {
  const connector = await guardConnector(id);
  const connection = await queries.getConnectorForConnection(id);
  if (!connection) throw new Error("Connector not found");

  const result = await verifyConnectorConnection(
    connection.connector,
    connection.secrets,
  );

  if (result.ok && result.configPatch) {
    await queries.updateConnector(id, {
      config: {
        ...(connector.config as unknown as Record<string, unknown>),
        ...result.configPatch,
      } as unknown as SutConnectorConfig,
    });
  }
  await queries.markConnectorVerified(id, {
    ok: result.ok,
    error: result.error,
  });
  refresh();
  return { ok: result.ok, detail: result.detail, error: result.error };
}
