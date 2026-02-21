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
    for (const cidr of PRIVATE_CIDRS) {
      if (isInCIDR(hostname, cidr)) {
        return 'URL targets a private network';
      }
    }
    // Cloud metadata endpoint
    if (hostname === '169.254.169.254') {
      return 'URL targets a cloud metadata endpoint';
    }
  }

  return null;
}
