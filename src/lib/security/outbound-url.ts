/**
 * SSRF guard for outbound HTTP fetches whose target host is influenced by a
 * user (URL-diff target, custom AI provider baseUrl, webhook callback, etc.).
 *
 * Policy: reject http/https URLs whose host (literal or DNS-resolved) falls in
 * private/loopback/link-local/cloud-metadata ranges, unless the deployment
 * explicitly opts in via `LASTEST_ALLOW_PRIVATE_OUTBOUND=true` or the source
 * IP is in `LASTEST_OUTBOUND_PRIVATE_HOST_IP_ALLOWLIST` (CIDR list).
 *
 * Cookie-session (logged-in UI) is NOT a bypass — knowing who the user is
 * doesn't make it safe to reach the cloud metadata service from the app pod.
 *
 * Backwards-compat env vars from the URL-diff specific config also work:
 * `URL_DIFF_ALLOW_PRIVATE_HOSTS` and `URL_DIFF_PRIVATE_HOST_IP_ALLOWLIST`.
 */

import { promises as dns, lookup as dnsLookupCb } from "node:dns";
import net from "node:net";

const ALLOW_GLOBAL = () =>
  process.env.LASTEST_ALLOW_PRIVATE_OUTBOUND === "true" ||
  process.env.URL_DIFF_ALLOW_PRIVATE_HOSTS === "true";

const ALLOWLIST_CIDRS = () => {
  const raw =
    process.env.LASTEST_OUTBOUND_PRIVATE_HOST_IP_ALLOWLIST ??
    process.env.URL_DIFF_PRIVATE_HOST_IP_ALLOWLIST ??
    "";
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
};

export class SsrfBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SsrfBlockedError";
  }
}

function ipToBigInt(ip: string): bigint | null {
  if (net.isIPv4(ip)) {
    const parts = ip.split(".").map(Number);
    if (parts.some((p) => Number.isNaN(p) || p < 0 || p > 255)) return null;
    return BigInt(
      parts[0]! * 256 ** 3 + parts[1]! * 256 ** 2 + parts[2]! * 256 + parts[3]!,
    );
  }
  if (net.isIPv6(ip)) {
    const expanded = expandIPv6(ip);
    if (!expanded) return null;
    const SIXTEEN = BigInt(16);
    let v = BigInt(0);
    for (const group of expanded.split(":")) {
      v = (v << SIXTEEN) | BigInt(parseInt(group, 16));
    }
    return v;
  }
  return null;
}

function expandIPv6(ip: string): string | null {
  if (ip.includes("::")) {
    const [head, tail] = ip.split("::");
    const headGroups = head ? head.split(":") : [];
    const tailGroups = tail ? tail.split(":") : [];
    const fill = 8 - headGroups.length - tailGroups.length;
    if (fill < 0) return null;
    const groups = [...headGroups, ...Array(fill).fill("0"), ...tailGroups];
    return groups.map((g) => g.padStart(4, "0")).join(":");
  }
  const groups = ip.split(":");
  if (groups.length !== 8) return null;
  return groups.map((g) => g.padStart(4, "0")).join(":");
}

function inCidr(ip: string, cidr: string): boolean {
  const slash = cidr.indexOf("/");
  if (slash === -1) return ip === cidr;
  const network = cidr.slice(0, slash);
  const bits = parseInt(cidr.slice(slash + 1), 10);
  if (Number.isNaN(bits)) return false;
  const ipNum = ipToBigInt(ip);
  const netNum = ipToBigInt(network);
  if (ipNum === null || netNum === null) return false;
  const isV6 = net.isIPv6(ip) || net.isIPv6(network);
  const totalBits = isV6 ? 128 : 32;
  if (bits < 0 || bits > totalBits) return false;
  if (bits === 0) return true;
  const shift = BigInt(totalBits - bits);
  return ipNum >> shift === netNum >> shift;
}

const BLOCKED_IPV4 = [
  "127.0.0.0/8", // loopback
  "10.0.0.0/8", // RFC1918
  "172.16.0.0/12", // RFC1918
  "192.168.0.0/16", // RFC1918
  "169.254.0.0/16", // link-local + cloud metadata
  "0.0.0.0/8", // "this" network
  "100.64.0.0/10", // shared address space (CGN)
  "198.18.0.0/15", // benchmarking
  "224.0.0.0/4", // multicast
  "240.0.0.0/4", // reserved
];
const BLOCKED_IPV6 = [
  "::1/128", // loopback
  "fc00::/7", // unique local
  "fe80::/10", // link-local
  "::ffff:0:0/96", // IPv4-mapped (let v4 logic catch it)
];

export function isBlockedIp(ip: string): boolean {
  if (net.isIPv4(ip)) return BLOCKED_IPV4.some((cidr) => inCidr(ip, cidr));
  if (net.isIPv6(ip)) return BLOCKED_IPV6.some((cidr) => inCidr(ip, cidr));
  return false;
}

function sourceIpAllowed(sourceIp: string): boolean {
  const list = ALLOWLIST_CIDRS();
  if (list.length === 0) return false;
  return list.some((cidr) => {
    try {
      return inCidr(sourceIp, cidr);
    } catch {
      return false;
    }
  });
}

export interface AssertSafeOptions {
  /** Source IP from x-forwarded-for / remote socket, if known. */
  sourceIp?: string;
}

