/**
 * Field-level encryption helpers for credentials nested inside JSONB columns.
 *
 * These wrap the AES-256-GCM primitives in `./crypto` with the shape-specific
 * logic for the two JSONB stores that hold user-provided app credentials:
 *   - setup_configs.authConfig  (bearer token / basic-auth password / headers)
 *   - agent_sessions.metadata.quickstartPassword  (QuickStart app login)
 *   - repo_credentials.fields  (the named logins tests inject as `credentials`)
 *
 * The explorer-knowledge helpers that used to live here left with the plugin.
 * It encrypts its own credential column through `ExplorerHost.encryptField`,
 * which is the same primitive reached a different way — see
 * `plugins/explorer/src/host.ts` for why field crypto is a core concern the
 * capability contract does not yet cover.
 *
 * Kept DB-free (depends only on `./crypto` + schema *types*) so the encrypt/
 * decrypt round-trip is unit-testable without a database. The query layers in
 * queries/setup.ts and queries/integrations.ts apply these on write/read.
 *
 * Invariants (shared with the flat-column helpers in ./crypto):
 *   - encrypt-on-write is guarded by ENC_PREFIX → idempotent, never double-encrypts
 *   - decrypt-on-read passes plaintext through → backward-compatible with legacy rows
 */

import { encrypt, decryptField, ENC_PREFIX } from "./crypto";
import type {
  SetupAuthConfig,
  AgentSessionMetadata,
  CredentialField,
} from "./db/schema";

function encField(value: string): string {
  return value.startsWith(ENC_PREFIX) ? value : encrypt(value);
}

// ── setup_configs.authConfig ────────────────────────────────────────────────
// Encrypts token / password / each header value; `username` stays plaintext (a
// low-sensitivity identifier, like an email).

export function encryptAuthConfig(
  cfg: SetupAuthConfig | null | undefined,
): SetupAuthConfig | null {
  if (!cfg) return cfg ?? null;
  const out: SetupAuthConfig = { ...cfg };
  if (out.token != null) out.token = encField(out.token);
  if (out.password != null) out.password = encField(out.password);
  if (out.headers) {
    out.headers = Object.fromEntries(
      Object.entries(out.headers).map(([k, v]) => [k, encField(v)]),
    );
  }
  return out;
}

export function decryptAuthConfig(
  cfg: SetupAuthConfig | null | undefined,
): SetupAuthConfig | null {
  if (!cfg) return cfg ?? null;
  const out: SetupAuthConfig = { ...cfg };
  if (out.token != null) out.token = decryptField(out.token);
  if (out.password != null) out.password = decryptField(out.password);
  if (out.headers) {
    out.headers = Object.fromEntries(
      Object.entries(out.headers).map(([k, v]) => [k, decryptField(v)]),
    );
  }
  return out;
}

// ── agent_sessions.metadata credential fields ───────────────────────────────
// Encrypts the password sub-field and the Explore auth-context prose (which
// routinely contains a password); every other metadata field (including the
// email) passes through untouched.

export function encryptSessionMetadata<
  T extends AgentSessionMetadata | null | undefined,
>(meta: T): T {
  if (!meta) return meta;
  let out = meta;
  if (out.quickstartPassword != null) {
    out = { ...out, quickstartPassword: encField(out.quickstartPassword) };
  }
  if (out.qaAuthContext != null) {
    out = { ...out, qaAuthContext: encField(out.qaAuthContext) };
  }
  return out;
}

export function decryptSessionMetadata<
  T extends AgentSessionMetadata | null | undefined,
>(meta: T): T {
  if (!meta) return meta;
  let out = meta;
  if (out.quickstartPassword != null) {
    out = { ...out, quickstartPassword: decryptField(out.quickstartPassword) };
  }
  if (out.qaAuthContext != null) {
    out = { ...out, qaAuthContext: decryptField(out.qaAuthContext) };
  }
  return out;
}

// ── repo_credentials.fields ────────────────────────────────────────────────
// Encrypts the value of every field flagged `secret`; non-secret fields (a
// username, a fixture document id) stay in the clear so the Credentials list
// can render "svc-qa@acme.com / ••••••" without a decrypt per row.

export function encryptCredentialFields(
  fields: CredentialField[] | null | undefined,
): CredentialField[] {
  if (!fields) return [];
  return fields.map((f) =>
    f.secret ? { ...f, value: encField(f.value) } : { ...f },
  );
}

export function decryptCredentialFields(
  fields: CredentialField[] | null | undefined,
): CredentialField[] {
  if (!fields) return [];
  return fields.map((f) =>
    f.secret ? { ...f, value: decryptField(f.value) } : { ...f },
  );
}

/**
 * Strip every secret value, keeping the field shape. This is what leaves the
 * server for the browser: the Credentials UI is write-only by design, so no
 * read path ever returns a secret's plaintext (see `docs/credentials-plan.md`
 * §4 — there is no audit log to record a reveal against yet).
 */
export function maskCredentialFields(
  fields: CredentialField[] | null | undefined,
): CredentialField[] {
  if (!fields) return [];
  return fields.map((f) => (f.secret ? { ...f, value: "" } : { ...f }));
}
