/**
 * Backwards-compat shim for the URL-diff SSRF guard.
 *
 * The implementation moved to `@/lib/security/outbound-url` so any user-
 * influenced outbound fetch (URL-diff target, custom AI provider baseUrl,
 * etc.) shares the same logic. This file now re-exports that helper.
 *
 * History note (H3): the previous version accepted an `isCookieSession`
 * flag that fully bypassed the block for any logged-in user. That bypass
 * was removed — knowing who a user is doesn't mean it's safe to fetch
 * cloud metadata (169.254.169.254) from the app process. Use the
 * `LASTEST_ALLOW_PRIVATE_OUTBOUND` / `LASTEST_OUTBOUND_PRIVATE_HOST_IP_ALLOWLIST`
 * env vars for the genuinely internal deployments.
 */

import {
  assertSafeOutboundUrl,
  SsrfBlockedError,
  extractSourceIp,
  isBlockedIp,
} from "@/lib/security/outbound-url";

export { SsrfBlockedError, extractSourceIp, isBlockedIp };

export interface ValidateOptions {
  sourceIp?: string;
}

/**
 * Throws `SsrfBlockedError` if `targetUrl` resolves to a private/internal
 * address. Retained as a wrapper around `assertSafeOutboundUrl` to keep
 * existing URL-diff call sites compiling.
 */
export async function validateTargetUrl(
  targetUrl: string,
  opts: ValidateOptions = {},
): Promise<void> {
  await assertSafeOutboundUrl(targetUrl, { sourceIp: opts.sourceIp });
}
