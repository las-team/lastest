/**
 * Secret redaction for API tests (P0). An ApiTestDefinition can carry auth
 * tokens / basic-auth passwords / custom auth headers, and a response body can
 * echo bearer tokens or JWTs. Those values must never be persisted into the
 * human-visible `tests.code` column (which is also snapshotted into
 * test_versions) or into `apiResult.responseSnippet`.
 *
 * The live `apiDefinition` jsonb remains the source of truth that the runner
 * executes against; only the *rendered / displayed* copies are redacted.
 */

import type { ApiTestDefinition, ApiAuth } from "@/lib/db/schema";

export const REDACTED = "••••••";

/** Header names whose values are secrets and must be masked when displayed. */
const SENSITIVE_HEADER_RE =
  /^(authorization|proxy-authorization|cookie|set-cookie|x-api-key|api-key|x-auth-token|x-access-token|x-amz-security-token)$/i;

function redactHeaders(
  headers?: Record<string, string>,
): Record<string, string> | undefined {
  if (!headers) return headers;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    out[k] = SENSITIVE_HEADER_RE.test(k.trim()) ? REDACTED : v;
  }
  return out;
}

function redactAuth(auth?: ApiAuth): ApiAuth | undefined {
  if (!auth) return auth;
  switch (auth.type) {
    case "bearer":
      return { type: "bearer", token: REDACTED };
    case "basic":
      return { type: "basic", username: auth.username, password: REDACTED };
    case "custom":
      return { type: "custom", headers: redactHeaders(auth.headers) ?? {} };
    default:
      return auth;
  }
}

/**
 * Return a deep copy of the definition with all credential material masked.
 * Use for anything that gets stored as displayable text or returned to a
 * surface that isn't the runner itself.
 */
export function redactApiDefinition(def: ApiTestDefinition): ApiTestDefinition {
  return {
    ...def,
    headers: redactHeaders(def.headers),
    auth: redactAuth(def.auth),
  };
}

/** Pretty-printed, credential-free JSON for the `tests.code` column. */
export function renderApiDefinitionForCode(def: ApiTestDefinition): string {
  return JSON.stringify(redactApiDefinition(def), null, 2);
}

// Token-shaped substrings to scrub out of free response text. This is a
// best-effort defense-in-depth net over the *displayed* response snippet — the
// structured credential fields (auth/headers) are already redacted separately —
// so it targets the high-signal, widely-issued token shapes rather than trying
// to be exhaustive:
//   - JWTs (three base64url segments)
//   - "Bearer <token>" / "Basic <token>" Authorization echoes
//   - GitHub PATs (ghp_/gho_/ghs_/github_pat_), Slack (xox*), Stripe/OpenAI-style
//     sk_/pk_/rk_ keys, Google API keys (AIza…)
//   - AWS access key ids (AKIA…) and `aws_secret_access_key`-style assignments
//   - generic `"api_key"/"token"/"secret"/"password": "<value>"` JSON pairs and
//     `api_key=<value>` query/form pairs
const RESPONSE_SECRET_PATTERNS: RegExp[] = [
  /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, // JWT
  /(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
  /\b(?:sk|pk|rk|ghp|gho|ghs|ghu|ghr|xox[baprs])[-_][A-Za-z0-9]{16,}\b/g,
  /\bAIza[0-9A-Za-z_-]{20,}\b/g, // Google API key
  /\bAKIA[0-9A-Z]{16}\b/g, // AWS access key id
  // "<secret-ish key>": "<value>" JSON pairs — lookbehind so only the value is
  // masked and the key name survives for readability.
  /(?<="(?:[a-z_]*(?:api[_-]?key|secret|token|password|passwd|access[_-]?key)[a-z_]*)"\s*:\s*")[^"]{6,}(?=")/gi,
  // key=value form/query pairs for the same key shapes.
  /(?<=\b[a-z_]*(?:api[_-]?key|secret|token|password|access[_-]?key)[a-z_]*=)[^&\s"']{6,}/gi,
];

/** Mask token-shaped secrets in a raw response body before persistence. */
export function redactSensitiveText(text: string): string {
  let out = text;
  for (const re of RESPONSE_SECRET_PATTERNS) out = out.replace(re, REDACTED);
  return out;
}