/**
 * Throws `SsrfBlockedError` if `targetUrl` is unsafe to fetch from the app
 * process. Resolves DNS as a pre-flight to defend against rebinding.
 */
export async function assertSafeOutboundUrl(
  targetUrl: string,
  opts: AssertSafeOptions = {},
): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(targetUrl);
  } catch {
    throw new SsrfBlockedError("Invalid URL");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new SsrfBlockedError(`Unsupported scheme: ${parsed.protocol}`);
  }
  const host = parsed.hostname;
  if (!host) throw new SsrfBlockedError("Missing hostname");

  const bypass =
    ALLOW_GLOBAL() || (opts.sourceIp ? sourceIpAllowed(opts.sourceIp) : false);
  if (bypass) return;

  if (net.isIP(host)) {
    if (isBlockedIp(host)) {
      throw new SsrfBlockedError(
        `Target host resolves to a private/internal address: ${host}`,
      );
    }
    return;
  }

  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".internal") ||
    host.endsWith(".local")
  ) {
    throw new SsrfBlockedError(`Target host is local: ${host}`);
  }

  const addresses: string[] = [];
  try {
    const [v4, v6] = await Promise.allSettled([
      dns.resolve4(host),
      dns.resolve6(host),
    ]);
    if (v4.status === "fulfilled") addresses.push(...v4.value);
    if (v6.status === "fulfilled") addresses.push(...v6.value);
  } catch {
    // fallthrough — empty addresses → reject below
  }
  if (addresses.length === 0) {
    throw new SsrfBlockedError(`Could not resolve hostname: ${host}`);
  }
  for (const addr of addresses) {
    if (isBlockedIp(addr)) {
      throw new SsrfBlockedError(
        `Target host ${host} resolves to a private/internal address (${addr})`,
      );
    }
  }
}

export interface SafeFetchOptions extends AssertSafeOptions {
  /** Max redirect hops to follow (each re-validated). Default 5. */
  maxRedirects?: number;
}

/**
 * SSRF-safe `fetch` for user-influenced URLs. Validates the target with
 * `assertSafeOutboundUrl` and follows redirects *manually*, re-validating every
 * hop — `redirect: "follow"` would let a public URL bounce to an internal one
 * (e.g. the cloud-metadata endpoint) without a second check. Throws
 * `SsrfBlockedError` on any blocked hop or redirect overflow.
 */
export async function safeOutboundFetch(
  url: string,
  init: RequestInit = {},
  opts: SafeFetchOptions = {},
): Promise<Response> {
  const maxRedirects = opts.maxRedirects ?? 5;
  let currentUrl = url;
  for (let hop = 0; hop <= maxRedirects; hop++) {
    await assertSafeOutboundUrl(currentUrl, { sourceIp: opts.sourceIp });
    const res = await fetch(currentUrl, { ...init, redirect: "manual" });
    const location =
      res.status >= 300 && res.status < 400
        ? res.headers.get("location")
        : null;
    if (!location) return res;
    // Resolve relative redirects against the current URL, then re-validate.
    currentUrl = new URL(location, currentUrl).toString();
  }
  throw new SsrfBlockedError("Too many redirects");
}

/**
 * Connect-time SSRF guard. `assertSafeOutboundUrl` is a pre-flight check, but
 * between that DNS lookup and the socket actually connecting, a malicious
 * authoritative server can re-point the name at an internal IP (DNS-rebinding /
 * TOCTOU). This returns an undici dispatcher whose `lookup` re-validates the
 * resolved address at the moment of connection and refuses to connect to a
 * blocked range — closing that window. Pass it as `fetch(url, { dispatcher })`.
 */
export async function createSsrfSafeDispatcher(): Promise<
  import("undici").Dispatcher
> {
  // Lazy-import so this module's evaluation doesn't pull `undici` (Node >=20.18)
  // into the broad import chain (ai -> executor -> builds -> server actions),
  // which would crash module-eval on older local Node. Only callers that
  // actually make guarded outbound fetches need it.
  const { Agent } = await import("undici");
  return new Agent({
    connect: {
      lookup: (
        hostname: string,
        options: import("node:dns").LookupOptions,
        callback: (
          err: NodeJS.ErrnoException | null,
          address: string | import("node:dns").LookupAddress[],
          family?: number,
        ) => void,
      ) => {
        if (ALLOW_GLOBAL()) {
          // Deployment explicitly opted into private outbound — don't re-block.
          return dnsLookupCb(hostname, options, callback as never);
        }
        dnsLookupCb(
          hostname,
          { ...options, all: true },
          (err: NodeJS.ErrnoException | null, addresses) => {
            if (err) return callback(err, "");
            const list = Array.isArray(addresses) ? addresses : [addresses];
            const safe = list.filter(
              (a: import("node:dns").LookupAddress) => !isBlockedIp(a.address),
            );
            if (safe.length === 0) {
              return callback(
                new SsrfBlockedError(
                  `Target host ${hostname} resolves only to private/internal addresses`,
                ),
                "",
              );
            }
            if (options.all) return callback(null, safe);
            callback(null, safe[0]!.address, safe[0]!.family);
          },
        );
      },
    },
  });
}

export function extractSourceIp(headers: Headers): string {
  const xff = headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]!.trim();
  const real = headers.get("x-real-ip");
  if (real) return real.trim();
  return "unknown";
}
