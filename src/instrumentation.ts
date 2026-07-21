/**
 * Next.js instrumentation hook — runs once when the server boots.
 * Scope: nodejs runtime only (not edge).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  // Must run before `reconcileOrphanedPoolEBs` — deleting the Jobs here is
  // what produces the phantom rows that reconcile prunes.
  try {
    const { refreshDevPoolAfterRestart } =
      await import("@/lib/eb/dev-port-forward");
    await refreshDevPoolAfterRestart();
  } catch (err) {
    console.error("[Boot] refreshDevPoolAfterRestart failed:", err);
  }

  try {
    const { reconcileOrphanedPoolEBs } =
      await import("@/server/actions/embedded-sessions");
    await reconcileOrphanedPoolEBs();
  } catch (err) {
    console.error("[Boot] reconcileOrphanedPoolEBs failed:", err);
  }

  // Warm-pool boot top-up moved to the pool service (`pnpm pool` /
  // packages/pool-service/src/main.ts) — the app no longer provisions EBs directly.

  // Start the periodic reaper loop here — not lazily from `/api/ws/runner` —
  // because EBs hit the envoy-less companion pod via LASTEST_URL, leaving the
  // user-facing pod's lazy init dormant. With both pods running the loop, idle
  // EBs get reaped regardless of which pod sees runner traffic.
  try {
    const { startCleanupLoop } = await import("@/lib/eb/cleanup-loop");
    startCleanupLoop();
  } catch (err) {
    console.error("[Boot] startCleanupLoop failed:", err);
  }
}
