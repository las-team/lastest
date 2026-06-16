/**
 * Seed an API test (E1) from a captured network request. Bridges an observed
 * `NetworkRequest` (from a test run's network trace) into an editable
 * `ApiTestDefinition` so a user can reproduce a real call — headers, payload,
 * auth and observed status — then fine-tune it or flip it into a load test.
 *
 * Pure + isomorphic: no DB / network. Credentials in the produced definition
 * are the live values to execute against; the *displayed* copy is redacted
 * downstream by `renderApiDefinitionForCode` (./redact).
 */

import type {
  NetworkRequest,
  ApiTestDefinition,
  ApiAuth,
  ApiAssertion,
} from "@/lib/db/schema";

export interface ApiTestSeed {
  name: string;
  definition: ApiTestDefinition;
}

const SUPPORTED_METHODS = new Set<ApiTestDefinition["method"]>([
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
]);

/**
 * Headers we never copy verbatim: HTTP/2 pseudo-headers (`:method`, `:path`, …)
 * and connection/transport headers the runtime manages itself. Auth/cookie/
 * api-key headers are intentionally NOT here — they are kept (and redacted on
 * display) so the reproduced request still authenticates.
 */
const SKIP_HEADER_RE =
  /^(:|host$|content-length$|connection$|accept-encoding$|transfer-encoding$|keep-alive$|upgrade$|te$|proxy-connection$)/i;

/** Decode a base64 string in both browser (atob) and Node (Buffer) contexts. */
function decodeBase64(b64: string): string | null {
  try {
    if (typeof atob === "function") return atob(b64);
  } catch {
    /* fall through */
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const B = (globalThis as any).Buffer;
    if (B) return B.from(b64, "base64").toString("utf8");
  } catch {
    /* fall through */
  }
  return null;
}

/**
 * Map an `Authorization` header value into a typed `ApiAuth`. Returns null for
 * an unrecognised scheme so the caller keeps it as a plain header instead.
 */
function parseAuthHeader(value: string): ApiAuth | null {
  const v = value.trim();
  const bearer = /^Bearer\s+(.+)$/i.exec(v);
  if (bearer) return { type: "bearer", token: bearer[1].trim() };

  const basic = /^Basic\s+(.+)$/i.exec(v);
  if (basic) {
    const decoded = decodeBase64(basic[1].trim());
    if (decoded != null) {
      const idx = decoded.indexOf(":");
      const username = idx >= 0 ? decoded.slice(0, idx) : decoded;
      const password = idx >= 0 ? decoded.slice(idx + 1) : "";
      return { type: "basic", username, password };
    }
  }
  return null;
}

function deriveName(method: string, url: string): string {
  try {
    const path = new URL(url).pathname || "/";
    return `${method} ${path}`;
  } catch {
    return `${method} ${url}`;
  }
}

/** Build an editable API-test seed from a captured network request. */
export function networkRequestToApiTest(req: NetworkRequest): ApiTestSeed {
  const upper = (req.method || "GET").toUpperCase();
  const method = (
    SUPPORTED_METHODS.has(upper as ApiTestDefinition["method"]) ? upper : "GET"
  ) as ApiTestDefinition["method"];

  // Headers + auth extraction.
  let auth: ApiAuth | undefined;
  const headers: Record<string, string> = {};
  for (const [rawKey, rawVal] of Object.entries(req.requestHeaders ?? {})) {
    const key = rawKey.trim();
    if (!key || SKIP_HEADER_RE.test(key)) continue;
    if (key.toLowerCase() === "authorization" && !auth) {
      const parsed = parseAuthHeader(rawVal);
      if (parsed) {
        auth = parsed; // promoted to typed auth — don't also send as a header
        continue;
      }
    }
    headers[key] = rawVal;
  }

  // Body — JSON when parseable, otherwise the raw captured string.
  let body: unknown;
  if (method !== "GET" && req.postData) {
    try {
      body = JSON.parse(req.postData);
    } catch {
      body = req.postData;
    }
  }

  // Seed a single status assertion from the observed status.
  const observed = req.failed ? 0 : req.status;
  const statusAssertion: ApiAssertion =
    observed >= 200 && observed < 400
      ? { kind: "status", equals: observed }
      : { kind: "status", in: [200] };

  return {
    name: deriveName(method, req.url),
    definition: {
      method,
      url: req.url,
      headers: Object.keys(headers).length ? headers : undefined,
      body,
      auth,
      assertions: [statusAssertion],
    },
  };
}
