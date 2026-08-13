/**
 * Headless HTTP engine for API tests (E1). Executes a single request without a
 * browser and evaluates response assertions. The assertion evaluation is a pure
 * function (`evaluateApiAssertions`) so it is unit-testable without network.
 *
 * ### The request itself is core's to make
 *
 * This module does not call `fetch`. It hands the resolved URL and headers to
 * `host.fetchGuarded`, which owns the SSRF pre-flight, the connect-time IP
 * re-validation and the timeout — see `plugins/api-test/src/host.ts`. The
 * package has no way to reach the network otherwise, which is the point:
 * `core-scope.md` §2 makes outbound requests to a tenant-supplied URL a core
 * boundary, and a boundary a feature can opt out of is not one.
 *
 * `host` is an argument rather than something read from the wiring slot
 * because the only caller is core's executor, on the hot path of every build.
 * See `wiring.ts`.
 */

import Ajv from "ajv";
import type {
  ApiTestDefinition,
  ApiAssertion,
  ApiAuth,
} from "@lastest/eb-protocol";

import type { ApiTestHost } from "./host";
import { redactSensitiveText } from "./redact";
import type {
  ApiAssertionResult,
  ApiResponseSnapshot,
  ApiTestResult,
} from "./types";

/**
 * Fallback per-request timeout when `ApiTestDefinition.timeoutMs` is unset.
 *
 * Was `DEFAULT_API_TEST_SETTINGS.timeoutMs` in the core schema's settings
 * module. It is this engine's default and nothing else read it, so it moved
 * with the engine rather than staying behind as a constant core exports for
 * one plugin.
 */
export const DEFAULT_API_TEST_TIMEOUT_MS = 15_000;

const ajv = new Ajv({ allErrors: true, strict: false });

