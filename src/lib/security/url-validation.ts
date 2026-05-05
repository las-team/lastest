/**
 * SSRF Protection — URL validation layer that blocks requests to internal
 * networks, private IPs, cloud metadata services, and non-HTTP protocols.
 *
 * Returns `null` if the URL is safe, or an error message string if blocked.
 */

function ipToNumber(ip: string): number {
  const parts = ip.split('.').map(Number);
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

function isInCIDR(ip: string, cidr: string): boolean {
  const [base, bits] = cidr.split('/');
  const mask = ~(2 ** (32 - Number(bits)) - 1) >>> 0;
  return (ipToNumber(ip) & mask) === (ipToNumber(base) & mask);
}

const PRIVATE_CIDRS = [
  '10.0.0.0/8',
  '172.16.0.0/12',
  '192.168.0.0/16',
  '127.0.0.0/8',
  '169.254.0.0/16',
  '0.0.0.0/8',
];

const BLOCKED_HOSTNAMES = ['localhost', 'metadata.google.internal'];

function isPrivateIPv6(hostname: string): boolean {
  const cleaned = hostname.replace(/^\[|\]$/g, '');
  const lower = cleaned.toLowerCase();
  if (lower === '::1') return true;
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true; // fc00::/7
  if (lower.startsWith('fe8') || lower.startsWith('fe9') || lower.startsWith('fea') || lower.startsWith('feb')) return true; // fe80::/10
  return false;
}

function checkIPv4(ip: string): string | null {
  for (const cidr of PRIVATE_CIDRS) {
    if (isInCIDR(ip, cidr)) {
      return 'URL targets a private network';
    }
  }
  if (ip === '169.254.169.254') {
    return 'URL targets a cloud metadata endpoint';
  }
  return null;
}

export function validateUrl(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return 'Invalid URL';
  }

  // Protocol check
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return 'Only HTTP(S) protocols are allowed';
  }

  const hostname = parsed.hostname.toLowerCase();

  // Blocked hostnames
  if (BLOCKED_HOSTNAMES.includes(hostname)) {
    return 'URL targets a blocked hostname';
  }

  // IPv6 private ranges
  if (hostname.startsWith('[') || hostname.includes(':')) {
    if (isPrivateIPv6(hostname)) {
      return 'URL targets a private network';
    }
  }

  // IPv4 private/reserved ranges
  const ipv4Match = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4Match) {
    const ipErr = checkIPv4(hostname);
    if (ipErr) return ipErr;
  }

  return null;
}

/**
 * DNS-aware variant — additionally resolves the hostname and re-validates
 * each resolved address against the private/loopback/metadata CIDRs.
 *
 * Without this, an attacker can bypass `validateUrl` by registering a
 * public DNS record (e.g. `evil.example.com`) that resolves to
 * `169.254.169.254` or an RFC1918 address.
 *
 * Note: there's still a tiny TOCTOU window between this lookup and the
 * subsequent `fetch`. Mitigate by passing the resolved IP directly to
 * `fetch` (host pinning) for high-risk callers.
 */
export async function validateUrlAsync(url: string): Promise<string | null> {
  const synchronous = validateUrl(url);
  if (synchronous) return synchronous;

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return 'Invalid URL';
  }
  const hostname = parsed.hostname.toLowerCase();

  // Literal IP — validateUrl already covered it.
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(hostname)) return null;
  if (hostname.startsWith('[') || hostname.includes(':')) return null;

  let addresses: { address: string; family: number }[] = [];
  try {
    const dns = await import('dns/promises');
    addresses = await dns.lookup(hostname, { all: true });
  } catch {
    return 'DNS lookup failed';
  }

  for (const { address, family } of addresses) {
    if (family === 4) {
      const err = checkIPv4(address);
      if (err) return err;
    } else if (family === 6) {
      if (isPrivateIPv6(address)) return 'URL targets a private network';
    }
  }
  return null;
}
