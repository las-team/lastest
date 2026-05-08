/**
 * SSRF guard for URL Diff capture endpoints.
 *
 * Default policy: reject http/https URLs whose host (literal or DNS-resolved)
 * falls in private/loopback/link-local/cloud-metadata ranges. Cookie-session
 * users (logged-in app) and source IPs in `URL_DIFF_PRIVATE_HOST_IP_ALLOWLIST`
 * (CIDR list env) bypass the block. `URL_DIFF_ALLOW_PRIVATE_HOSTS=true` is a
 * global override for fully-internal deployments.
 */

import { promises as dns } from 'node:dns';
import net from 'node:net';

const ALLOW_GLOBAL = () => process.env.URL_DIFF_ALLOW_PRIVATE_HOSTS === 'true';
const ALLOWLIST_CIDRS = () =>
  (process.env.URL_DIFF_PRIVATE_HOST_IP_ALLOWLIST ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

export class SsrfBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SsrfBlockedError';
  }
}

function ipToBigInt(ip: string): bigint | null {
  if (net.isIPv4(ip)) {
    const parts = ip.split('.').map(Number);
    if (parts.some((p) => Number.isNaN(p) || p < 0 || p > 255)) return null;
    return BigInt(parts[0]! * 256 ** 3 + parts[1]! * 256 ** 2 + parts[2]! * 256 + parts[3]!);
  }
  if (net.isIPv6(ip)) {
    // Rough-but-correct IPv6 → bigint: expand the address.
    const expanded = expandIPv6(ip);
    if (!expanded) return null;
    const SIXTEEN = BigInt(16);
    let v = BigInt(0);
    for (const group of expanded.split(':')) {
      v = (v << SIXTEEN) | BigInt(parseInt(group, 16));
    }
    return v;
  }
  return null;
}

function expandIPv6(ip: string): string | null {
  if (ip.includes('::')) {
    const [head, tail] = ip.split('::');
    const headGroups = head ? head.split(':') : [];
    const tailGroups = tail ? tail.split(':') : [];
    const fill = 8 - headGroups.length - tailGroups.length;
    if (fill < 0) return null;
    const groups = [...headGroups, ...Array(fill).fill('0'), ...tailGroups];
    return groups.map((g) => g.padStart(4, '0')).join(':');
  }
  const groups = ip.split(':');
  if (groups.length !== 8) return null;
  return groups.map((g) => g.padStart(4, '0')).join(':');
}

function inCidr(ip: string, cidr: string): boolean {
  const slash = cidr.indexOf('/');
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
  return (ipNum >> shift) === (netNum >> shift);
}

const BLOCKED_IPV4 = [
  '127.0.0.0/8', // loopback
  '10.0.0.0/8', // RFC1918
  '172.16.0.0/12', // RFC1918
  '192.168.0.0/16', // RFC1918
  '169.254.0.0/16', // link-local + cloud metadata
  '0.0.0.0/8', // "this" network
  '100.64.0.0/10', // shared address space (CGN)
  '198.18.0.0/15', // benchmarking
  '224.0.0.0/4', // multicast
  '240.0.0.0/4', // reserved
];
const BLOCKED_IPV6 = [
  '::1/128', // loopback
  'fc00::/7', // unique local
  'fe80::/10', // link-local
  '::ffff:0:0/96', // IPv4-mapped (let v4 logic catch it)
];

function isBlockedIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    return BLOCKED_IPV4.some((cidr) => inCidr(ip, cidr));
  }
  if (net.isIPv6(ip)) {
    return BLOCKED_IPV6.some((cidr) => inCidr(ip, cidr));
  }
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

export interface ValidateOptions {
  /** Cookie-session in-app user — bypasses SSRF block (logged-in trusted). */
  isCookieSession: boolean;
  /** Source IP from x-forwarded-for / remote socket. */
  sourceIp: string;
}

/**
 * Validate that `targetUrl` is safe to fetch from the EB pod.
 * Throws `SsrfBlockedError` on disallowed targets.
 */
export async function validateTargetUrl(targetUrl: string, opts: ValidateOptions): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(targetUrl);
  } catch {
    throw new SsrfBlockedError('Invalid URL');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new SsrfBlockedError(`Unsupported scheme: ${parsed.protocol}`);
  }
  const host = parsed.hostname;
  if (!host) throw new SsrfBlockedError('Missing hostname');

  // Bypass conditions
  const bypass =
    ALLOW_GLOBAL() ||
    opts.isCookieSession ||
    (opts.sourceIp ? sourceIpAllowed(opts.sourceIp) : false);

  if (bypass) return;

  // Literal IP shortcut
  if (net.isIP(host)) {
    if (isBlockedIp(host)) {
      throw new SsrfBlockedError(`Target host resolves to a private/internal address: ${host}`);
    }
    return;
  }

  // Reject obvious local hostnames before resolving
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal') || host.endsWith('.local')) {
    throw new SsrfBlockedError(`Target host is local: ${host}`);
  }

  // DNS resolution check (defends against DNS rebinding pre-flight)
  const addresses: string[] = [];
  try {
    const [v4, v6] = await Promise.allSettled([dns.resolve4(host), dns.resolve6(host)]);
    if (v4.status === 'fulfilled') addresses.push(...v4.value);
    if (v6.status === 'fulfilled') addresses.push(...v6.value);
  } catch {
    // fallthrough — empty addresses → reject below
  }
  if (addresses.length === 0) {
    throw new SsrfBlockedError(`Could not resolve hostname: ${host}`);
  }
  for (const addr of addresses) {
    if (isBlockedIp(addr)) {
      throw new SsrfBlockedError(`Target host ${host} resolves to a private/internal address (${addr})`);
    }
  }
}

export function extractSourceIp(headers: Headers): string {
  const xff = headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0]!.trim();
  const real = headers.get('x-real-ip');
  if (real) return real.trim();
  return 'unknown';
}
