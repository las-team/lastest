/**
 * Hermetic `fetch` stand-in for the Vault client tests: routes are matched
 * in order (method + path), consumed once unless `persist: true`, and every
 * request is captured (method, url, headers, decoded body) for assertions.
 * Not a test file — imported by the `*.test.ts` files beside it.
 */
import type { FetchLike } from "./http";

export interface CapturedRequest {
  method: string;
  url: string;
  pathname: string;
  search: URLSearchParams;
  /** Lower-cased header names. */
  headers: Record<string, string>;
  bodyText: string | undefined;
  /** Parsed when the body was JSON. */
  json: unknown;
  /** Parsed when the body was form-encoded. */
  form: URLSearchParams | undefined;
  /** Multipart entries when the body was `FormData`. */
  formData: FormData | undefined;
}

export interface MockResponseSpec {
  status?: number;
  headers?: Record<string, string>;
  /** Object/array → JSON; string → text (content type from `contentType`). */
  body?: unknown;
  contentType?: string;
  /** Reject the fetch with this error instead of responding. */
  throws?: unknown;
}

export interface MockRoute extends MockResponseSpec {
  method?: string;
  /** Exact pathname, a pathname prefix (`startsWith` when it ends with `*`), or a RegExp on the full URL. */
  path: string | RegExp;
  /** Match again after being used (default: consumed after one hit). */
  persist?: boolean;
  /** Compute the response per request (wins over the static fields). */
  handler?: (req: CapturedRequest) => MockResponseSpec;
}

export interface MockFetch {
  fetch: FetchLike;
  calls: CapturedRequest[];
  /** Remaining unconsumed non-persistent routes. */
  pending(): MockRoute[];
  /** Append routes at runtime. */
  add(...routes: MockRoute[]): void;
}

export function vaultHeaders(
  extra: Record<string, string> = {},
): Record<string, string> {
  return {
    "X-VaultAPI-BurstLimit": "2000",
    "X-VaultAPI-BurstLimitRemaining": "1999",
    "X-VaultAPI-ResponseDelay": "0",
    "X-VaultAPI-ExecutionId": "exec-1",
    ...extra,
  };
}

function matches(route: MockRoute, req: CapturedRequest): boolean {
  if (route.method && route.method.toUpperCase() !== req.method) return false;
  if (route.path instanceof RegExp) return route.path.test(req.url);
  if (route.path.endsWith("*"))
    return req.pathname.startsWith(route.path.slice(0, -1));
  return req.pathname === route.path;
}

async function capture(
  input: string,
  init: RequestInit,
): Promise<CapturedRequest> {
  const u = new URL(input);
  const headers: Record<string, string> = {};
  const h = init.headers;
  if (h instanceof Headers) h.forEach((v, k) => (headers[k.toLowerCase()] = v));
  else if (Array.isArray(h))
    for (const [k, v] of h) headers[k.toLowerCase()] = v;
  else if (h)
    for (const [k, v] of Object.entries(h)) headers[k.toLowerCase()] = v;
  const req: CapturedRequest = {
    method: (init.method ?? "GET").toUpperCase(),
    url: input,
    pathname: u.pathname,
    search: u.searchParams,
    headers,
    bodyText: undefined,
    json: undefined,
    form: undefined,
    formData: undefined,
  };
  const b = init.body;
  if (typeof b === "string") req.bodyText = b;
  else if (b instanceof URLSearchParams) req.bodyText = b.toString();
  else if (typeof FormData !== "undefined" && b instanceof FormData)
    req.formData = b;
  else if (b instanceof Uint8Array) req.bodyText = new TextDecoder().decode(b);
  const ct = headers["content-type"] ?? "";
  if (req.bodyText !== undefined) {
    if (/json/.test(ct)) {
      try {
        req.json = JSON.parse(req.bodyText);
      } catch {
        req.json = undefined;
      }
    } else if (/x-www-form-urlencoded/.test(ct))
      req.form = new URLSearchParams(req.bodyText);
  }
  return req;
}

function toResponse(spec: MockResponseSpec): Response {
  const status = spec.status ?? 200;
  const headers = new Headers(spec.headers ?? vaultHeaders());
  let body: string | undefined;
  if (spec.body === undefined) body = undefined;
  else if (typeof spec.body === "string") {
    body = spec.body;
    if (!headers.has("content-type"))
      headers.set("content-type", spec.contentType ?? "text/plain");
  } else {
    body = JSON.stringify(spec.body);
    if (!headers.has("content-type"))
      headers.set("content-type", spec.contentType ?? "application/json");
  }
  return new Response(body, { status, headers });
}

export function mockFetch(routes: MockRoute[] = []): MockFetch {
  const table = [...routes];
  const calls: CapturedRequest[] = [];
  const fetch: FetchLike = async (input, init) => {
    const req = await capture(input, init);
    calls.push(req);
    const idx = table.findIndex((r) => matches(r, req));
    if (idx < 0)
      throw new Error(
        `mockFetch: no route for ${req.method} ${req.pathname} (remaining: ${
          table.map((r) => `${r.method ?? "*"} ${String(r.path)}`).join(", ") ||
          "none"
        })`,
      );
    const route = table[idx];
    if (!route.persist) table.splice(idx, 1);
    const spec = route.handler ? route.handler(req) : route;
    if (spec.throws !== undefined) throw spec.throws;
    return toResponse(spec);
  };
  return {
    fetch,
    calls,
    pending: () => table.filter((r) => !r.persist),
    add: (...more) => {
      table.push(...more);
    },
  };
}

/** A standard successful auth envelope for `vaultDns`. */
export function authBody(
  vaultDns = "acme-crm.veevavault.com",
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    responseStatus: "SUCCESS",
    sessionId: "SESSION-1",
    userId: 12345,
    vaultId: 1001,
    vaultIds: [
      { id: 1001, name: "ACME CRM", url: `https://${vaultDns}/api` },
      {
        id: 1002,
        name: "ACME QualityDocs",
        url: "https://acme-qd.veevavault.com/api",
      },
    ],
    ...overrides,
  };
}

export function meBody(id = 12345): Record<string, unknown> {
  return {
    responseStatus: "SUCCESS",
    users: [
      {
        user: {
          id,
          user_name__v: "migration@acme.com",
          user_first_name__v: "Mig",
          user_last_name__v: "User",
          active__v: true,
        },
      },
    ],
  };
}
