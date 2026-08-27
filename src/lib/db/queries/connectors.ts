/**
 * `sut_connectors` — connected Veeva Vault and Salesforce orgs.
 *
 * A connector is metadata plus a POINTER at a credential; it stores no secret
 * of its own. So unlike `credentials.ts` there is no masking to do here — the
 * whole row is safe to serialize. The one function that reaches through to
 * plaintext is `getConnectorForConnection`, named so a caller cannot arrive at
 * it by accident, and it is the only place in this module that decrypts.
 */
import { db } from "../index";
import { sutConnectors, repoCredentials, environments } from "../schema";
import type {
  SutConnector,
  SutConnectorType,
  SutConnectorConfig,
  SutConnectorAuthMethod,
  CredentialField,
  Environment,
} from "../schema";
import { decryptCredentialFields } from "@/lib/crypto-fields";
import { eq, and, isNull, asc } from "drizzle-orm";
import { v4 as uuid } from "uuid";

/** A connector plus the environment it belongs to, for list rendering. */
export interface ConnectorWithEnvironment extends SutConnector {
  environment: Environment | null;
}

export async function listConnectors(
  repositoryId: string,
  opts: { type?: SutConnectorType; environmentId?: string | null } = {},
): Promise<ConnectorWithEnvironment[]> {
  const rows = await db
    .select({ connector: sutConnectors, environment: environments })
    .from(sutConnectors)
    .leftJoin(environments, eq(sutConnectors.environmentId, environments.id))
    .where(
      and(
        eq(sutConnectors.repositoryId, repositoryId),
        ...(opts.type ? [eq(sutConnectors.type, opts.type)] : []),
        ...(opts.environmentId === undefined
          ? []
          : opts.environmentId === null
            ? [isNull(sutConnectors.environmentId)]
            : [eq(sutConnectors.environmentId, opts.environmentId)]),
      ),
    )
    .orderBy(asc(sutConnectors.type), asc(sutConnectors.name));
  return rows.map((r) => ({ ...r.connector, environment: r.environment }));
}

export async function getConnector(
  id: string,
): Promise<SutConnector | undefined> {
  const [row] = await db
    .select()
    .from(sutConnectors)
    .where(eq(sutConnectors.id, id));
  return row;
}

export async function createConnector(data: {
  repositoryId: string;
  environmentId?: string | null;
  type: SutConnectorType;
  name: string;
  label: string;
  authMethod: SutConnectorAuthMethod;
  config: SutConnectorConfig;
  credentialId?: string | null;
  createdBy?: string | null;
}): Promise<{ id: string }> {
  const id = uuid();
  const now = new Date();
  await db.insert(sutConnectors).values({
    id,
    repositoryId: data.repositoryId,
    environmentId: data.environmentId ?? null,
    type: data.type,
    name: data.name,
    label: data.label,
    authMethod: data.authMethod,
    config: data.config,
    credentialId: data.credentialId ?? null,
    createdBy: data.createdBy ?? null,
    createdAt: now,
    updatedAt: now,
  });
  return { id };
}

export async function updateConnector(
  id: string,
  data: {
    name?: string;
    label?: string;
    environmentId?: string | null;
    authMethod?: SutConnectorAuthMethod;
    config?: SutConnectorConfig;
    credentialId?: string | null;
  },
): Promise<void> {
  const patch: Partial<typeof sutConnectors.$inferInsert> = {
    updatedAt: new Date(),
  };
  if (data.name !== undefined) patch.name = data.name;
  if (data.label !== undefined) patch.label = data.label;
  if (data.environmentId !== undefined)
    patch.environmentId = data.environmentId;
  if (data.authMethod !== undefined) patch.authMethod = data.authMethod;
  if (data.config !== undefined) patch.config = data.config;
  if (data.credentialId !== undefined) patch.credentialId = data.credentialId;
  await db.update(sutConnectors).set(patch).where(eq(sutConnectors.id, id));
}

export async function deleteConnector(id: string): Promise<void> {
  await db.delete(sutConnectors).where(eq(sutConnectors.id, id));
}

/** True when `name` is taken in the same environment by a different connector. */
export async function connectorNameTaken(
  repositoryId: string,
  name: string,
  exceptId?: string,
  environmentId?: string | null,
): Promise<boolean> {
  const rows = await db
    .select({ id: sutConnectors.id })
    .from(sutConnectors)
    .where(
      and(
        eq(sutConnectors.repositoryId, repositoryId),
        eq(sutConnectors.name, name),
        environmentId
          ? eq(sutConnectors.environmentId, environmentId)
          : isNull(sutConnectors.environmentId),
      ),
    );
  return rows.some((r) => r.id !== exceptId);
}

/**
 * Record the outcome of a live connection test.
 *
 * The error is stored so the card can explain itself later without re-running
 * the check against a customer's production Vault. Callers must have scrubbed
 * it first — nothing here inspects the string.
 */
export async function markConnectorVerified(
  id: string,
  result: { ok: boolean; error?: string | null },
): Promise<void> {
  await db
    .update(sutConnectors)
    .set({
      lastVerifiedAt: result.ok ? new Date() : null,
      lastVerifyError: result.ok ? null : (result.error ?? "Unknown error"),
      updatedAt: new Date(),
    })
    .where(eq(sutConnectors.id, id));
}

export interface ConnectorConnection {
  connector: SutConnector;
  /** Decrypted credential fields, keyed by field key. */
  secrets: Record<string, string>;
}

/**
 * A connector with its credential decrypted, ready to authenticate with.
 *
 * The ONLY plaintext path in this module. Call it immediately before building
 * a client and let the result go out of scope — never attach it to anything
 * that gets serialized, logged, or returned to a client component.
 */
export async function getConnectorForConnection(
  id: string,
): Promise<ConnectorConnection | undefined> {
  const [row] = await db
    .select({ connector: sutConnectors, fields: repoCredentials.fields })
    .from(sutConnectors)
    .leftJoin(
      repoCredentials,
      eq(sutConnectors.credentialId, repoCredentials.id),
    )
    .where(eq(sutConnectors.id, id));
  if (!row) return undefined;

  const secrets: Record<string, string> = {};
  for (const f of decryptCredentialFields(
    (row.fields ?? []) as CredentialField[],
  )) {
    secrets[f.key] = f.value;
  }
  return { connector: row.connector, secrets };
}
