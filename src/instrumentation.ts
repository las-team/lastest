/**
 * Next.js instrumentation hook — runs once when the server boots.
 * Scope: nodejs runtime only (not edge).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  // Structured JSON logging first, so every boot step below is captured by it.
  // Production only — dev keeps the raw console output Next's overlay expects.
  if (process.env.NODE_ENV === "production") {
    try {
      const { installConsoleBridge } =
        await import("@/lib/logger-console-bridge");
      installConsoleBridge();
    } catch (err) {
      console.error("[Boot] installConsoleBridge failed:", err);
    }
  }

  // Resolve the plugin registry and hand each plugin its runtime.
  //
  // This has to happen at boot rather than on first use: a plugin's
  // `"use server"` module is dispatched directly by Next.js, so an action
  // request never passes through app code that could lazily wire it. It is
  // also where a bad manifest surfaces — duplicate ids, a plugin with storage
  // and no deletion hook, a table missing its namespace prefix — as a loud boot
  // failure instead of a 500 on whichever request happens to touch it first.
  try {
    const { getPluginRuntime } = await import("@/lib/core/runtime");
    await getPluginRuntime();
  } catch (err) {
    console.error("[Boot] plugin runtime failed to initialize:", err);
  }

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
