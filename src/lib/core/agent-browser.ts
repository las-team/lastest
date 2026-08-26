import "server-only";

import type { BrowserCapability, Plan } from "@lastest/contracts";
import { createBrowserCapability } from "@lastest/core-browser";

import { appBrowserHost } from "@/lib/core/browser-host";
import { entitlementsFor } from "@/lib/core/entitlements";
import * as queries from "@/lib/db/queries";
import { getLogger } from "@/lib/logger";

/**
 * The browser capability, for app code that is not a plugin yet.
 *
 * `getPluginRuntime()` hands every plugin a `ctx.browser` built from
 * `createBrowserFactory(appBrowserHost)`. The still-unmigrated agents
 * (`qa-agent` first, `play-agent` behind it) have no `ctx` to read one from, so
 * before this file they did the only other thing available: claim a raw EB
 * through `claimEmbeddedBrowserForAgent()` and `chromium.connectOverCDP(cdpUrl)`
 * themselves. That is what RFC §1.1 counts as a direct-CDP call site, and R4 is
 * the rule against it.
 *
 * This is the same capability, minted at the composition root against the same
 * host, with `pluginId` simply absent — `createBrowserFactory` already ignores
 * it (`(_pluginId, scope) => createBrowserCapability(host, scope, opts)`), so
 * there is nothing to fake. What a caller gets is the whole point: claim,
 * release-on-throw, deadline enforcement, run-minute metering, storage-state
 * injection by id, and a signed stream grant — none of which the raw path did
 * for itself.
 *
 * **It is a migration bridge, not a permanent seam — and it is currently
 * idle.** `qa-agent` finished becoming a plugin and its call sites read
 * `ctx.browser` now, which was this file's only actual consumer. `play-agent`
 * — the caller the paragraph above anticipated — never onboarded: it still
 * claims raw EBs through `claimEmbeddedBrowserForAgent`. Kept, deliberately,
 * as the ramp that migration should take (adopting this is a smaller step
 * than a full plugin migration and retires its raw-CDP call sites early);
 * if play-agent migrates straight to a plugin instead, delete this file in
 * the same change. It is deliberately *not* exported to plugins (nothing
 * outside `src/` can import it) and deliberately does not take a `pluginId`,
 * so it cannot become a back door into a plugin's scope.
 *
 * SECURITY: `teamId` is the tenancy boundary, and this function does not check
 * it — the caller must already have authorized it (`requireRepoAccess()` /
 * `requireTeamAccess()`, or an ownership check on a background path). Same rule
 * as `resolveScope`'s background branch in `runtime.ts`, for the same reason.
 */
export async function agentBrowserCapability(
  teamId: string,
  scopeName: string,
): Promise<BrowserCapability> {
  const team = await queries.getTeam(teamId);
  if (!team) throw new Error(`Unknown team "${teamId}"`);
  const plan = team.plan as Plan;
  return createBrowserCapability(
    appBrowserHost,
    {
      team: {
        id: team.id,
        name: team.name,
        slug: team.slug,
        plan,
        entitlements: entitlementsFor(plan),
      },
      log: getLogger(scopeName),
    },
    // Same clamp the runtime applies: the pool cap lives in the pool service,
    // so core bounds a swarm by what it is told rather than by what it is asked.
    { maxSwarm: Number(process.env.EB_PROCESS_POOL_MAX ?? 4) },
  );
}
