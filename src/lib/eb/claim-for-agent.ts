import "server-only";

import {
  claimPoolEB,
  claimOrProvisionPoolEB,
  releasePoolEB,
} from "@/server/actions/embedded-sessions";
import { beginAgentEbUsage } from "@/lib/billing/agent-eb-usage";
import { db } from "@/lib/db";
import { embeddedSessions } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

/**
 * Pool-EB claiming for AI agent sessions.
 *
 * This deliberately does NOT live in `@/server/actions/ai` ("use server"):
 * every export of that module is a server action reachable from any browser,
 * and `billTeamId` decides whose monthly run-minutes the claim→release window
 * is charged to. As a remotely-callable action, a caller could bill EB time to
 * an arbitrary team — and with `ENFORCE_RUN_LIMITS=true`, quota them out. It
 * cannot be fixed with an auth guard either: the scheduled-trigger path claims
 * EBs with no user session at all. Keeping it out of the action boundary is
 * what makes `billTeamId` trustworthy, so don't add "use server" here.
 *
 * Note that a plain `export … from` re-export back into a "use server" module
 * would recreate exactly that boundary — importers take it from here.
 */

/**
 * Probe an EB's CDP endpoint once. cdpUrl is `http://<host>:<cdpPort>` (a TCP
 * proxy in the pod forwards 0.0.0.0 → 127.0.0.1 where Chromium binds); Chromium
 * serves `/json/version` over it. Returns false on any error / non-2xx / timeout.
 */
async function probeCdp(cdpUrl: string, timeoutMs = 2500): Promise<boolean> {
  const base = cdpUrl.replace(/^ws/i, "http").replace(/\/+$/, "");
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${base}/json/version`, { signal: ctrl.signal });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Confirm a claimed EB's CDP endpoint is actually reachable before handing it to
 * an agent. After a `pnpm dev` restart (dead port-forward) or a dead pod, the DB
 * still holds a cdpUrl whose proxy is gone — pointing Playwright MCP at it makes
 * the agent fail with an opaque connect error (and no live screencast). Two quick
 * attempts so a transient blip doesn't evict a healthy EB.
 */
async function isCdpReachable(cdpUrl: string): Promise<boolean> {
  if (await probeCdp(cdpUrl)) return true;
  await new Promise((r) => setTimeout(r, 250));
  return probeCdp(cdpUrl);
}

/**
 * Claim an embedded browser from the pool for AI agent use.
 * Waits (polls) until an EB becomes available, up to maxWaitMs.
 * Returns CDP + stream URLs and the runnerId for release.
 * Caller MUST call releasePoolEB(runnerId) when done.
 *
 * Pass `billTeamId` to meter the browser time this claim consumes: the
 * claim→release window is billed to that team's monthly run-minutes when the
 * EB is released. Pool runners belong to the internal system team, so the
 * caller is the only place that knows who to attribute it to. Omit it for
 * paths that meter separately (the test executor) to avoid double-counting.
 */
export async function claimEmbeddedBrowserForAgent(
  maxWaitMs = 5 * 60 * 1000,
  onQueued?: () => void,
  billTeamId?: string,
): Promise<
  | {
      cdpUrl: string;
      streamUrl: string;
      runnerId: string;
      /** Provisioner instanceId; null for static-fleet EBs. */
      instanceId: string | null;
    }
  | undefined
> {
  const deadline = Date.now() + maxWaitMs;
  let notifiedQueued = false;
  let firstAttempt = true;

  while (Date.now() < deadline) {
    // First attempt: try to claim OR provision (spawns a fresh EB Job if the
    // pool has room and no idle EB is available). Subsequent attempts just
    // poll for release — we don't want to keep launching fresh Jobs in a loop.
    const poolEB = firstAttempt
      ? await claimOrProvisionPoolEB()
      : await claimPoolEB();
    firstAttempt = false;
    if (poolEB) {
      // Look up the CDP/stream URLs from the session
      const [session] = await db
        .select({
          cdpUrl: embeddedSessions.cdpUrl,
          streamUrl: embeddedSessions.streamUrl,
          instanceId: embeddedSessions.instanceId,
        })
        .from(embeddedSessions)
        .where(eq(embeddedSessions.runnerId, poolEB.runnerId));

      if (session?.cdpUrl && session?.streamUrl) {
        if (await isCdpReachable(session.cdpUrl)) {
          if (billTeamId) beginAgentEbUsage(poolEB.runnerId, billTeamId);
          return {
            cdpUrl: session.cdpUrl,
            streamUrl: session.streamUrl,
            runnerId: poolEB.runnerId,
            instanceId: session.instanceId,
          };
        }
        // Registered but its CDP endpoint is unreachable — a stale port-forward
        // (post `pnpm dev` restart) or a dead pod. Handing this to an agent makes
        // Playwright MCP fail opaquely. Release it (k8s mode tears the Job down
        // and ensureWarmPool provisions a fresh one) and keep waiting.
        console.warn(
          `[AgentPool] Claimed EB ${poolEB.runnerId.slice(0, 8)} has an unreachable CDP endpoint (${session.cdpUrl}) — evicting and retrying`,
        );
        await releasePoolEB(poolEB.runnerId);
      } else {
        // Session not found or missing URLs — release and retry
        await releasePoolEB(poolEB.runnerId);
      }
    }

    // Notify caller on first queue (so UI can update status)
    if (!notifiedQueued) {
      notifiedQueued = true;
      onQueued?.();
      console.log(
        `[AgentPool] All browsers busy, waiting for one to become available (timeout ${maxWaitMs / 1000}s)`,
      );
    }

    // Poll every 3 seconds
    await new Promise((r) => setTimeout(r, 3000));
  }

  console.warn(
    `[AgentPool] Timed out waiting for an available browser after ${maxWaitMs / 1000}s`,
  );
  return undefined;
}
