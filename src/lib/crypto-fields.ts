/**
 * Field-level encryption helpers for credentials nested inside JSONB columns.
 *
 * These wrap the AES-256-GCM primitives in `./crypto` with the shape-specific
 * logic for the two JSONB stores that hold user-provided app credentials:
 *   - setup_configs.authConfig  (bearer token / basic-auth password / headers)
 *   - agent_sessions.metadata.quickstartPassword  (QuickStart app login)
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
  AgentKnowledge,
  NewAgentKnowledge,
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

// ── agent_sessions.metadata.quickstartPassword ──────────────────────────────
// Encrypts only the password sub-field; every other metadata field (including
// the email) passes through untouched.

export function encryptSessionMetadata<
  T extends AgentSessionMetadata | null | undefined,
>(meta: T): T {
  if (!meta || meta.quickstartPassword == null) return meta;
  if (meta.quickstartPassword.startsWith(ENC_PREFIX)) return meta;
  return { ...meta, quickstartPassword: encrypt(meta.quickstartPassword) };
}

export function decryptSessionMetadata<
  T extends AgentSessionMetadata | null | undefined,
>(meta: T): T {
  if (!meta || meta.quickstartPassword == null) return meta;
  return { ...meta, quickstartPassword: decryptField(meta.quickstartPassword) };
}

// ── agent_knowledge.credPassword ────────────────────────────────────────────
// Explorer-agent knowledge notes may carry page-scoped login credentials.
// Only the password is encrypted; credEmail stays plaintext (identifier).

export function encryptKnowledgeRow<
  T extends Pick<NewAgentKnowledge, "credPassword"> | null | undefined,
>(row: T): T {
  if (!row || row.credPassword == null) return row;
  return { ...row, credPassword: encField(row.credPassword) };
}

export function decryptKnowledgeRow<
  T extends Pick<AgentKnowledge, "credPassword"> | null | undefined,
>(row: T): T {
  if (!row || row.credPassword == null) return row;
  return { ...row, credPassword: decryptField(row.credPassword) };
}
