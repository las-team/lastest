/**
 * Test double for `fetch`: routes requests to canned replies and records every
 * call so tests can assert on what was sent. Not part of the public API.
 */
export interface FakeRequest {
  url: URL;
  method: string;
  headers: Record<string, string>;
  body: string | null;
  /** Decoded `q` parameter for `/query` and `/tooling/query` calls. */
  soql: string | null;
}

export interface FakeReply {
  status?: number;
  json?: unknown;
  text?: string;
  headers?: Record<string, string>;
}

export interface Route {
  method?: string;
  /** String = pathname prefix or substring test; RegExp tested against the full URL; function gets the request. */
  match: string | RegExp | ((req: FakeRequest) => boolean);
  reply: (
    req: FakeRequest,
    callIndex: number,
  ) => FakeReply | Promise<FakeReply>;
}

export interface FakeFetch {
  fetch: (url: string, init?: RequestInit) => Promise<Response>;
  calls: FakeRequest[];
  /** Calls whose URL contains `fragment`. */
  callsTo(fragment: string): FakeRequest[];
  /** SOQL texts sent to `/query` (not tooling). */
  soqls(): string[];
  /** SOQL texts sent to `/tooling/query`. */
  toolingSoqls(): string[];
}

function toRequest(url: string, init?: RequestInit): FakeRequest {
  const u = new URL(url);
  const headers: Record<string, string> = {};
  const raw = init?.headers;
  if (raw) {
    if (raw instanceof Headers)
      raw.forEach((v, k) => (headers[k.toLowerCase()] = v));
    else if (Array.isArray(raw))
      for (const [k, v] of raw) headers[k.toLowerCase()] = v;
    else
      for (const [k, v] of Object.entries(raw))
        headers[k.toLowerCase()] = String(v);
  }
  const body = typeof init?.body === "string" ? init.body : null;
  const soql = /\/query$/.test(u.pathname) ? u.searchParams.get("q") : null;
  return {
    url: u,
    method: (init?.method ?? "GET").toUpperCase(),
    headers,
    body,
    soql,
  };
}

function matches(route: Route, req: FakeRequest): boolean {
  if (route.method && route.method.toUpperCase() !== req.method) return false;
  if (typeof route.match === "string")
    return req.url.href.includes(route.match);
  if (route.match instanceof RegExp) return route.match.test(req.url.href);
  return route.match(req);
}

export function fakeFetch(routes: Route[]): FakeFetch {
  const calls: FakeRequest[] = [];
  const perRoute = new Map<Route, number>();
  const fetch = async (url: string, init?: RequestInit): Promise<Response> => {
    const req = toRequest(url, init);
    calls.push(req);
    const route = routes.find((r) => matches(r, req));
    if (!route) {
      return new Response(
        JSON.stringify([
          {
            errorCode: "NOT_FOUND",
            message: `no fake route for ${req.method} ${req.url.href}`,
          },
        ]),
        {
          status: 404,
          headers: { "content-type": "application/json" },
        },
      );
    }
    const idx = perRoute.get(route) ?? 0;
    perRoute.set(route, idx + 1);
    const reply = await route.reply(req, idx);
    const status = reply.status ?? 200;
    const headers: Record<string, string> = { ...reply.headers };
    let body: string | null = null;
    if (reply.json !== undefined) {
      body = JSON.stringify(reply.json);
      headers["content-type"] ??= "application/json";
    } else if (reply.text !== undefined) {
      body = reply.text;
    }
    return new Response(status === 204 || status === 304 ? null : body, {
      status,
      headers,
    });
  };
  return {
    fetch,
    calls,
    callsTo: (fragment) => calls.filter((c) => c.url.href.includes(fragment)),
    soqls: () =>
      calls
        .filter((c) => c.soql && !c.url.pathname.includes("/tooling/"))
        .map((c) => c.soql!),
    toolingSoqls: () =>
      calls
        .filter((c) => c.soql && c.url.pathname.includes("/tooling/"))
        .map((c) => c.soql!),
  };
}

/** Wraps rows in a SOQL result envelope. */
export function queryResult<T>(
  records: T[],
  nextRecordsUrl?: string,
): FakeReply {
  return {
    json: {
      totalSize: records.length,
      done: !nextRecordsUrl,
      ...(nextRecordsUrl ? { nextRecordsUrl } : {}),
      records,
    },
  };
}

/** Salesforce-style JSON error array. */
export function sfdcError(
  status: number,
  errorCode: string,
  message: string,
): FakeReply {
  return { status, json: [{ errorCode, message }] };
}
