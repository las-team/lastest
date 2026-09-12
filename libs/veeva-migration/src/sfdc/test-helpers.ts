/**
 * Hermetic `fetch` double for the SFDC client tests: route table matched on
 * method + URL, recorded calls, canned token endpoint. Not a test file.
 */
import { generateKeyPairSync } from "node:crypto";
import { to18 } from "../transform/ids";

export const LOGIN_URL = "https://login.salesforce.com";
export const INSTANCE_URL = "https://acme.my.salesforce.com";
export const API = `${INSTANCE_URL}/services/data/v67.0`;
export const ORG_ID = to18("00D000000000001");
export const USER_ID = to18("005000000000001");
export const IDENTITY_URL = `${LOGIN_URL}/id/${ORG_ID}/${USER_ID}`;

export interface RecordedCall {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: string | null;
}

export interface RouteRequest extends RecordedCall {
  /** 1-based hit count for this route. */
  hit: number;
  parsed: URL;
}

export type RouteReply =
  | Response
  | {
      status?: number;
      json?: unknown;
      text?: string;
      headers?: Record<string, string>;
    };

export interface Route {
  method?: string;
  /** Substring or RegExp matched against the full URL. */
  match: string | RegExp;
  reply: (req: RouteRequest) => RouteReply | Promise<RouteReply>;
}

function headersToRecord(h: HeadersInit | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!h) return out;
  if (h instanceof Headers) h.forEach((v, k) => (out[k.toLowerCase()] = v));
  else if (Array.isArray(h)) for (const [k, v] of h) out[k.toLowerCase()] = v;
  else for (const [k, v] of Object.entries(h)) out[k.toLowerCase()] = v;
  return out;
}

export function jsonReply(
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

export function textReply(
  body: string,
  status = 200,
  headers: Record<string, string> = {},
): Response {
  return new Response(body, {
    status,
    headers: { "Content-Type": "text/csv", ...headers },
  });
}

/** Standard OAuth token response (`tokenN` increments per exchange). */
export function tokenRoute(
  opts: { instanceUrl?: string; orgId?: string } = {},
): Route {
  return {
    method: "POST",
    match: "/services/oauth2/token",
    reply: (req) =>
      jsonReply(
        {
          access_token: `token${req.hit}`,
          instance_url: opts.instanceUrl ?? INSTANCE_URL,
          id: opts.orgId
            ? `${LOGIN_URL}/id/${opts.orgId}/${USER_ID}`
            : IDENTITY_URL,
          token_type: "Bearer",
        },
        200,
        { Date: "Tue, 08 Sep 2026 10:00:00 GMT" },
      ),
  };
}

export interface FetchMock {
  fetch: typeof fetch;
  calls: RecordedCall[];
  /** Calls whose URL contains `s` / matches `re`. */
  callsTo(m: string | RegExp): RecordedCall[];
}

/** Build a fetch double from a route table (first matching route wins). */
export function mockFetch(routes: Route[]): FetchMock {
  const calls: RecordedCall[] = [];
  const hits = new Map<Route, number>();
  const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    const method = (init?.method ?? "GET").toUpperCase();
    const headers = headersToRecord(init?.headers);
    const body = typeof init?.body === "string" ? init.body : null;
    const rec: RecordedCall = { method, url, headers, body };
    calls.push(rec);
    for (const r of routes) {
      if (r.method && r.method.toUpperCase() !== method) continue;
      const ok =
        typeof r.match === "string" ? url.includes(r.match) : r.match.test(url);
      if (!ok) continue;
      const hit = (hits.get(r) ?? 0) + 1;
      hits.set(r, hit);
      const reply = await r.reply({ ...rec, hit, parsed: new URL(url) });
      if (reply instanceof Response) return reply;
      if (reply.text !== undefined)
        return new Response(reply.text, {
          status: reply.status ?? 200,
          headers: reply.headers,
        });
      return jsonReply(reply.json ?? null, reply.status ?? 200, reply.headers);
    }
    return new Response(
      JSON.stringify([
        { errorCode: "NOT_FOUND", message: `no route for ${method} ${url}` },
      ]),
      {
        status: 404,
        headers: { "Content-Type": "application/json" },
      },
    );
  }) as typeof fetch;
  return {
    fetch: fetchFn,
    calls,
    callsTo: (m) =>
      calls.filter((c) =>
        typeof m === "string" ? c.url.includes(m) : m.test(c.url),
      ),
  };
}

let keyPair: { privateKey: string; publicKey: string } | null = null;

/** One RSA key pair per test process (generation is slow). */
export function testKeyPair(): { privateKey: string; publicKey: string } {
  if (!keyPair) {
    const { privateKey, publicKey } = generateKeyPairSync("rsa", {
      modulusLength: 2048,
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
    });
    keyPair = { privateKey, publicKey };
  }
  return keyPair;
}

export const instantSleep = async (): Promise<void> => {};

export async function collect<T>(it: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const x of it) out.push(x);
  return out;
}
