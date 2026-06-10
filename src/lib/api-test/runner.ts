/**
 * Headless HTTP engine for API tests (E1). Executes a single request without a
 * browser and evaluates response assertions. The assertion evaluation is a pure
 * function (`evaluateApiAssertions`) so it is unit-testable without network.
 */

import Ajv from 'ajv';
import { validateTargetUrl, SsrfBlockedError } from '@/lib/url-diff/ssrf';
import { DEFAULT_API_TEST_SETTINGS } from '@/lib/db/schema';
import type { ApiTestDefinition, ApiAssertion, ApiAuth } from '@/lib/db/schema';
import type { ApiAssertionResult, ApiResponseSnapshot, ApiTestResult } from './types';

const ajv = new Ajv({ allErrors: true, strict: false });

/** Resolve a value from a JSON object via dot-path (supports array indices). */
function getValueByPath(obj: unknown, path: string): unknown {
  let current: unknown = obj;
  for (const part of path.split('.')) {
    if (current === null || current === undefined || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function looseEquals(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  return String(a) === String(b);
}

/** Pure evaluation of assertions against a captured response. No I/O. */
export function evaluateApiAssertions(
  assertions: ApiAssertion[],
  res: ApiResponseSnapshot,
): ApiAssertionResult[] {
  return assertions.map((a): ApiAssertionResult => {
    switch (a.kind) {
      case 'status': {
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
          description: a.description ?? `status ${a.in ? `in [${a.in.join(', ')}]` : a.equals !== undefined ? `== ${a.equals}` : 'is 2xx'}`,
          expected: a.in ?? a.equals ?? '2xx',
          actual: res.statusCode,
        };
      }
      case 'header': {
        const name = (a.header ?? '').toLowerCase();
        const actual = res.headers[name];
        const ok = a.value === undefined ? actual !== undefined : looseEquals(actual, a.value);
        return {
          kind: a.kind,
          passed: ok,
          description: a.description ?? `header "${a.header}"${a.value !== undefined ? ` == ${a.value}` : ' present'}`,
          expected: a.value,
          actual,
        };
      }
      case 'jsonPath': {
        const actual = a.path ? getValueByPath(res.json, a.path) : undefined;
        const ok = a.value === undefined ? actual !== undefined : looseEquals(actual, a.value);
        return {
          kind: a.kind,
          passed: ok,
          description: a.description ?? `json "${a.path}"${a.value !== undefined ? ` == ${a.value}` : ' present'}`,
          expected: a.value,
          actual,
        };
      }
      case 'jsonSchema': {
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
          description: a.description ?? 'response matches JSON schema',
          actual: ok ? 'valid' : errText,
        };
      }
      case 'bodyContains': {
        const needle = String(a.value ?? '');
        const ok = res.rawText.includes(needle);
        return {
          kind: a.kind,
          passed: ok,
          description: a.description ?? `body contains "${needle}"`,
          expected: needle,
        };
      }
      case 'latencyMs': {
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
        return { kind: a.kind, passed: false, description: `unknown assertion kind: ${a.kind}` };
    }
  });
}

function applyAuth(headers: Record<string, string>, auth?: ApiAuth): void {
  if (!auth || auth.type === 'none') return;
  if (auth.type === 'bearer') {
    headers['Authorization'] = `Bearer ${auth.token}`;
  } else if (auth.type === 'basic') {
    headers['Authorization'] = `Basic ${Buffer.from(`${auth.username}:${auth.password}`).toString('base64')}`;
  } else if (auth.type === 'custom') {
    Object.assign(headers, auth.headers);
  }
}

export interface RunApiTestContext {
  /** Prefix for relative `url` values (the repo's baseUrl). */
  baseUrl?: string;
  /** Skip the per-request SSRF/DNS validation. Only set by callers that
   *  validated the same URL immediately beforehand (e.g. the load runner). */
  skipSsrfCheck?: boolean;
}

/** Resolve an absolute URL, optionally joining a relative path to baseUrl, and
 *  appending query params. Exported for testing. */
export function resolveApiUrl(def: ApiTestDefinition, baseUrl?: string): string {
  const base = /^https?:\/\//i.test(def.url)
    ? def.url
    : `${(baseUrl ?? '').replace(/\/+$/, '')}${def.url.startsWith('/') ? '' : '/'}${def.url}`;
  if (!def.query || Object.keys(def.query).length === 0) return base;
  const u = new URL(base);
  for (const [k, v] of Object.entries(def.query)) u.searchParams.set(k, v);
  return u.toString();
}

export async function runApiTest(def: ApiTestDefinition, ctx: RunApiTestContext = {}): Promise<ApiTestResult> {
  const started = Date.now();
  let url: string;
  try {
    url = resolveApiUrl(def, ctx.baseUrl);
  } catch (e) {
    return { passed: false, statusCode: null, latencyMs: 0, assertionResults: [], error: `Invalid URL: ${e instanceof Error ? e.message : String(e)}` };
  }

  // SSRF guard — API tests can target arbitrary URLs from the server. The load
  // runner validates once up front and sets skipSsrfCheck for the inner storm.
  if (!ctx.skipSsrfCheck) {
    try {
      await validateTargetUrl(url);
    } catch (e) {
      const msg = e instanceof SsrfBlockedError ? `Blocked by SSRF guard: ${e.message}` : String(e);
      return { passed: false, statusCode: null, latencyMs: 0, assertionResults: [], error: msg };
    }
  }

  const headers: Record<string, string> = { 'Content-Type': 'application/json', ...def.headers };
  applyAuth(headers, def.auth);

  const timeoutMs = def.timeoutMs ?? DEFAULT_API_TEST_SETTINGS.timeoutMs;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: def.method,
      headers,
      body: def.body !== undefined && def.method !== 'GET' ? JSON.stringify(def.body) : undefined,
      signal: controller.signal,
    });
    const latencyMs = Date.now() - started;
    const rawText = await response.text();
    let json: unknown = undefined;
    const ct = response.headers.get('content-type') ?? '';
    if (ct.includes('application/json') || ct.includes('+json')) {
      try { json = JSON.parse(rawText); } catch { /* leave undefined */ }
    }
    const headerMap: Record<string, string> = {};
    response.headers.forEach((v, k) => { headerMap[k.toLowerCase()] = v; });

    const assertionResults = evaluateApiAssertions(def.assertions ?? [], {
      statusCode: response.status,
      headers: headerMap,
      json,
      rawText,
      latencyMs,
    });

    return {
      passed: assertionResults.every((r) => r.passed),
      statusCode: response.status,
      latencyMs,
      assertionResults,
      responseSnippet: rawText.slice(0, 2048),
    };
  } catch (e) {
    const aborted = e instanceof Error && e.name === 'AbortError';
    return {
      passed: false,
      statusCode: null,
      latencyMs: Date.now() - started,
      assertionResults: [],
      error: aborted ? `Request timed out after ${timeoutMs}ms` : (e instanceof Error ? e.message : String(e)),
    };
  } finally {
    clearTimeout(timer);
  }
}
