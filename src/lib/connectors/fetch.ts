import "server-only";

import { safeOutboundFetch } from "@/lib/security/outbound-url";

/**
 * `safeOutboundFetch` adapted to the shape `VaultProfiler` / `RestProfiler`
 * accept as `fetchImpl`.
 *
 * Connector base URLs are typed by a user, which makes every call out of here a
 * potential SSRF. Rather than each client re-implementing a host check, they
 * all take this as their fetch: redirects are re-validated hop by hop, and a
 * blocked target throws before a socket opens.
 *
 * The signature is deliberately NARROWER than `typeof fetch`: `(url, init)`
 * only, no `Request`. It used to be typed as `typeof fetch` while handling a
 * `Request` by extracting `input.url` and forwarding `init ?? {}` — which in
 * that call shape is `undefined`, so the method, the headers (including auth)
 * and the body all vanished and the call went out as a bare GET. No caller
 * passes a `Request` today, which is exactly why nobody would notice when one
 * does; a type that refuses it is better than a runtime that drops it.
 */
export type ConnectorFetch = (
  url: string | URL,
  init?: RequestInit,
) => Promise<Response>;

export const connectorFetch: ConnectorFetch = (url, init) =>
  safeOutboundFetch(typeof url === "string" ? url : url.toString(), init ?? {});
