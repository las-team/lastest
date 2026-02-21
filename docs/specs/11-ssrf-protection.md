# Feature Spec: SSRF Protection

## Overview

URL validation layer that prevents Server-Side Request Forgery attacks by blocking requests to internal networks, private IPs, cloud metadata services, and non-HTTP protocols.

## Blocked Ranges

### Private Networks (RFC 1918)
- `10.0.0.0/8`
- `172.16.0.0/12`
- `192.168.0.0/16`

### Loopback / Localhost
- `127.0.0.0/8`
- `::1` (IPv6)
- `localhost`

### Link-Local
- `169.254.0.0/16`
- `fe80::/10` (IPv6)

### Cloud Metadata
- `169.254.169.254` (AWS, GCP, Azure metadata endpoint)
- `metadata.google.internal`

### Protocols
Only `http:` and `https:` allowed. Blocked:
- `ftp:`, `file:`, `gopher:`, `data:`, `javascript:`, etc.

## API

```typescript
function validateUrl(url: string): string | null
```
- Returns `null` if URL is safe
- Returns error message string if blocked
- Examples:
  - `validateUrl('https://example.com')` → `null` (safe)
  - `validateUrl('http://192.168.1.1')` → `"URL targets a private network"` (blocked)
  - `validateUrl('ftp://example.com')` → `"Only HTTP(S) protocols are allowed"` (blocked)

## Key Files
| File | Purpose |
|------|---------|
| `src/lib/security/url-validation.ts` (48 lines) | Validation logic |

## Integration Points
- Used by server actions that make external HTTP requests
- Applied to user-provided URLs (target URLs for test execution, webhook endpoints, etc.)

## Tests
- `src/lib/security/url-validation.test.ts` — 33 tests: RFC1918, IPv6, loopback, cloud metadata, protocol blocking, valid URL passthrough
