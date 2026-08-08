import "server-only";

import type {
  BrowserHost,
  ClaimedEb,
  HostClaimRequest,
} from "@lastest/core-browser";

import * as queries from "@/lib/db/queries";
import { assertAgentRunMinutesAvailable } from "@/lib/billing/agent-eb-usage";
import { injectStorageStateIntoEb } from "@/lib/eb/inject-storage-state";
import { toProxyStreamUrl } from "@/lib/eb/stream-url";
import { claimEmbeddedBrowserForAgent } from "@/server/actions/ai";
import { releasePoolEB } from "@/server/actions/embedded-sessions";

/**
 * The app's implementation of `@lastest/core-browser`'s host port.
 *
 * `core/browser` owns the lifecycle *policy* — always release, clamp the
 * deadline to the plan, never hand a plugin a pod address. It deliberately does
 * not own these primitives: pool claim/release, grant signing, metering and
 * storage-state decryption already exist here and are used by plenty of code
 * that is never going to become a plugin. Injecting them is what keeps
 * `core/browser` free of `@/…` imports, which is the difference between core
 * being a boundary and core being a second name for the app.
 *
 * This file is the seam, and it is the only place the two meet.
 */
export const appBrowserHost: BrowserHost = {
  async claim(req: HostClaimRequest): Promise<ClaimedEb | null> {
    // `claimEmbeddedBrowserForAgent` starts run-minute metering when given a
    // team id; `release` below settles it.
    const eb = await claimEmbeddedBrowserForAgent(
      req.timeoutMs,
      req.onQueued,
      req.teamId,
    ).catch(() => undefined);
    if (!eb) return null;
    return {
      runnerId: eb.runnerId,
      cdpUrl: eb.cdpUrl,
      streamUrl: eb.streamUrl,
      instanceId: eb.instanceId,
    };
  },

  async release(runnerId: string): Promise<void> {
    // Settles metered browser time before releasing the slot.
    await releasePoolEB(runnerId);
  },

  assertRunMinutes(teamId: string): Promise<void> {
    return assertAgentRunMinutesAvailable(teamId);
  },

  async applyAuth(cdpUrl: string, storageStateId: string): Promise<boolean> {
    // Resolution *and* injection happen here, so the decrypted storage state
    // never crosses back into core, let alone into a plugin. The plugin only
    // ever held the id.
    const row = await queries.getStorageState(storageStateId).catch(() => null);
    if (!row?.storageStateJson) return false;
    return injectStorageStateIntoEb(cdpUrl, row.storageStateJson);
  },

  streamGrant(
    streamUrl: string | null,
    instanceId: string | null,
  ): string | null {
    // Signed and expiring, carrying the upstream address opaquely. Callers of
    // this sit behind the kernel's scope resolver, which is what ties
    // "authenticated request" to "may open this specific stream".
    return toProxyStreamUrl(streamUrl, "", instanceId);
  },
};
