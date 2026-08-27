import "server-only";

import { safeOutboundFetch } from "@/lib/security/outbound-url";

/**
 * `safeOutboundFetch` adapted to the `typeof fetch` shape that
 * `VaultProfiler` / `RestProfiler` accept as `fetchImpl`.
 *
 * Connector base URLs are typed by a user, which makes every call out of here a
 * potential SSRF. Rather than each client re-implementing a host check, they
 * all take this as their fetch: redirects are re-validated hop by hop, and a
 * blocked target throws before a socket opens.
 */
export const connectorFetch: typeof fetch = (input, init) => {
  const url =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url;
  return safeOutboundFetch(url, init ?? {});
};
