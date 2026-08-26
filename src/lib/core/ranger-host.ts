import "server-only";

import type { RangerHost } from "@lastest/plugin-ranger";

import {
  assertSafeOutboundUrl,
  SsrfBlockedError,
} from "@/lib/security/outbound-url";

/**
 * The app's fill for `RangerHost`. One method — see `plugins/ranger/src/host.ts`
 * for why it is the fourth copy of the same gap (`explorer`, `app-map`,
 * `api-test` all declare it verbatim) rather than something new.
 */
export const appRangerHost: RangerHost = {
  async assertSafeOutboundUrl(url: string): Promise<void> {
    try {
      await assertSafeOutboundUrl(url);
    } catch (err) {
      if (err instanceof SsrfBlockedError) {
        throw new Error(`URL rejected: ${err.message}`);
      }
      throw err;
    }
  },
};