/** Resolve a value from a JSON object via dot-path (supports array indices). */
function getValueByPath(obj: unknown, path: string): unknown {
  let current: unknown = obj;
  for (const part of path.split(".")) {
    if (
      current === null ||
      current === undefined ||
      typeof current !== "object"
    )
      return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

/**
 * Compare an actual response value against an assertion's expected value.
 *
 * Type-aware (the default): the comparison is keyed off the *expected* value's
 * type, which is what the assertion declares. A numeric expectation matches a
 * numeric string ("200" == 200) but never a non-numeric one; a boolean
 * expectation matches only a real boolean — so `true` no longer silently
 * matches the string "true". A string expectation matches the stringified
 * primitive (so a form-typed "123" still matches a JSON number 123).
 *
 * `strict`: exact, same-type `===` with no coercion at all.
 */
export function valueMatches(
  expected: string | number | boolean,
  actual: unknown,
  strict?: boolean,
): boolean {
  if (strict) return actual === expected;
  if (actual === expected) return true;
  switch (typeof expected) {
    case "number":
      if (typeof actual === "number") return actual === expected;
      if (typeof actual === "string" && actual.trim() !== "")
        return Number(actual) === expected;
      return false;
    case "boolean":
      // No string coercion — only a real boolean can satisfy a boolean check.
      return actual === expected;
    case "string":
      return (
        (typeof actual === "string" ||
          typeof actual === "number" ||
          typeof actual === "boolean") &&
        String(actual) === expected
      );
    default:
      return false;
  }
}

/** Pure evaluation of assertions against a captured response. No I/O. */
export function evaluateApiAssertions(
  assertions: ApiAssertion[],
  res: ApiResponseSnapshot,
): ApiAssertionResult[] {
  return assertions.map((a): ApiAssertionResult => {
    switch (a.kind) {
      case "status": {
        // No explicit expectation → any 2xx passes (a bare { kind: 'status' }
        // must not compare against undefined and always fail).
        const ok = a.in
          ? a.in.includes(res.statusCode)
          : a.equals !== undefined
            ? res.statusCode === a.equals
            : res.statusCode >= 200 && res.statusCode < 300;
        return {
          kind: a.kind,
          passed: ok,
          description:
            a.description ??
            `status ${a.in ? `in [${a.in.join(", ")}]` : a.equals !== undefined ? `== ${a.equals}` : "is 2xx"}`,
          expected: a.in ?? a.equals ?? "2xx",
          actual: res.statusCode,
        };
      }
      case "header": {
        const name = (a.header ?? "").toLowerCase();
        const actual = res.headers[name];
        const ok =
          a.value === undefined
            ? actual !== undefined
            : valueMatches(a.value, actual, a.strict);
        return {
          kind: a.kind,
          passed: ok,
          description:
            a.description ??
            `header "${a.header}"${a.value !== undefined ? ` == ${a.value}` : " present"}`,
          expected: a.value,
          actual,
        };
      }
      case "jsonPath": {
        const actual = a.path ? getValueByPath(res.json, a.path) : undefined;
        const ok =
          a.value === undefined
            ? actual !== undefined
            : valueMatches(a.value, actual, a.strict);
        return {
          kind: a.kind,
          passed: ok,
          description:
            a.description ??
            `json "${a.path}"${a.value !== undefined ? ` == ${a.value}` : " present"}`,
          expected: a.value,
          actual,
        };
      }
      case "jsonSchema": {
        let ok = false;
        let errText: string | undefined;
        try {
          const validate = ajv.compile((a.schema ?? {}) as object);
          ok = validate(res.json) as boolean;
          if (!ok) errText = ajv.errorsText(validate.errors);
        } catch (e) {
          errText = e instanceof Error ? e.message : String(e);
        }
        return {
          kind: a.kind,
          passed: ok,
          description: a.description ?? "response matches JSON schema",
          actual: ok ? "valid" : errText,
        };
      }
      case "bodyContains": {
        const needle = String(a.value ?? "");
        const ok = res.rawText.includes(needle);
        return {
          kind: a.kind,
          passed: ok,
          description: a.description ?? `body contains "${needle}"`,
          expected: needle,
        };
      }
      case "latencyMs": {
        const ok = res.latencyMs <= (a.maxMs ?? Infinity);
        return {
          kind: a.kind,
          passed: ok,
          description: a.description ?? `latency <= ${a.maxMs}ms`,
          expected: a.maxMs,
          actual: res.latencyMs,
        };
      }
      default:
        return {
          kind: a.kind,
          passed: false,
          description: `unknown assertion kind: ${a.kind}`,
        };
    }
  });
}

function applyAuth(headers: Record<string, string>, auth?: ApiAuth): void {
  if (!auth || auth.type === "none") return;
  if (auth.type === "bearer") {
    headers["Authorization"] = `Bearer ${auth.token}`;
  } else if (auth.type === "basic") {
    headers["Authorization"] =
      `Basic ${Buffer.from(`${auth.username}:${auth.password}`).toString("base64")}`;
  } else if (auth.type === "custom") {
    Object.assign(headers, auth.headers);
  }
}

export interface RunApiTestContext {
  /** Prefix for relative `url` values (the repo's baseUrl). */
  baseUrl?: string;
}

/** Resolve an absolute URL, optionally joining a relative path to baseUrl, and
 *  appending query params. Exported for testing. */
export function resolveApiUrl(
  def: ApiTestDefinition,
  baseUrl?: string,
): string {
  const base = /^https?:\/\//i.test(def.url)
    ? def.url
    : `${(baseUrl ?? "").replace(/\/+$/, "")}${def.url.startsWith("/") ? "" : "/"}${def.url}`;
  if (!def.query || Object.keys(def.query).length === 0) return base;
  const u = new URL(base);
  for (const [k, v] of Object.entries(def.query)) u.searchParams.set(k, v);
  return u.toString();
}

/**
 * Execute one API test.
 *
 * `host` supplies the guarded transport (see the module header). Every failure
 * mode — invalid URL, SSRF block, timeout, transport error, failed assertion —
 * comes back as a resolved `ApiTestResult`, never a throw: a test that cannot
 * reach its target is a failed test, and the executor records it as one.
 */
export async function runApiTest(
  host: ApiTestHost,
  def: ApiTestDefinition,
  ctx: RunApiTestContext = {},
): Promise<ApiTestResult> {
  const started = Date.now();
  let url: string;
  try {
    url = resolveApiUrl(def, ctx.baseUrl);
  } catch (e) {
    return {
      passed: false,
      statusCode: null,
      latencyMs: 0,
      assertionResults: [],
      error: `Invalid URL: ${e instanceof Error ? e.message : String(e)}`,
    };
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...def.headers,
  };
  applyAuth(headers, def.auth);

  const timeoutMs = def.timeoutMs ?? DEFAULT_API_TEST_TIMEOUT_MS;

  // The SSRF guard, the connect-time IP re-validation and the timeout all live
  // behind this one call. There is no branch that skips them, and no `fetch`
  // in this package to skip them with.
  const response = await host.fetchGuarded(url, {
    method: def.method,
    headers,
    body:
      def.body !== undefined && def.method !== "GET"
        ? JSON.stringify(def.body)
        : undefined,
    timeoutMs,
  });

  const latencyMs = Date.now() - started;

  if (!response.ok) {
    return {
      passed: false,
      statusCode: null,
      latencyMs,
      assertionResults: [],
      error: response.error,
    };
  }

  const rawText = response.text;
  let json: unknown = undefined;
  const ct = response.headers["content-type"] ?? "";
  if (ct.includes("application/json") || ct.includes("+json")) {
    try {
      json = JSON.parse(rawText);
    } catch {
      /* leave undefined */
    }
  }

  const assertionResults = evaluateApiAssertions(def.assertions ?? [], {
    statusCode: response.status,
    headers: response.headers,
    json,
    rawText,
    latencyMs,
  });

  return {
    passed: assertionResults.every((r) => r.passed),
    statusCode: response.status,
    latencyMs,
    assertionResults,
    responseSnippet: redactSensitiveText(rawText.slice(0, 2048)),
  };
}
